from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("cli_api", __name__, url_prefix="/cli/api")

api = ExternalApi(
    bp,
    version="1.0",
    title="CLI API",
    description="APIs for Dify CLI to call back from external sandbox environments (e.g., e2b)",
)

# Create namespace
cli_api_ns = Namespace("cli_api", description="CLI API operations", path="/")

from .plugin import plugin as _plugin

api.add_namespace(cli_api_ns)

__all__ = [
    "_plugin",
    "api",
    "bp",
    "cli_api_ns",
]
