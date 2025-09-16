from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

from .app.app_import import AppImportApi, AppImportCheckDependenciesApi, AppImportConfirmApi
from .explore.audio import ChatAudioApi, ChatTextApi
from .explore.completion import ChatApi, ChatStopApi, CompletionApi, CompletionStopApi
from .explore.conversation import (
    ConversationApi,
    ConversationListApi,
    ConversationPinApi,
    ConversationRenameApi,
    ConversationUnPinApi,
)
from .explore.message import (
    MessageFeedbackApi,
    MessageListApi,
    MessageMoreLikeThisApi,
    MessageSuggestedQuestionApi,
)
from .explore.workflow import (
    InstalledAppWorkflowRunApi,
    InstalledAppWorkflowTaskStopApi,
)
from .files import FileApi, FilePreviewApi, FileSupportTypeApi
from .remote_files import RemoteFileInfoApi, RemoteFileUploadApi

bp = Blueprint("console", __name__, url_prefix="/console/api")

api = ExternalApi(
    bp,
    version="1.0",
    title="Console API",
    description="Console management APIs for app configuration, monitoring, and administration",
)

# Create namespace
console_ns = Namespace("console", description="Console management API operations", path="/")

# File
api.add_resource(FileApi, "/files/upload")
api.add_resource(FilePreviewApi, "/files/<uuid:file_id>/preview")
api.add_resource(FileSupportTypeApi, "/files/support-type")

# Remote files
api.add_resource(RemoteFileInfoApi, "/remote-files/<path:url>")
api.add_resource(RemoteFileUploadApi, "/remote-files/upload")

# Import App
api.add_resource(AppImportApi, "/apps/imports")
api.add_resource(AppImportConfirmApi, "/apps/imports/<string:import_id>/confirm")
api.add_resource(AppImportCheckDependenciesApi, "/apps/imports/<string:app_id>/check-dependencies")

# Import other controllers
from . import (
    admin,
    apikey,
    extension,
    feature,
    init_validate,
    ping,
    setup,
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

# Explore Audio
api.add_resource(ChatAudioApi, "/installed-apps/<uuid:installed_app_id>/audio-to-text", endpoint="installed_app_audio")
api.add_resource(ChatTextApi, "/installed-apps/<uuid:installed_app_id>/text-to-audio", endpoint="installed_app_text")

# Explore Completion
api.add_resource(
    CompletionApi, "/installed-apps/<uuid:installed_app_id>/completion-messages", endpoint="installed_app_completion"
)
api.add_resource(
    CompletionStopApi,
    "/installed-apps/<uuid:installed_app_id>/completion-messages/<string:task_id>/stop",
    endpoint="installed_app_stop_completion",
)
api.add_resource(
    ChatApi, "/installed-apps/<uuid:installed_app_id>/chat-messages", endpoint="installed_app_chat_completion"
)
api.add_resource(
    ChatStopApi,
    "/installed-apps/<uuid:installed_app_id>/chat-messages/<string:task_id>/stop",
    endpoint="installed_app_stop_chat_completion",
)

# Explore Conversation
api.add_resource(
    ConversationRenameApi,
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/name",
    endpoint="installed_app_conversation_rename",
)
api.add_resource(
    ConversationListApi, "/installed-apps/<uuid:installed_app_id>/conversations", endpoint="installed_app_conversations"
)
api.add_resource(
    ConversationApi,
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>",
    endpoint="installed_app_conversation",
)
api.add_resource(
    ConversationPinApi,
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/pin",
    endpoint="installed_app_conversation_pin",
)
api.add_resource(
    ConversationUnPinApi,
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/unpin",
    endpoint="installed_app_conversation_unpin",
)


# Explore Message
api.add_resource(MessageListApi, "/installed-apps/<uuid:installed_app_id>/messages", endpoint="installed_app_messages")
api.add_resource(
    MessageFeedbackApi,
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/feedbacks",
    endpoint="installed_app_message_feedback",
)
api.add_resource(
    MessageMoreLikeThisApi,
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/more-like-this",
    endpoint="installed_app_more_like_this",
)
api.add_resource(
    MessageSuggestedQuestionApi,
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/suggested-questions",
    endpoint="installed_app_suggested_question",
)
# Explore Workflow
api.add_resource(InstalledAppWorkflowRunApi, "/installed-apps/<uuid:installed_app_id>/workflows/run")
api.add_resource(
    InstalledAppWorkflowTaskStopApi, "/installed-apps/<uuid:installed_app_id>/workflows/tasks/<string:task_id>/stop"
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
    "recommended_app",
    "saved_message",
    "setup",
    "site",
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
