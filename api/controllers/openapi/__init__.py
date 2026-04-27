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

from . import account, index
from .oauth_device import approval_context as oauth_device_approval_context
from .oauth_device import approve as oauth_device_approve
from .oauth_device import approve_external as oauth_device_approve_external
from .oauth_device import code as oauth_device_code
from .oauth_device import deny as oauth_device_deny
from .oauth_device import lookup as oauth_device_lookup
from .oauth_device import sso_complete as oauth_device_sso_complete
from .oauth_device import sso_initiate as oauth_device_sso_initiate
from .oauth_device import token as oauth_device_token

__all__ = [
    "account",
    "index",
    "oauth_device_approval_context",
    "oauth_device_approve",
    "oauth_device_approve_external",
    "oauth_device_code",
    "oauth_device_deny",
    "oauth_device_lookup",
    "oauth_device_sso_complete",
    "oauth_device_sso_initiate",
    "oauth_device_token",
]

api.add_namespace(openapi_ns)
