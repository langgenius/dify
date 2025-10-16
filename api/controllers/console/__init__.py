from importlib import import_module

from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("console", __name__, url_prefix="/console/api")

api = ExternalApi(
    bp,
    version="1.0",
    title="Console API",
    description="Console management APIs for app configuration, monitoring, and administration",
)

console_ns = Namespace("console", description="Console management API operations", path="/")

RESOURCE_MODULES = (
    "controllers.console.app.app_import",
    "controllers.console.explore.audio",
    "controllers.console.explore.completion",
    "controllers.console.explore.conversation",
    "controllers.console.explore.message",
    "controllers.console.explore.workflow",
    "controllers.console.files",
    "controllers.console.remote_files",
)

for module_name in RESOURCE_MODULES:
    import_module(module_name)

# Ensure resource modules are imported so route decorators are evaluated.
# Import other controllers
from . import (
    admin,
    apikey,
    extension,
    feature,
    init_validate,
    ping,
    setup,
    spec,
    version,
)

# Import app controllers
from .app import (
    advanced_prompt_template,
    agent,
    annotation,
    app,
    audio,
    completion,
    conversation,
    conversation_variables,
    generator,
    mcp_server,
    message,
    model_config,
    ops_trace,
    site,
    statistic,
    workflow,
    workflow_app_log,
    workflow_draft_variable,
    workflow_run,
    workflow_statistic,
)

# Import auth controllers
from .auth import (
    activate,
    data_source_bearer_auth,
    data_source_oauth,
    email_register,
    forgot_password,
    login,
    oauth,
    oauth_server,
)

# Import billing controllers
from .billing import billing, compliance

# Import datasets controllers
from .datasets import (
    data_source,
    datasets,
    datasets_document,
    datasets_segments,
    external,
    hit_testing,
    metadata,
    website,
)
from .datasets.rag_pipeline import (
    datasource_auth,
    datasource_content_preview,
    rag_pipeline,
    rag_pipeline_datasets,
    rag_pipeline_draft_variable,
    rag_pipeline_import,
    rag_pipeline_workflow,
)

# Import explore controllers
from .explore import (
    installed_app,
    parameter,
    recommended_app,
    saved_message,
)

# Import tag controllers
from .tag import tags

# Import workspace controllers
from .workspace import (
    account,
    agent_providers,
    endpoint,
    load_balancing_config,
    members,
    model_providers,
    models,
    plugin,
    tool_providers,
    workspace,
)

api.add_namespace(console_ns)

__all__ = [
    "account",
    "activate",
    "admin",
    "advanced_prompt_template",
    "agent",
    "agent_providers",
    "annotation",
    "api",
    "apikey",
    "app",
    "audio",
    "billing",
    "bp",
    "completion",
    "compliance",
    "console_ns",
    "conversation",
    "conversation_variables",
    "data_source",
    "data_source_bearer_auth",
    "data_source_oauth",
    "datasets",
    "datasets_document",
    "datasets_segments",
    "datasource_auth",
    "datasource_content_preview",
    "email_register",
    "endpoint",
    "extension",
    "external",
    "feature",
    "forgot_password",
    "generator",
    "hit_testing",
    "init_validate",
    "installed_app",
    "load_balancing_config",
    "login",
    "mcp_server",
    "members",
    "message",
    "metadata",
    "model_config",
    "model_providers",
    "models",
    "oauth",
    "oauth_server",
    "ops_trace",
    "parameter",
    "ping",
    "plugin",
    "rag_pipeline",
    "rag_pipeline_datasets",
    "rag_pipeline_draft_variable",
    "rag_pipeline_import",
    "rag_pipeline_workflow",
    "recommended_app",
    "saved_message",
    "setup",
    "site",
    "spec",
    "statistic",
    "tags",
    "tool_providers",
    "version",
    "website",
    "workflow",
    "workflow_app_log",
    "workflow_draft_variable",
    "workflow_run",
    "workflow_statistic",
    "workspace",
]
