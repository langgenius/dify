"""Origin policy for cookie-backed Console session mutations."""

from urllib.parse import urlsplit


def _origin(url: str) -> tuple[str, str, int] | None:
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or any(character.isspace() for character in url)
        ):
            return None
        port = parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80)
        if port == 0:
            return None
        return parsed.scheme, parsed.hostname, port
    except ValueError:
        return None


def refresh_origin_requires_csrf(origin_header: str, *, api_url: str, console_web_url: str) -> bool:
    """Return whether a trusted origin needs a cookie proof; reject foreign or malformed origins."""
    origin = _origin(origin_header)
    if origin is None:
        raise ValueError("A trusted Origin header is required.")
    parsed = urlsplit(origin_header)
    if parsed.path or parsed.query or parsed.fragment:
        raise ValueError("A trusted Origin header is required.")
    api_origin = _origin(api_url)
    if origin in {api_origin, _origin(console_web_url)}:
        return False
    # Proxies may hide the browser's scheme or port; same-host access still needs a signed cookie echo.
    if api_origin is not None and origin[1] == api_origin[1]:
        return True
    raise ValueError("A trusted Origin header is required.")
