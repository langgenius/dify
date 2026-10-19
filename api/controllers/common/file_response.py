import os
from email.message import Message
from urllib.parse import quote

from flask import Response, has_request_context, request
from werkzeug.http import parse_range_header

HTML_MIME_TYPES: frozenset[str] = frozenset(("text/html", "application/xhtml+xml"))
HTML_EXTENSIONS: frozenset[str] = frozenset(("html", "htm"))


def _normalize_mime_type(mime_type: str | None) -> str:
    if not mime_type:
        return ""
    message = Message()
    message["Content-Type"] = mime_type
    return message.get_content_type().strip().lower()


def _is_html_extension(extension: str | None) -> bool:
    if not extension:
        return False
    return extension.lstrip(".").lower() in HTML_EXTENSIONS


def is_html_content(mime_type: str | None, filename: str | None, extension: str | None = None) -> bool:
    normalized_mime_type = _normalize_mime_type(mime_type)
    if normalized_mime_type in HTML_MIME_TYPES:
        return True

    if _is_html_extension(extension):
        return True

    if filename:
        return _is_html_extension(os.path.splitext(filename)[1])

    return False


def enforce_download_for_html(
    response: Response,
    *,
    mime_type: str | None,
    filename: str | None,
    extension: str | None = None,
) -> bool:
    if not is_html_content(mime_type, filename, extension):
        return False

    if filename:
        encoded_filename = quote(filename)
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"
    else:
        response.headers["Content-Disposition"] = "attachment"

    response.headers["Content-Type"] = "application/octet-stream"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return True


def slice_content_for_range(content, start: int, end: int):
    """Slice the [start, end] byte window out of file content while streaming.

    Joining the whole stream before slicing loads the entire file into
    memory on every ranged request; the full-file path is streamed, so the
    range path should be too. Iterates the source only until the window
    ends, so memory stays bounded by the chunk size instead of the file
    size. Bytes input is sliced directly.
    """
    if isinstance(content, bytes):
        return content[start : end + 1]

    def _windowed():
        pos = 0
        remaining = end - start + 1
        for chunk in content:
            if remaining <= 0:
                break
            chunk_len = len(chunk)
            if pos + chunk_len <= start:
                pos += chunk_len
                continue
            offset = max(start - pos, 0)
            take = min(chunk_len - offset, remaining)
            yield chunk[offset : offset + take]
            remaining -= take
            pos += chunk_len

    return _windowed()


def requested_byte_range(mime_type: str | None, size: int, range_media_types: frozenset[str]) -> tuple[int, int] | str | None:
    """Resolve the request's Range header against the file size.

    Returns (start, end) inclusive for a satisfiable single byte range,
    "unsatisfiable" when the range cannot be served, or None when there is
    no usable Range header and the full file should be sent.
    """
    if mime_type not in range_media_types or size <= 0:
        return None
    if not has_request_context():
        return None
    range_header = request.headers.get("Range")
    if not range_header:
        return None
    parsed = parse_range_header(range_header)
    if parsed is None or parsed.units != "bytes" or len(parsed.ranges) != 1:
        return None
    start, stop = parsed.ranges[0]
    if start < 0:
        # suffix form "bytes=-N": the last N bytes; longer than the file means the whole file
        if start == 0:
            return "unsatisfiable"
        start = max(size + start, 0)
        return (start, size - 1)
    if start >= size:
        return "unsatisfiable"
    end = size - 1 if stop is None else min(stop, size) - 1
    return (start, end)
