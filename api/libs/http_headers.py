"""Business-independent parsing of HTTP header values."""

from werkzeug.http import parse_options_header


def content_type_media_type(content_type: str) -> str:
    """Return the lowercase media type without Content-Type parameters."""
    media_type, _ = parse_options_header(content_type)
    return media_type.lower()


def content_disposition_filename(content_disposition: str | None) -> str | None:
    """Return a basename from a parsed filename parameter, or None if absent.

    Accept legacy filename and RFC 5987 filename* parameters using Werkzeug's
    parameter parsing rules. The result never contains a directory component.
    """
    if not content_disposition:
        return None
    _, params = parse_options_header(content_disposition)
    filename = params.get("filename")
    if not filename:
        return None
    basename = filename.replace("\\", "/").rsplit("/", 1)[-1]
    return basename or None
