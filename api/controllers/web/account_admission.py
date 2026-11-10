"""Cookie-only Account admission shared by personal WebApp endpoints."""

from urllib.parse import urlsplit

from flask import request
from werkzeug.exceptions import Forbidden, Unauthorized

from configs import dify_config
from core.logging.context import get_request_id, get_trace_id
from extensions.ext_application_services import application_services
from libs.token import extract_webapp_cookie_token
from machinery.context import AccountRequestContext
from services.consumer_service import ConsumerIdentity
from services.web_identity_service import WebIdentityError
from services.web_passport_service import WebPassportUnauthorizedError


def _origin(url: str) -> tuple[str, str, int]:
    """Normalize an HTTP URL to its origin; malformed authorities fail closed."""
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Invalid origin.")
    port = parsed.port
    return parsed.scheme, parsed.hostname, port if port is not None else (443 if parsed.scheme == "https" else 80)


def web_account_identity() -> ConsumerIdentity:
    """Admit only a valid WebApp Account cookie, without App or workspace scope.

    Mutations require the configured WebApp Origin; reads may omit Origin.
    Foreign or malformed origins fail before authentication or side effects.
    Missing, expired, foreign-purpose or unavailable identities return 401.
    """
    origin = request.headers.get("Origin")
    if origin is not None or request.method not in {"GET", "HEAD", "OPTIONS"}:
        try:
            trusted = next(
                url
                for url in (dify_config.APP_WEB_URL, dify_config.CONSOLE_WEB_URL, request.host_url)
                if urlsplit(url).netloc
            )
            if origin is None or urlsplit(origin).path or _origin(origin) != _origin(trusted):
                raise ValueError("Untrusted origin.")
        except ValueError:
            raise Forbidden("WebApp request origin is not allowed.") from None
    try:
        return application_services().consumer.authenticate(extract_webapp_cookie_token(request))
    except (WebIdentityError, WebPassportUnauthorizedError):
        raise Unauthorized("WebApp Account login required.") from None


def web_account_context() -> AccountRequestContext:
    """Convert admitted cookie identity to Account-only metadata; never select a workspace."""
    try:
        identity = web_account_identity()
    except Unauthorized as error:
        raise Unauthorized("Account login required.") from error
    return AccountRequestContext(request_id=get_request_id(), trace_id=get_trace_id(), account_id=identity.account_id)
