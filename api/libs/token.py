from flask import Request, Response

from configs import dify_config
from constants import COOKIE_NAME_ACCESS_TOKEN, COOKIE_NAME_REFRESH_TOKEN, COOKIE_NAME_PASSPORT


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


def extract_access_token(request: Request) -> str | None:
    """
    Try to extract access token from cookie, header or params.

    Access token is either for console session or webapp passport exchange.
    """
    def _try_extract_from_cookie(request: Request) -> str | None:
        return request.cookies.get(COOKIE_NAME_ACCESS_TOKEN)

    def _try_extract_from_query(request: Request) -> str | None:
        return request.args.get("_token")
    ret = (
        _try_extract_from_cookie(request) 
        or 
        _try_extract_from_header(request) 
        or 
        _try_extract_from_query(request) 
    )
    return ret


def extract_webapp_passport(request: Request) -> str | None:
    """
    Try to extract app token from header or params.

    Webapp access token (part of passport) is only used for webapp session.
    """
    def _try_extract_passport_token_from_query(request: Request) -> str | None:
        # This is unsafe, leave it for backward compatibility
        return request.args.get("web_app_access_token")

    def _try_extract_passport_token_from_cookie(request: Request) -> str | None:
        return request.cookies.get(COOKIE_NAME_PASSPORT)

    ret = (
        _try_extract_passport_token_from_cookie(request)
        or
        _try_extract_from_header(request) 
        or 
        _try_extract_passport_token_from_query(request) 
    )
    return ret


def set_access_token_to_cookie(request: Request, response: Response, token: str):
    response.set_cookie(
        COOKIE_NAME_ACCESS_TOKEN,
        value=token,
        httponly=True,
        secure=request.is_secure,
        samesite="Lax",
        # TODO: maybe configurable?
        max_age=60 * 60 * 24,
        path="/",
    )


def set_refresh_token_to_cookie(request: Request, response: Response, token: str):
    response.set_cookie(
        COOKIE_NAME_REFRESH_TOKEN,
        value=token,
        httponly=True,
        secure=request.is_secure,
        samesite="Lax",
        max_age=int(60 * 60 * 24 * dify_config.REFRESH_TOKEN_EXPIRE_DAYS),
        path="/",
    )

def set_webapp_token_to_cookie(request: Request, response: Response, token: str):
    response.set_cookie(
        COOKIE_NAME_PASSPORT,
        value=token,
        httponly=True,
        secure=request.is_secure,
        samesite="Lax",
        max_age=60 * 60 * 24,
        path="/",
    )

def clear_webapp_token_from_cookie(request: Request, response: Response):
    response.set_cookie(
        COOKIE_NAME_PASSPORT,
        "",
        expires=0,
        path="/",
        secure=request.is_secure,
        httponly=True,
        samesite="Lax",
    )


def clear_access_token_from_cookie(request: Request, response: Response):
    response.set_cookie(
        COOKIE_NAME_ACCESS_TOKEN,
        "",
        expires=0,
        path="/",
        secure=request.is_secure,
        httponly=True,
        samesite="Lax",
    )


def clear_refresh_token_from_cookie(request: Request, response: Response):
    response.set_cookie(
        COOKIE_NAME_REFRESH_TOKEN,
        "",
        expires=0,
        path="/",
        secure=request.is_secure,
        httponly=True,
        samesite="Lax",
    )
