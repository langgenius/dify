import logging
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
    HEADER_NAME_CSRF_TOKEN,
)
from libs.passport import PassportService

logger = logging.getLogger(__name__)


# server is behind a reverse proxy, so we need to check the url
def is_secure() -> bool:
    return dify_config.CONSOLE_WEB_URL.startswith("https") and dify_config.CONSOLE_API_URL.startswith("https")


def _try_extract_from_header(request: Request) -> str | None:
    """
    Try to extract access token from header
    """
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


def extract_csrf_token(request: Request) -> str | None:
    """
    Try to extract CSRF token from header or cookie.
    """
    return request.headers.get(HEADER_NAME_CSRF_TOKEN)


def extract_access_token(request: Request) -> str | None:
    """
    Try to extract access token from cookie, header or params.

    Access token is either for console session or webapp passport exchange.
    """

    def _try_extract_from_cookie(request: Request) -> str | None:
        return request.cookies.get(COOKIE_NAME_ACCESS_TOKEN)

    def _try_extract_from_query(request: Request) -> str | None:
        return request.args.get("_token")

    ret = _try_extract_from_cookie(request) or _try_extract_from_header(request) or _try_extract_from_query(request)
    return ret


def extract_webapp_passport(app_code: str, request: Request) -> str | None:
    """
    Try to extract app token from header or params.

    Webapp access token (part of passport) is only used for webapp session.
    """

    def _try_extract_passport_token_from_query(request: Request) -> str | None:
        # This is unsafe, leave it for backward compatibility
        return request.args.get("web_app_access_token")

    def _try_extract_passport_token_from_cookie(request: Request) -> str | None:
        return request.cookies.get(COOKIE_NAME_PASSPORT + "-" + app_code)

    ret = (
        _try_extract_passport_token_from_cookie(request)
        or _try_extract_from_header(request)
        or _try_extract_passport_token_from_query(request)
    )
    return ret


def set_access_token_to_cookie(request: Request, response: Response, token: str, samesite: str = "Lax"):
    response.set_cookie(
        COOKIE_NAME_ACCESS_TOKEN,
        value=token,
        httponly=True,
        secure=is_secure(),
        samesite=samesite,
        max_age=int(dify_config.ACCESS_TOKEN_EXPIRE_MINUTES * 60),
        path="/",
    )


def set_refresh_token_to_cookie(request: Request, response: Response, token: str):
    response.set_cookie(
        COOKIE_NAME_REFRESH_TOKEN,
        value=token,
        httponly=True,
        secure=is_secure(),
        samesite="Lax",
        max_age=int(60 * 60 * 24 * dify_config.REFRESH_TOKEN_EXPIRE_DAYS),
        path="/",
    )


def set_passport_to_cookie(app_code: str, request: Request, response: Response, token: str):
    samesite = "None"
    if not is_secure():
        # since None is only supported in secure env, we use lax for basic usability
        # for embedded chat ui, use https instead.
        samesite = "Lax"
    response.set_cookie(
        COOKIE_NAME_PASSPORT + "-" + app_code,
        value=token,
        httponly=True,
        secure=is_secure(),
        samesite=samesite,
        max_age=int(60 * dify_config.ACCESS_TOKEN_EXPIRE_MINUTES),
        path="/",
    )


def set_csrf_token_to_cookie(request: Request, response: Response, token: str):
    response.set_cookie(
        COOKIE_NAME_CSRF_TOKEN,
        value=token,
        httponly=False,
        secure=is_secure(),
        samesite="Lax",
        max_age=int(60 * dify_config.ACCESS_TOKEN_EXPIRE_MINUTES),
        path="/",
    )


def _clear_cookie(request: Request, response: Response, cookie_name: str, samesite: str = "Lax"):
    response.set_cookie(
        cookie_name,
        "",
        expires=0,
        path="/",
        secure=is_secure(),
        httponly=True,
        samesite=samesite,
    )


def _clear_cookie_begin_with(request: Request, response: Response, prefix: str, samesite: str = "Lax"):
    for cookie_name in request.cookies:
        if cookie_name.startswith(prefix):
            _clear_cookie(request, response, cookie_name, samesite)


def clear_passport_from_cookie(app_code: str | None, request: Request, response: Response, samesite: str = "Lax"):
    if not app_code:
        _clear_cookie_begin_with(request, response, COOKIE_NAME_PASSPORT, samesite)
        return
    _clear_cookie(request, response, COOKIE_NAME_PASSPORT + "-" + app_code, samesite)


def clear_access_token_from_cookie(request: Request, response: Response, samesite: str = "Lax"):
    _clear_cookie(request, response, COOKIE_NAME_ACCESS_TOKEN, samesite)


def clear_refresh_token_from_cookie(request: Request, response: Response):
    _clear_cookie(request, response, COOKIE_NAME_REFRESH_TOKEN)


def clear_csrf_token_from_cookie(request: Request, response: Response):
    _clear_cookie(request, response, COOKIE_NAME_CSRF_TOKEN)


def check_csrf_token(request: Request):
    csrf_token = extract_csrf_token(request)

    def _unauthorized():
        raise Unauthorized("CSRF token is missing.")

    if not csrf_token:
        _unauthorized()
    verified = {}
    try:
        verified = PassportService().verify(csrf_token)
    except:
        _unauthorized()

    exp: int | None = verified.get("exp")
    if not exp:
        _unauthorized()
    else:
        time_now = int(datetime.now().timestamp())
        if exp < time_now:
            _unauthorized()


def generate_csrf_token() -> str:
    exp_dt = datetime.now(UTC) + timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "exp": int(exp_dt.timestamp()),
    }
    return PassportService().issue(payload)
