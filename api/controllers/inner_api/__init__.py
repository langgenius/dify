from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("inner_api", __name__, url_prefix="/inner/api")

api = ExternalApi(
    bp,
    version="1.0",
    title="Inner API",
    description="Internal APIs for enterprise features, billing, and plugin communication",
    doc="/docs",  # Enable Swagger UI at /inner/api/docs
)

# Create namespace
inner_api_ns = Namespace("inner_api", description="Internal API operations", path="/")

from . import mail as _mail  # pyright: ignore[reportUnusedImport]  # noqa: F401
from .plugin import plugin as _plugin  # pyright: ignore[reportUnusedImport]  # noqa: F401
from .workspace import workspace as _workspace  # pyright: ignore[reportUnusedImport]  # noqa: F401

api.add_namespace(inner_api_ns)
