"""``/.well-known`` OAuth discovery documents for the OpenAPI group (RFC 8414, RFC 9728)."""

from collections.abc import Callable
from typing import Any

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue
from werkzeug.exceptions import NotFound

from configs import dify_config
from services.oauth_metadata import (
    AUTHORIZATION_SERVER_PATH,
    PROTECTED_RESOURCE_PATH,
    authorization_server_metadata,
    protected_resource_metadata,
)

DISCOVERY_CACHE_CONTROL = "public, max-age=3600"

bp = Blueprint("well_known", __name__)


def _serve(builder: Callable[[str], dict[str, Any]]) -> ResponseReturnValue:
    if not dify_config.ENABLE_OAUTH_BEARER:
        raise NotFound()
    response = jsonify(builder(request.host_url))
    response.headers["Cache-Control"] = DISCOVERY_CACHE_CONTROL
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


@bp.route(AUTHORIZATION_SERVER_PATH, methods=["GET"])
def authorization_server() -> ResponseReturnValue:
    return _serve(authorization_server_metadata)


@bp.route(PROTECTED_RESOURCE_PATH, methods=["GET"])
def protected_resource() -> ResponseReturnValue:
    return _serve(protected_resource_metadata)
