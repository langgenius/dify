from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("inner_api", __name__, url_prefix="/inner/api")

api = ExternalApi(
    bp,
    version="1.0",
    title="Inner API",
    description="Internal APIs for enterprise features, billing, knowledge retrieval, and plugin communication",
)

# Create namespace
inner_api_ns = Namespace("inner_api", description="Internal API operations", path="/")

from . import mail as _mail
from . import runtime_credentials as _runtime_credentials
from .app import dsl as _app_dsl
from .knowledge import retrieval as _knowledge_retrieval
from .plugin import agent_drive as _agent_drive
from .plugin import plugin as _plugin
from .workspace import workspace as _workspace

api.add_namespace(inner_api_ns)

__all__ = [
    "_agent_drive",
    "_app_dsl",
    "_knowledge_retrieval",
    "_mail",
    "_plugin",
    "_runtime_credentials",
    "_workspace",
    "api",
    "bp",
    "inner_api_ns",
]
