import os
from email.message import Message
from urllib.parse import quote

from flask import Response

HTML_MIME_TYPES = frozenset({"text/html", "application/xhtml+xml"})
HTML_EXTENSIONS = frozenset({"html", "htm"})


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
