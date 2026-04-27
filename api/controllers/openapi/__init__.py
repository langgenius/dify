from flask import Blueprint
from flask_restx import Namespace

from libs.device_flow_security import attach_anti_framing
from libs.external_api import ExternalApi

bp = Blueprint("openapi", __name__, url_prefix="/openapi/v1")
attach_anti_framing(bp)

api = ExternalApi(
    bp,
    version="1.0",
    title="OpenAPI",
    description="User-scoped programmatic API (bearer auth)",
)

openapi_ns = Namespace("openapi", description="User-scoped operations", path="/")

from . import account, index, oauth_device, oauth_device_sso, workspaces

__all__ = [
    "account",
    "index",
    "oauth_device",
    "oauth_device_sso",
    "workspaces",
]

api.add_namespace(openapi_ns)
