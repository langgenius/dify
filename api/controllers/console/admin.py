from collections.abc import Callable
from functools import wraps

from flask import request
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from libs.token import extract_access_token


def admin_required[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        if not dify_config.ADMIN_API_KEY:
            raise Unauthorized("API key is invalid.")

        auth_token = extract_access_token(request)
        if not auth_token:
            raise Unauthorized("Authorization header is missing.")
        if auth_token != dify_config.ADMIN_API_KEY:
            raise Unauthorized("API key is invalid.")

        return view(*args, **kwargs)

    return decorated
