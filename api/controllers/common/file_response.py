import os
from email.message import Message
from urllib.parse import quote

from flask import Response

HTML_MIME_TYPES: frozenset[str] = frozenset(("text/html", "application/xhtml+xml"))
HTML_EXTENSIONS: frozenset[str] = frozenset(("html", "htm"))

# Content that stays inert inside an <img> tag but turns into a script-bearing
# document as soon as a browser renders it top-level. Unlike HTML it must keep
# its image Content-Type, otherwise existing thumbnails stop rendering.
SCRIPTABLE_DOCUMENT_MIME_TYPES: frozenset[str] = frozenset(("image/svg+xml", "text/xml", "application/xml"))
SCRIPTABLE_DOCUMENT_EXTENSIONS: frozenset[str] = frozenset(("svg", "svgz", "xml"))

# Second layer for the types above, in case a client renders the response anyway:
# `sandbox` without allow-scripts blocks inline <script>, `default-src 'none'`
# blocks anything it would try to reach. Both are ignored for <img> loads.
INERT_DOCUMENT_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"


def _normalize_mime_type(mime_type: str | None) -> str:
    if not mime_type:
        return ""
    message = Message()
    message["Content-Type"] = mime_type
    return message.get_content_type().strip().lower()


def _has_extension(extension: str | None, extensions: frozenset[str]) -> bool:
    if not extension:
        return False
    return extension.lstrip(".").lower() in extensions


def _is_html_extension(extension: str | None) -> bool:
    return _has_extension(extension, HTML_EXTENSIONS)


def _matches(
    mime_type: str | None,
    filename: str | None,
    extension: str | None,
    mime_types: frozenset[str],
    extensions: frozenset[str],
) -> bool:
    if _normalize_mime_type(mime_type) in mime_types:
        return True

    if _has_extension(extension, extensions):
        return True

    if filename:
        return _has_extension(os.path.splitext(filename)[1], extensions)

    return False


def is_html_content(mime_type: str | None, filename: str | None, extension: str | None = None) -> bool:
    return _matches(mime_type, filename, extension, HTML_MIME_TYPES, HTML_EXTENSIONS)


def is_scriptable_document(mime_type: str | None, filename: str | None, extension: str | None = None) -> bool:
    return _matches(
        mime_type,
        filename,
        extension,
        SCRIPTABLE_DOCUMENT_MIME_TYPES,
        SCRIPTABLE_DOCUMENT_EXTENSIONS,
    )


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


def _set_attachment_disposition(response: Response, filename: str | None) -> None:
    if filename:
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(filename)}"
    else:
        response.headers["Content-Disposition"] = "attachment"


def harden_served_file(
    response: Response,
    *,
    mime_type: str | None,
    filename: str | None,
    extension: str | None = None,
) -> bool:
    """Keep a stored file from executing as a document in the serving origin.

    Always sends `nosniff`. HTML is forced to download as an octet-stream (as
    before). SVG/XML keep their Content-Type so `<img src=...>` still renders
    them, but are marked as an attachment and served with an inert CSP, so a
    top-level navigation cannot run the script they may carry.

    Returns True when the content was classified as active.
    """
    response.headers["X-Content-Type-Options"] = "nosniff"

    if enforce_download_for_html(response, mime_type=mime_type, filename=filename, extension=extension):
        return True

    if not is_scriptable_document(mime_type, filename, extension):
        return False

    _set_attachment_disposition(response, filename)
    response.headers["Content-Security-Policy"] = INERT_DOCUMENT_CSP
    return True
