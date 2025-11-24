import logging
import re
from datetime import UTC, datetime, timedelta

from flask import Request
from werkzeug.exceptions import Unauthorized
from werkzeug.wrappers import Response

from configs import dify_config
from constants import (
    COOKIE_NAME_ACCESS_TOKEN,
    COOKIE_NAME_CSRF_TOKEN,
    COOKIE_NAME_PASSPORT,
    COOKIE_NAME_REFRESH_TOKEN,
    COOKIE_NAME_WEBAPP_ACCESS_TOKEN,
    HEADER_NAME_CSRF_TOKEN,
    HEADER_NAME_PASSPORT,
)
from libs.passport import PassportService

logger = logging.getLogger(__name__)

CSRF_WHITE_LIST = [
    re.compile(r"/console/api/apps/[a-f0-9-]+/workflows/draft"),
]


# server is behind a reverse proxy, so we need to check the url
def is_secure() -> bool:
    return dify_config.CONSOLE_WEB_URL.startswith("https") and dify_config.CONSOLE_API_URL.startswith("https")


def _cookie_domain() -> str | None:
    """
    Returns the normalized cookie domain.

    Leading dots are stripped from the configured domain. Historically, a leading dot
    indicated that a cookie should be sent to all subdomains, but modern browsers treat
    'example.com' and '.example.com' identically. This normalization ensures consistent
    behavior and avoids confusion.
    """
    domain = dify_config.COOKIE_DOMAIN.strip()
    domain = domain.removeprefix(".")
    return domain or None


def _real_cookie_name(cookie_name: str) -> str:
    if is_secure() and _cookie_domain() is None:
        return "__Host-" + cookie_name
    else:
        return cookie_name


def _try_extract_from_header(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization")
    if auth_header:
        if " " not in auth_header:
            return None
        else:
            auth_scheme, auth_token = auth_header.split(None, 1)
            auth_scheme = auth_scheme.lower()
            if auth_scheme != "bearer":
                return None
            else:
                return auth_token
    return None


def extract_refresh_token(request: Request) -> str | None:
    return request.cookies.get(_real_cookie_name(COOKIE_NAME_REFRESH_TOKEN))


def extract_csrf_token(request: Request) -> str | None:
    return request.headers.get(HEADER_NAME_CSRF_TOKEN)


def extract_csrf_token_from_cookie(request: Request) -> str | None:
    return request.cookies.get(_real_cookie_name(COOKIE_NAME_CSRF_TOKEN))


def extract_access_token(request: Request) -> str | None:
    def _try_extract_from_cookie(request: Request) -> str | None:
        return request.cookies.get(_real_cookie_name(COOKIE_NAME_ACCESS_TOKEN))

    return _try_extract_from_cookie(request) or _try_extract_from_header(request)


def extract_webapp_access_token(request: Request) -> str | None:
    return request.cookies.get(_real_cookie_name(COOKIE_NAME_WEBAPP_ACCESS_TOKEN)) or _try_extract_from_header(request)


def extract_webapp_passport(app_code: str, request: Request) -> str | None:
    def _try_extract_passport_token_from_cookie(request: Request) -> str | None:
        return request.cookies.get(_real_cookie_name(COOKIE_NAME_PASSPORT + "-" + app_code))

    def _try_extract_passport_token_from_header(request: Request) -> str | None:
        return request.headers.get(HEADER_NAME_PASSPORT)

    ret = _try_extract_passport_token_from_cookie(request) or _try_extract_passport_token_from_header(request)
    return ret


def set_access_token_to_cookie(request: Request, response: Response, token: str, samesite: str = "Lax"):
    response.set_cookie(
        _real_cookie_name(COOKIE_NAME_ACCESS_TOKEN),
        value=token,
        httponly=True,
        domain=_cookie_domain(),
        secure=is_secure(),
        samesite=samesite,
        max_age=int(dify_config.ACCESS_TOKEN_EXPIRE_MINUTES * 60),
        path="/",
    )


def set_refresh_token_to_cookie(request: Request, response: Response, token: str):
    response.set_cookie(
        _real_cookie_name(COOKIE_NAME_REFRESH_TOKEN),
        value=token,
        httponly=True,
        domain=_cookie_domain(),
        secure=is_secure(),
        samesite="Lax",
        max_age=int(60 * 60 * 24 * dify_config.REFRESH_TOKEN_EXPIRE_DAYS),
        path="/",
    )


def set_csrf_token_to_cookie(request: Request, response: Response, token: str):
    response.set_cookie(
        _real_cookie_name(COOKIE_NAME_CSRF_TOKEN),
        value=token,
        httponly=False,
        domain=_cookie_domain(),
        secure=is_secure(),
        samesite="Lax",
        max_age=int(60 * dify_config.ACCESS_TOKEN_EXPIRE_MINUTES),
        path="/",
    )


def _clear_cookie(
    response: Response,
    cookie_name: str,
    samesite: str = "Lax",
    http_only: bool = True,
):
    response.set_cookie(
        _real_cookie_name(cookie_name),
        "",
        expires=0,
        path="/",
        domain=_cookie_domain(),
        secure=is_secure(),
        httponly=http_only,
        samesite=samesite,
    )


def clear_access_token_from_cookie(response: Response, samesite: str = "Lax"):
    _clear_cookie(response, COOKIE_NAME_ACCESS_TOKEN, samesite)


def clear_webapp_access_token_from_cookie(response: Response, samesite: str = "Lax"):
    _clear_cookie(response, COOKIE_NAME_WEBAPP_ACCESS_TOKEN, samesite)


def clear_refresh_token_from_cookie(response: Response):
    _clear_cookie(response, COOKIE_NAME_REFRESH_TOKEN)


def clear_csrf_token_from_cookie(response: Response):
    _clear_cookie(response, COOKIE_NAME_CSRF_TOKEN, http_only=False)


def build_force_logout_cookie_headers() -> list[str]:
    """
    Generate Set-Cookie header values that clear all auth-related cookies.
    This mirrors the behavior of the standard cookie clearing helpers while
    allowing callers that do not have a Response instance to reuse the logic.
    """
    response = Response()
    clear_access_token_from_cookie(response)
    clear_csrf_token_from_cookie(response)
    clear_refresh_token_from_cookie(response)
    return response.headers.getlist("Set-Cookie")


def check_csrf_token(request: Request, user_id: str):
    # some apis are sent by beacon, so we need to bypass csrf token check
    # since these APIs are post, they are already protected by SameSite: Lax, so csrf is not required.
    def _unauthorized():
        raise Unauthorized("CSRF token is missing or invalid.")

    for pattern in CSRF_WHITE_LIST:
        if pattern.match(request.path):
            return

    csrf_token = extract_csrf_token(request)
    csrf_token_from_cookie = extract_csrf_token_from_cookie(request)

    if csrf_token != csrf_token_from_cookie:
        _unauthorized()

    if not csrf_token:
        _unauthorized()
    verified = {}
    try:
        verified = PassportService().verify(csrf_token)
    except:
        _unauthorized()

    if verified.get("sub") != user_id:
        _unauthorized()

    exp: int | None = verified.get("exp")
    if not exp:
        _unauthorized()
    else:
        time_now = int(datetime.now().timestamp())
        if exp < time_now:
            _unauthorized()


def generate_csrf_token(user_id: str) -> str:
    exp_dt = datetime.now(UTC) + timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "exp": int(exp_dt.timestamp()),
        "sub": user_id,
    }
    return PassportService().issue(payload)
