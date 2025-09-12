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
    admin,  # pyright: ignore[reportUnusedImport]
    apikey,  # pyright: ignore[reportUnusedImport]
    extension,  # pyright: ignore[reportUnusedImport]
    feature,  # pyright: ignore[reportUnusedImport]
    init_validate,  # pyright: ignore[reportUnusedImport]
    ping,  # pyright: ignore[reportUnusedImport]
    setup,  # pyright: ignore[reportUnusedImport]
    version,  # pyright: ignore[reportUnusedImport]
)

# Import app controllers
from .app import (
    advanced_prompt_template,  # pyright: ignore[reportUnusedImport]
    agent,  # pyright: ignore[reportUnusedImport]
    annotation,  # pyright: ignore[reportUnusedImport]
    app,  # pyright: ignore[reportUnusedImport]
    audio,  # pyright: ignore[reportUnusedImport]
    completion,  # pyright: ignore[reportUnusedImport]
    conversation,  # pyright: ignore[reportUnusedImport]
    conversation_variables,  # pyright: ignore[reportUnusedImport]
    generator,  # pyright: ignore[reportUnusedImport]
    mcp_server,  # pyright: ignore[reportUnusedImport]
    message,  # pyright: ignore[reportUnusedImport]
    model_config,  # pyright: ignore[reportUnusedImport]
    ops_trace,  # pyright: ignore[reportUnusedImport]
    site,  # pyright: ignore[reportUnusedImport]
    statistic,  # pyright: ignore[reportUnusedImport]
    workflow,  # pyright: ignore[reportUnusedImport]
    workflow_app_log,  # pyright: ignore[reportUnusedImport]
    workflow_draft_variable,  # pyright: ignore[reportUnusedImport]
    workflow_run,  # pyright: ignore[reportUnusedImport]
    workflow_statistic,  # pyright: ignore[reportUnusedImport]
)

# Import auth controllers
from .auth import (
    activate,  # pyright: ignore[reportUnusedImport]
    data_source_bearer_auth,  # pyright: ignore[reportUnusedImport]
    data_source_oauth,  # pyright: ignore[reportUnusedImport]
    email_register,  # pyright: ignore[reportUnusedImport]
    forgot_password,  # pyright: ignore[reportUnusedImport]
    login,  # pyright: ignore[reportUnusedImport]
    oauth,  # pyright: ignore[reportUnusedImport]
    oauth_server,  # pyright: ignore[reportUnusedImport]
)

# Import billing controllers
from .billing import billing, compliance  # pyright: ignore[reportUnusedImport]

# Import datasets controllers
from .datasets import (
    data_source,  # pyright: ignore[reportUnusedImport]
    datasets,  # pyright: ignore[reportUnusedImport]
    datasets_document,  # pyright: ignore[reportUnusedImport]
    datasets_segments,  # pyright: ignore[reportUnusedImport]
    external,  # pyright: ignore[reportUnusedImport]
    hit_testing,  # pyright: ignore[reportUnusedImport]
    metadata,  # pyright: ignore[reportUnusedImport]
    website,  # pyright: ignore[reportUnusedImport]
)

# Import explore controllers
from .explore import (
    installed_app,  # pyright: ignore[reportUnusedImport]
    parameter,  # pyright: ignore[reportUnusedImport]
    recommended_app,  # pyright: ignore[reportUnusedImport]
    saved_message,  # pyright: ignore[reportUnusedImport]
)

# Import tag controllers
from .tag import tags  # pyright: ignore[reportUnusedImport]

# Import workspace controllers
from .workspace import (
    account,  # pyright: ignore[reportUnusedImport]
    agent_providers,  # pyright: ignore[reportUnusedImport]
    endpoint,  # pyright: ignore[reportUnusedImport]
    load_balancing_config,  # pyright: ignore[reportUnusedImport]
    members,  # pyright: ignore[reportUnusedImport]
    model_providers,  # pyright: ignore[reportUnusedImport]
    models,  # pyright: ignore[reportUnusedImport]
    plugin,  # pyright: ignore[reportUnusedImport]
    tool_providers,  # pyright: ignore[reportUnusedImport]
    workspace,  # pyright: ignore[reportUnusedImport]
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
