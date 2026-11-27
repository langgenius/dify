from types import ModuleType

from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("mcp", __name__, url_prefix="/mcp")

api = ExternalApi(
    bp,
    version="1.0",
    title="MCP API",
    description="API for Model Context Protocol operations",
)

mcp_ns = Namespace("mcp", description="MCP operations", path="/")


def _register_controllers() -> tuple[ModuleType, ...]:
    """Load route modules after their namespaces and schema models exist."""

    from . import knowledge_agent, mcp

    return (knowledge_agent, mcp)


(knowledge_agent, mcp) = _register_controllers()

api.add_namespace(mcp_ns)

__all__ = [
    "api",
    "bp",
    "knowledge_agent",
    "mcp",
    "mcp_ns",
]
