from base64 import b64encode
from collections.abc import Callable
from functools import wraps
from hashlib import sha1
from hmac import new as hmac_new
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")
from flask import abort, request

from configs import dify_config
from extensions.ext_database import db
from models.model import EndUser


def billing_inner_api_only(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        if not dify_config.INNER_API:
            abort(404)

        # get header 'X-Inner-Api-Key'
        inner_api_key = request.headers.get("X-Inner-Api-Key")
        if not inner_api_key or inner_api_key != dify_config.INNER_API_KEY:
            abort(401)

        return view(*args, **kwargs)

    return decorated


def enterprise_inner_api_only(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        if not dify_config.INNER_API:
            abort(404)

        # get header 'X-Inner-Api-Key'
        inner_api_key = request.headers.get("X-Inner-Api-Key")
        if not inner_api_key or inner_api_key != dify_config.INNER_API_KEY:
            abort(401)

        return view(*args, **kwargs)

    return decorated


def enterprise_inner_api_user_auth(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        if not dify_config.INNER_API:
            return view(*args, **kwargs)

        # get header 'X-Inner-Api-Key'
        authorization = request.headers.get("Authorization")
        if not authorization:
            return view(*args, **kwargs)

        parts = authorization.split(":")
        if len(parts) != 2:
            return view(*args, **kwargs)

        user_id, token = parts
        if " " in user_id:
            user_id = user_id.split(" ")[1]

        inner_api_key = request.headers.get("X-Inner-Api-Key", "")

        data_to_sign = f"DIFY {user_id}"

        signature = hmac_new(inner_api_key.encode("utf-8"), data_to_sign.encode("utf-8"), sha1)
        signature_base64 = b64encode(signature.digest()).decode("utf-8")

        if signature_base64 != token:
            return view(*args, **kwargs)

        kwargs["user"] = db.session.query(EndUser).where(EndUser.id == user_id).first()

        return view(*args, **kwargs)

    return decorated


def plugin_inner_api_only(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        if not dify_config.PLUGIN_DAEMON_KEY:
            abort(404)

        # get header 'X-Inner-Api-Key'
        inner_api_key = request.headers.get("X-Inner-Api-Key")
        if not inner_api_key or inner_api_key != dify_config.INNER_API_KEY_FOR_PLUGIN:
            abort(404)

        return view(*args, **kwargs)

    return decorated
