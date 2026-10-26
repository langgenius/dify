"""Request parsing shared by the OAuth protocol endpoints."""

from collections.abc import Callable
from functools import wraps
from urllib.parse import unquote_plus

from flask import request
from werkzeug.exceptions import NotFound


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


def oauth_feature_required[**P, R](flag: Callable[[], bool]) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            if not flag():
                raise NotFound()
            return view(*args, **kwargs)

        return wrapper

    return decorator
