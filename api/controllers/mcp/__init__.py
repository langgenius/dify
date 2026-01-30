from quart import Blueprint

from libs.external_api import ExternalApi
from quart_restx import Namespace

bp = Blueprint("mcp", __name__, url_prefix="/mcp")

api = ExternalApi(
    bp,
    version="1.0",
    title="MCP API",
    description="API for Model Context Protocol operations",
)

mcp_ns = Namespace("mcp", description="MCP operations", path="/")

from . import mcp

api.add_namespace(mcp_ns)

__all__ = [
    "api",
    "bp",
    "mcp",
    "mcp_ns",
]
