"""Business-independent parsing of HTTP header values."""

from werkzeug.http import parse_options_header


def content_type_media_type(content_type: str) -> str:
    """Return the lowercase media type without Content-Type parameters."""
    media_type, _ = parse_options_header(content_type)
    return media_type.lower()
