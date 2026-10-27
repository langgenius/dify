"""Request parsing shared by the OAuth protocol endpoints."""

from collections.abc import Callable
from functools import wraps
from http import HTTPStatus
from urllib.parse import unquote_plus

from flask import request
from werkzeug.exceptions import NotFound

from configs import dify_config
from services.oauth_token_contracts import TokenEndpointError

NO_STORE_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache"}
BASIC_CHALLENGE = 'Basic realm="dify-openapi"'


class InvalidOAuthBodyError(Exception):
    """A JSON field is neither a string nor null."""


def read_oauth_body() -> dict[str, str]:
    if request.is_json:
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return {}
        fields = {key: value for key, value in body.items() if value is not None}
        if not all(isinstance(value, str) for value in fields.values()):
            raise InvalidOAuthBodyError
        return fields
    return request.form.to_dict(flat=True)


def basic_client_credentials() -> tuple[str, str] | None:
    authorization = request.authorization
    if authorization is None:
        return None
    if authorization.type != "basic":
        return None
    if authorization.username is None or authorization.password is None:
        return None
    return unquote_plus(authorization.username), unquote_plus(authorization.password)


def client_credentials(body: dict[str, str]) -> tuple[str | None, str | None]:
    """``client_secret_basic`` wins over ``client_secret_post``."""
    client_id, client_secret = basic_client_credentials() or (body.get("client_id"), body.get("client_secret"))
    # An empty secret (form `client_secret=` or Basic `id:`) means none was sent.
    return client_id, client_secret or None


def token_error_response(error: TokenEndpointError) -> tuple[dict[str, str], HTTPStatus, dict[str, str]]:
    """RFC 6749 §5.2 error body; a 401 carries the Basic challenge."""
    headers = dict(NO_STORE_HEADERS)
    if error.status == HTTPStatus.UNAUTHORIZED:
        headers["WWW-Authenticate"] = BASIC_CHALLENGE
    return {"error": error.code.value}, error.status, headers


def oauth_feature_required[**P, R](flag: Callable[[], bool]) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            if not flag():
                raise NotFound()
            return view(*args, **kwargs)

        return wrapper

    return decorator


def authorization_code_enabled() -> bool:
    return dify_config.ENABLE_OAUTH_AUTHORIZATION_CODE


def dcr_enabled() -> bool:
    return dify_config.ENABLE_OAUTH_DCR
