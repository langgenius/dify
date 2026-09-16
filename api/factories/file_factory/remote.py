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

from core.file import remote_fetcher


def extract_filename(url_or_path: str, content_disposition: str | None) -> str | None:
    """Extract a safe filename from Content-Disposition or the request URL path.

    Handles full URLs, paths with query strings, hash fragments, and percent-encoded segments.
    Query strings and hash fragments are stripped from the URL before extracting the basename.
    Percent-encoded characters in the path are decoded safely.
    """
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
        # Parse the URL to extract just the path, stripping query strings and fragments
        # This handles both full URLs and bare paths
        parsed = urllib.parse.urlparse(url_or_path)
        path = parsed.path
        candidate = os.path.basename(path)
        # Decode percent-encoded characters, with safe fallback for malformed input
        filename = urllib.parse.unquote(candidate, errors="replace") if candidate else None

    if filename:
        filename = os.path.basename(filename)
        if not filename or not filename.strip():
            filename = None

    return filename or None


def _guess_mime_type(filename: str) -> str:
    guessed_mime, _ = mimetypes.guess_type(filename)
    return guessed_mime or ""


def _metadata_from_response(
    resp: httpx.Response,
    url_path: str,
    filename: str,
    mime_type: str,
    file_size: int,
) -> tuple[str, str, int]:
    content_disposition = resp.headers.get("Content-Disposition")
    extracted_filename = extract_filename(url_path, content_disposition)
    if extracted_filename:
        filename = extracted_filename
        mime_type = _guess_mime_type(filename)
    file_size = int(resp.headers.get("Content-Length", file_size))
    if not mime_type:
        mime_type = resp.headers.get("Content-Type", "").split(";")[0].strip()
    return mime_type, filename, file_size


def _get_metadata_after_head_unsupported(
    url: str,
    url_path: str,
    filename: str,
    mime_type: str,
    file_size: int,
) -> tuple[str, str, int]:
    """When HEAD is unsupported, probe metadata via a streaming GET without reading the body."""
    get_resp = remote_fetcher.make_request("GET", url, follow_redirects=True, stream_response=True)
    try:
        if get_resp.status_code == httpx.codes.OK:
            return _metadata_from_response(get_resp, url_path, filename, mime_type, file_size)
    finally:
        get_resp.close()
    return mime_type, filename, file_size


def get_remote_file_info(url: str) -> tuple[str, str, int]:
    """Resolve remote file metadata with SSRF-safe HEAD probing."""
    file_size = -1
    parsed_url = urllib.parse.urlparse(url)
    url_path = parsed_url.path
    filename = os.path.basename(url_path)
    mime_type = _guess_mime_type(filename)

    resp = remote_fetcher.make_request("HEAD", url, follow_redirects=True)
    if resp.status_code == httpx.codes.OK:
        mime_type, filename, file_size = _metadata_from_response(resp, url_path, filename, mime_type, file_size)
    elif resp.status_code in (httpx.codes.METHOD_NOT_ALLOWED, httpx.codes.NOT_IMPLEMENTED):
        mime_type, filename, file_size = _get_metadata_after_head_unsupported(
            url, url_path, filename, mime_type, file_size
        )

    if not filename:
        extension = mimetypes.guess_extension(mime_type) or ".bin"
        filename = f"{uuid.uuid4().hex}{extension}"
        if not mime_type:
            mime_type = _guess_mime_type(filename)

    return mime_type, filename, file_size
