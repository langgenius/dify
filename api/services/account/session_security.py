"""Verify request evidence before a cookie-backed Console session mutation."""

from configs import dify_config
from core.auth.refresh_origin import refresh_origin_requires_csrf
from services.account.console_tokens import verify_refresh_csrf_proof
from services.account_errors import UntrustedSessionOriginError


def validate_session_request_origin(
    *,
    origin_header: str,
    api_url: str,
    csrf_header: str | None,
    csrf_cookie: str | None,
    refresh_token: str | None,
) -> None:
    try:
        requires_csrf = refresh_origin_requires_csrf(
            origin_header, api_url=api_url, console_web_url=dify_config.CONSOLE_WEB_URL
        )
    except ValueError as error:
        raise UntrustedSessionOriginError(str(error)) from error
    # Refresh and logout must still work after the access and CSRF JWTs expire.
    if requires_csrf and not verify_refresh_csrf_proof(csrf_header, csrf_cookie, refresh_token):
        raise UntrustedSessionOriginError("A trusted Origin header is required.")
