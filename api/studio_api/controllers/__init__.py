from studio_api.blueprint import studio_api, studio_bp, studio_ns

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

from .agent import composer as agent_composer, roster as agent_roster

from .socketio import workflow as socketio_workflow

studio_api.add_namespace(studio_ns)

__all__ = [
    "advanced_prompt_template",
    "agent",
    "agent_composer",
    "agent_roster",
    "annotation",
    "app",
    "app_import",
    "audio",
    "completion",
    "conversation",
    "conversation_variables",
    "generator",
    "mcp_server",
    "message",
    "model_config",
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
