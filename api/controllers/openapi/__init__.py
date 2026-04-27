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

__all__ = [
    "index",
]

api.add_namespace(openapi_ns)
