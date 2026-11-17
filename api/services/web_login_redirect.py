"""Resolve login return addresses from trusted deployment URLs, never request hosts."""

import re
from urllib.parse import SplitResult, unquote, urlsplit, urlunsplit

_WEB_APP_ROUTES = frozenset({"agent", "chat", "chatbot", "completion", "workflow"})
_UNSAFE_CHARACTERS = re.compile(r"[\x00-\x20\x7f\\]")
_APP_CODE = re.compile(r"[a-zA-Z0-9_-]+")
_PERSONAL_ROUTE = re.compile(r"(?:my-apps|connections(?:/(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+)?)")


def _origin(url: SplitResult) -> tuple[str, str | None, int]:
    port = url.port
    return url.scheme, url.hostname, port if port is not None else (443 if url.scheme == "https" else 80)


def resolve_web_login_redirect(redirect_url: str, *, app_web_url: str, console_web_url: str) -> str | None:
    """Allow only a Web App route under its configured origin and base path.

    Relative deployment URLs support same-origin installations. Query strings and
    fragments stay opaque so embedded inputs are not decoded or encoded twice.
    """
    if not redirect_url or _UNSAFE_CHARACTERS.search(redirect_url) or redirect_url.startswith("//"):
        return None
    try:
        target = urlsplit(redirect_url)
        base = urlsplit(app_web_url or console_web_url)
        if base.scheme and base.scheme not in {"http", "https"}:
            return None
        if target.scheme or target.netloc:
            if (
                target.scheme not in {"http", "https"}
                or target.username is not None
                or target.password is not None
                or _origin(target) != _origin(base)
            ):
                return None
        if not target.path.startswith("/"):
            return None
        prefix = base.path.rstrip("/")
        if not target.path.startswith(f"{prefix}/"):
            return None
        segments = target.path[len(prefix) + 1 :].split("/")
        if len(segments) != 2 or segments[0] not in _WEB_APP_ROUTES or not _APP_CODE.fullmatch(segments[1]):
            return None
        return urlunsplit((base.scheme, base.netloc, target.path, target.query, target.fragment))
    except ValueError:
        return None


def resolve_personal_login_redirect(redirect_url: str | None, *, console_web_url: str) -> str | None:
    """Resolve a personal portal target against trusted deployment configuration.

    Preconditions: console_web_url is deployment configuration, never a request host.
    A missing target selects My Apps. Supplied targets must be root-relative or
    same-origin HTTP(S) URLs under the configured base path and personal routes.
    Postconditions: return a safe target with its query and fragment unchanged,
    or None for invalid input. Perform no I/O and never admit sign-in or App routes.
    """
    if redirect_url is not None and (
        not redirect_url or _UNSAFE_CHARACTERS.search(redirect_url) or redirect_url.startswith("//")
    ):
        return None
    try:
        base = urlsplit(console_web_url)
        prefix = base.path.rstrip("/")
        if redirect_url is None:
            return f"{prefix}/my-apps"
        target = urlsplit(redirect_url)
        if target.scheme or target.netloc:
            if (
                target.scheme not in {"http", "https"}
                or target.username is not None
                or target.password is not None
                or _origin(target) != _origin(base)
            ):
                return None
        if not target.path.startswith(f"{prefix}/"):
            return None
        route = target.path[len(prefix) + 1 :]
        if not _PERSONAL_ROUTE.fullmatch(route) or unquote(route.rsplit("/", 1)[-1]) in {".", ".."}:
            return None
        return redirect_url
    except ValueError:
        return None
