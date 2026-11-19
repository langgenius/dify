"""Prevent user-controlled HTML and XML files, including SVG, from becoming executable documents."""

import os
from email.message import Message
from urllib.parse import quote

from flask import Response

ACTIVE_CONTENT_MIME_TYPES: frozenset[str] = frozenset(("text/html", "application/xml", "text/xml", "text/xsl"))
ACTIVE_CONTENT_EXTENSIONS: frozenset[str] = frozenset(
    ("html", "htm", "xhtml", "xht", "svg", "svgz", "xml", "xsl", "xslt")
)


def _normalize_mime_type(mime_type: str | None) -> str:
    if not mime_type:
        return ""
    message = Message()
    message["Content-Type"] = mime_type
    return message.get_content_type().strip().lower()


def _file_extensions(filename: str | None, extension: str | None) -> frozenset[str]:
    """Normalize filename and route extensions; absent values become empty strings."""
    return frozenset(value.lstrip(".").lower() for value in (extension or "", os.path.splitext(filename or "")[1]))


def is_active_content(mime_type: str | None, filename: str | None, extension: str | None = None) -> bool:
    """Recognize HTML/XML metadata, including any +xml MIME subtype; ignore missing metadata."""
    normalized_mime_type = _normalize_mime_type(mime_type)
    # An XML document can contain an active SVG root regardless of its MIME subtype.
    if normalized_mime_type in ACTIVE_CONTENT_MIME_TYPES or normalized_mime_type.endswith("+xml"):
        return True

    return not ACTIVE_CONTENT_EXTENSIONS.isdisjoint(_file_extensions(filename, extension))


def harden_active_content_response(
    response: Response,
    *,
    mime_type: str | None,
    filename: str | None,
    extension: str | None = None,
    inline_svg: bool = False,
) -> bool:
    """Sandbox active content identified by file metadata, without consuming the stream.

    Check both stored metadata and the actual response MIME. Missing types and
    HTML/XML default to downloads. Preview endpoints may allow SVG inline under
    a script-free sandbox; compressed SVGZ always downloads unchanged. Add
    nosniff to every response and return whether content restrictions applied.
    """
    response.headers["X-Content-Type-Options"] = "nosniff"
    response_mime_type = response.mimetype
    missing_mime_type = not (mime_type or "").strip() or not (response_mime_type or "").strip()
    if not (
        missing_mime_type
        or is_active_content(mime_type, filename, extension)
        or is_active_content(response_mime_type, None)
    ):
        return False

    file_extensions = _file_extensions(filename, extension)
    if (
        inline_svg
        and "svgz" not in file_extensions
        and (_normalize_mime_type(mime_type) == "image/svg+xml" or "svg" in file_extensions)
    ):
        response.headers["Content-Type"] = "image/svg+xml"
        response.headers["Content-Disposition"] = "inline"
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"
        )
    else:
        response.headers["Content-Disposition"] = (
            f"attachment; filename*=UTF-8''{quote(filename)}" if filename else "attachment"
        )
        response.headers["Content-Type"] = "application/octet-stream"
        response.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"

    return True
