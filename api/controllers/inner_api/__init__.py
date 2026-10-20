from types import ModuleType

from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("inner_api", __name__, url_prefix="/inner/api")

api = ExternalApi(
    bp,
    version="1.0",
    title="Inner API",
    description="Internal APIs for enterprise features, billing, knowledge retrieval, and plugin communication",
    authorizations={
        "InnerApiKey": {
            "type": "apiKey",
            "in": "header",
            "name": "X-Inner-Api-Key",
            "description": "INNER_API_KEY for enterprise callers; INNER_API_KEY_FOR_PLUGIN for plugin/agent callers.",
        }
    },
    security="InnerApiKey",
)

# Create namespace
inner_api_ns = Namespace("inner_api", description="Internal API operations", path="/")


def _register_controllers() -> tuple[ModuleType, ...]:
    """Load route modules after their namespace exists."""

    from . import mail, model_billing_migration, runtime_credentials
    from .agent import files, llm, runtime_usage, tools, tracing
    from .app import app, dsl, file_grants
    from .knowledge import retrieval
    from .plugin import agent_config, plugin, skills
    from .workspace import workspace

    return (
        mail,
        model_billing_migration,
        runtime_credentials,
        files,
        llm,
        runtime_usage,
        tools,
        tracing,
        app,
        dsl,
        file_grants,
        retrieval,
        agent_config,
        plugin,
        skills,
        workspace,
    )


(
    _mail,
    _model_billing_migration,
    _runtime_credentials,
    _agent_files,
    _agent_llm,
    _agent_runtime_usage,
    _agent_tools,
    _agent_tracing,
    _app_app,
    _app_dsl,
    _app_file_grants,
    _knowledge_retrieval,
    _agent_config,
    _plugin,
    _skills,
    _workspace,
) = _register_controllers()

api.add_namespace(inner_api_ns)

__all__ = [
    "_agent_config",
    "_agent_files",
    "_agent_llm",
    "_agent_runtime_usage",
    "_agent_tools",
    "_app_app",
    "_app_dsl",
    "_app_file_grants",
    "_knowledge_retrieval",
    "_mail",
    "_model_billing_migration",
    "_plugin",
    "_runtime_credentials",
    "_skills",
    "_workspace",
    "api",
    "bp",
    "inner_api_ns",
]
