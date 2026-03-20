"""Remote file metadata helpers used by workflow file normalization.

These helpers are part of the ``factories.file_factory`` package surface
because both workflow builders and tests rely on the same RFC5987 filename
parsing and HEAD-response normalization rules.
"""

from __future__ import annotations

import mimetypes
import os
import re
import urllib.parse
import uuid

import httpx
from werkzeug.http import parse_options_header

from core.helper import ssrf_proxy


def extract_filename(url_path: str, content_disposition: str | None) -> str | None:
    """Extract a safe filename from Content-Disposition or the request URL path."""
    filename: str | None = None
    if content_disposition:
        filename_star_match = re.search(r"filename\*=([^;]+)", content_disposition)
        if filename_star_match:
            raw_star = filename_star_match.group(1).strip()
            raw_star = raw_star.removesuffix('"')
            try:
                parts = raw_star.split("'", 2)
                charset = (parts[0] or "utf-8").lower() if len(parts) >= 1 else "utf-8"
                value = parts[2] if len(parts) == 3 else parts[-1]
                filename = urllib.parse.unquote(value, encoding=charset, errors="replace")
            except Exception:
                if "''" in raw_star:
                    filename = urllib.parse.unquote(raw_star.split("''")[-1])
                else:
                    filename = urllib.parse.unquote(raw_star)

        if not filename:
            _, params = parse_options_header(content_disposition)
            raw = params.get("filename")
            if raw:
                if len(raw) >= 2 and raw[0] == raw[-1] == '"':
                    raw = raw[1:-1]
                filename = urllib.parse.unquote(raw)

    if not filename:
        candidate = os.path.basename(url_path)
        filename = urllib.parse.unquote(candidate) if candidate else None

    if filename:
        filename = os.path.basename(filename)
        if not filename or not filename.strip():
            filename = None

    return filename or None


def _guess_mime_type(filename: str) -> str:
    guessed_mime, _ = mimetypes.guess_type(filename)
    return guessed_mime or ""


def get_remote_file_info(url: str) -> tuple[str, str, int]:
    """Resolve remote file metadata with SSRF-safe HEAD probing."""
    file_size = -1
    parsed_url = urllib.parse.urlparse(url)
    url_path = parsed_url.path
    filename = os.path.basename(url_path)
    mime_type = _guess_mime_type(filename)

    resp = ssrf_proxy.head(url, follow_redirects=True)
    if resp.status_code == httpx.codes.OK:
        content_disposition = resp.headers.get("Content-Disposition")
        extracted_filename = extract_filename(url_path, content_disposition)
        if extracted_filename:
            filename = extracted_filename
            mime_type = _guess_mime_type(filename)
        file_size = int(resp.headers.get("Content-Length", file_size))
        if not mime_type:
            mime_type = resp.headers.get("Content-Type", "").split(";")[0].strip()

    if not filename:
        extension = mimetypes.guess_extension(mime_type) or ".bin"
        filename = f"{uuid.uuid4().hex}{extension}"
        if not mime_type:
            mime_type = _guess_mime_type(filename)

    return mime_type, filename, file_size
