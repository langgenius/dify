from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("openapi", __name__, url_prefix="/openapi/v1")

api = ExternalApi(
    bp,
    version="1.0",
    title="OpenAPI",
    description="User-scoped programmatic API (bearer auth)",
)

openapi_ns = Namespace("openapi", description="User-scoped operations", path="/")

from . import index
from .oauth_device import code as oauth_device_code
from .oauth_device import lookup as oauth_device_lookup
from .oauth_device import token as oauth_device_token

__all__ = [
    "index",
    "oauth_device_code",
    "oauth_device_lookup",
    "oauth_device_token",
]

api.add_namespace(openapi_ns)
