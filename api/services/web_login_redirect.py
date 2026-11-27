"""Resolve login return addresses from trusted deployment URLs, never request hosts."""

import re
from urllib.parse import SplitResult, unquote, urlsplit

_WEB_APP_ROUTES = frozenset({"agent", "chat", "chatbot", "completion", "workflow"})
_UNSAFE_CHARACTERS = re.compile(r"[\x00-\x20\x7f\\]")
_UNSAFE_PATH_CHARACTERS = re.compile(r"[\x00-\x1f\x7f\\]")
_APP_CODE = re.compile(r"[a-zA-Z0-9_-]+")
_PERSONAL_ROUTE = re.compile(r"/(?:my-apps|connections(?:/(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+)?)")


def _origin(url: SplitResult) -> tuple[str, str | None, int]:
    """Compare parsed URLs by scheme, hostname, and effective port."""
    port = url.port
    return url.scheme, url.hostname, port if port is not None else (443 if url.scheme == "https" else 80)


def _safe_path(path: str) -> bool:
    """Check path boundaries without decoding the path used for navigation."""
    decoded = unquote(path)
    return all(
        candidate.startswith("/")
        and not candidate.startswith("//")
        and not _UNSAFE_PATH_CHARACTERS.search(candidate)
        and not {".", ".."}.intersection(candidate.split("/"))
        for candidate in (path, decoded, unquote(decoded))
    )


def _resolve_frontend_redirect(redirect_url: str, frontend_url: str) -> tuple[SplitResult, str | None] | None:
    """Resolve against trusted deployment configuration, not the current request.

    A root-relative target may include the deployment prefix or omit it. An
    explicit URL must match the configured origin exactly (scheme, host, and
    effective port); credentials, protocol-relative references, backslashes,
    control characters, and dot segments are rejected. Return the destination
    and its route within the base path (None when outside it), or None for
    invalid input. The destination is rebuilt from the configured origin, so
    the caller's host is never echoed, and query and fragment stay opaque.
    """
    if not redirect_url or _UNSAFE_CHARACTERS.search(redirect_url) or redirect_url.startswith("//"):
        return None
    try:
        base = urlsplit(frontend_url)
        if base.scheme or base.netloc:
            if base.scheme not in {"http", "https"} or not base.hostname or base.username is not None:
                return None
            _origin(base)  # Reject invalid configured ports even for relative targets.
        prefix = base.path.rstrip("/")
        if not _safe_path(prefix or "/"):
            return None

        target = urlsplit(redirect_url)
        absolute = bool(target.scheme or target.netloc)
        if absolute and (not base.netloc or target.username is not None or _origin(target) != _origin(base)):
            return None
        path = target.path or ("/" if absolute else "")
        if not _safe_path(path):
            return None

        if path == prefix:
            route = "/"
        elif path.startswith(f"{prefix}/"):
            route = path[len(prefix) :]
        elif absolute:
            route = None
        else:
            route = path
            path = f"{prefix}{path}"
        return SplitResult(base.scheme, base.netloc, path, target.query, target.fragment), route
    except ValueError:
        return None


def resolve_console_login_redirect(redirect_url: str, *, console_web_url: str) -> str | None:
    """Bind a relative target to the configured Console frontend.

    Same-origin absolute targets stay on their original path. Any other origin
    is rejected without inspecting the API request origin, so a caller-supplied
    host can never select the redirect destination.
    """
    resolved = _resolve_frontend_redirect(redirect_url, console_web_url)
    return resolved[0].geturl() if resolved is not None else None


def resolve_web_login_redirect(redirect_url: str, *, app_web_url: str, console_web_url: str) -> str | None:
    """Resolve a published App route under the trusted WebApp deployment URL.

    The Console base is used only when the WebApp base is unset. Return None for
    unsafe or non-App targets; the handoff owner must still validate the App code.
    """
    resolved = _resolve_frontend_redirect(redirect_url, app_web_url or console_web_url)
    if resolved is None or (route := resolved[1]) is None:
        return None
    segments = route[1:].split("/")
    if len(segments) != 2 or segments[0] not in _WEB_APP_ROUTES or not _APP_CODE.fullmatch(segments[1]):
        return None
    return resolved[0].geturl()


def resolve_personal_login_redirect(redirect_url: str | None, *, app_web_url: str, console_web_url: str) -> str | None:
    """Resolve an End User portal route to trusted frontend configuration.

    A missing or root-relative target uses the WebApp base (or the Console base
    when unset). Explicit legacy Console portal URLs remain valid. Return None
    for invalid input; never admit generic Console routes or App routes without PKCE.
    """
    frontend_url = app_web_url or console_web_url
    if (resolved := resolve_web_portal_login_redirect(redirect_url, webapp_url=frontend_url)) is not None:
        return resolved
    # Only explicit absolute URLs may keep a legacy Console portal destination.
    if app_web_url and redirect_url and not redirect_url.startswith("/"):
        return resolve_web_portal_login_redirect(redirect_url, webapp_url=console_web_url)
    return None


def resolve_web_portal_login_redirect(redirect_url: str | None, *, webapp_url: str) -> str | None:
    """Resolve a portal return (default: My Apps) on the WebApp base only; reject any other target."""
    target = redirect_url if redirect_url is not None else f"{webapp_url.rstrip('/')}/my-apps"
    resolved = _resolve_frontend_redirect(target, webapp_url)
    if resolved is None or (route := resolved[1]) is None or not _PERSONAL_ROUTE.fullmatch(route):
        return None
    return resolved[0].geturl()
