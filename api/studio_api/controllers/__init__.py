from controllers.console import console_ns

from studio_api.blueprint import studio_api, studio_bp, studio_ns

from .agent import composer as agent_composer
from .agent import roster as agent_roster

# Import all studio controllers so their route decorators are evaluated
from .app import (
    advanced_prompt_template,
    agent,
    annotation,
    app,
    app_import,
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
    workflow_comment,
    workflow_draft_variable,
    workflow_run,
    workflow_statistic,
    workflow_trigger,
)
from .socketio import workflow as socketio_workflow

# Shared auth controllers — imported so their routes are available on /studio/api/ too.
# They register on console_ns, which is added to both blueprints.
from controllers.console.auth import (
    activate,
    data_source_bearer_auth,
    data_source_oauth,
    email_register,
    forgot_password,
    login,
    oauth,
    oauth_server,
)

studio_api.add_namespace(studio_ns)
studio_api.add_namespace(console_ns)

__all__ = [
    "activate",
    "advanced_prompt_template",
    "agent",
    "agent_composer",
    "agent_roster",
    "annotation",
    "app",
    "app_import",
    "audio",
    "completion",
    "console_ns",
    "conversation",
    "conversation_variables",
    "data_source_bearer_auth",
    "data_source_oauth",
    "email_register",
    "forgot_password",
    "generator",
    "login",
    "mcp_server",
    "message",
    "model_config",
    "oauth",
    "oauth_server",
    "ops_trace",
    "site",
    "socketio_workflow",
    "statistic",
    "studio_api",
    "studio_bp",
    "studio_ns",
    "workflow",
    "workflow_app_log",
    "workflow_comment",
    "workflow_draft_variable",
    "workflow_run",
    "workflow_statistic",
    "workflow_trigger",
]
