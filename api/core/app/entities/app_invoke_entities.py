from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationInfo, field_validator

from constants import UUID_NIL
from core.app.app_config.entities import EasyUIBasedAppConfig, WorkflowUIBasedAppConfig
from core.entities.provider_configuration import ProviderModelBundle
from graphon.file import File, FileUploadConfig
from graphon.model_runtime.entities.model_entities import AIModelEntity

if TYPE_CHECKING:
    from core.ops.ops_trace_manager import TraceQueueManager


DIFY_RUN_CONTEXT_KEY = "_dify"
AGENT_RUNTIME_EXIT_INTENT_ARG = "_agent_runtime_exit_intent"
AgentRuntimeExitIntent: TypeAlias = Literal["suspend", "delete"]


class UserFrom(StrEnum):
    ACCOUNT = "account"
    END_USER = "end-user"


class InvokeFrom(StrEnum):
    SERVICE_API = "service-api"
    OPENAPI = "openapi"
    WEB_APP = "web-app"
    TRIGGER = "trigger"
    EXPLORE = "explore"
    DEBUGGER = "debugger"
    PUBLISHED_PIPELINE = "published"
    VALIDATION = "validation"

    @classmethod
    def value_of(cls, value: str) -> "InvokeFrom":
        return cls(value)

    def to_source(self) -> str:
        source_mapping = {
            InvokeFrom.WEB_APP: "web_app",
            InvokeFrom.DEBUGGER: "dev",
            InvokeFrom.EXPLORE: "explore_app",
            InvokeFrom.TRIGGER: "trigger",
            InvokeFrom.SERVICE_API: "api",
            InvokeFrom.OPENAPI: "openapi",
        }
        return source_mapping.get(self, "dev")

    def runs_as_account(self) -> bool:
        """Whether a run from this entry point is attributed to a workspace
        Account rather than an end user. Console contexts (debugger/explore)
        run as the signed-in Account; webapp/service-api/trigger run as an
        EndUser. Single source of truth for the created-by-role / user-type
        split shared by the app runners and MCP identity forwarding."""
        return self in (InvokeFrom.DEBUGGER, InvokeFrom.EXPLORE)


class DifyRunContext(BaseModel):
    tenant_id: str
    app_id: str
    user_id: str
    user_from: UserFrom
    invoke_from: InvokeFrom
    trace_session_id: str | None = None


def build_dify_run_context(
    *,
    tenant_id: str,
    app_id: str,
    user_id: str,
    user_from: UserFrom,
    invoke_from: InvokeFrom,
    trace_session_id: str | None = None,
    extra_context: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Build graph run_context with the reserved Dify runtime payload.

    `extra_context` can carry user-defined context keys. The reserved `_dify`
    payload is always overwritten by this function to keep one canonical source.
    """
    run_context = dict(extra_context) if extra_context else {}
    run_context[DIFY_RUN_CONTEXT_KEY] = DifyRunContext(
        tenant_id=tenant_id,
        app_id=app_id,
        user_id=user_id,
        user_from=user_from,
        invoke_from=invoke_from,
        trace_session_id=trace_session_id,
    )
    return run_context


class ModelConfigWithCredentialsEntity(BaseModel):
    """
    Model Config With Credentials Entity.
    """

    provider: str
    model: str
    model_schema: AIModelEntity
    mode: str
    provider_model_bundle: ProviderModelBundle
    credentials: dict[str, Any] = Field(default_factory=dict)
    parameters: dict[str, Any] = Field(default_factory=dict)
    stop: list[str] = Field(default_factory=list)

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class AppGenerateEntity(BaseModel):
    """
    App Generate Entity.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    task_id: str

    # app config
    app_config: Any = None
    file_upload_config: FileUploadConfig | None = None

    inputs: Mapping[str, Any]
    files: Sequence[File]

    # Unique identifier of the user initiating the execution.
    # This corresponds to `Account.id` for platform users or `EndUser.id` for end users.
    #
    # Note: The `user_id` field does not indicate whether the user is a platform user or an end user.
    user_id: str

    # extras
    stream: bool
    invoke_from: InvokeFrom

    # invoke call depth
    call_depth: int = 0

    # extra parameters, like: auto_generate_conversation_name
    extras: dict[str, Any] = Field(default_factory=dict)

    # tracing instance
    trace_manager: "TraceQueueManager | None" = Field(default=None, exclude=True, repr=False)


class EasyUIBasedAppGenerateEntity(AppGenerateEntity):
    """
    Chat Application Generate Entity.
    """

    # app config
    app_config: EasyUIBasedAppConfig = None  # type: ignore
    model_conf: ModelConfigWithCredentialsEntity

    query: str = ""

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class ConversationAppGenerateEntity(AppGenerateEntity):
    """
    Base entity for conversation-based app generation.
    """

    conversation_id: str | None = None
    is_new_conversation: bool = False
    parent_message_id: str | None = Field(
        default=None,
        description=(
            "Starting from v0.9.0, parent_message_id is used to support message regeneration for internal chat API."
            "For service API, we need to ensure its forward compatibility, "
            "so passing in the parent_message_id as request arg is not supported for now. "
            "It needs to be set to UUID_NIL so that the subsequent processing will treat it as legacy messages."
        ),
    )

    @field_validator("parent_message_id")
    @classmethod
    def validate_parent_message_id(cls, v, info: ValidationInfo):
        if info.data.get("invoke_from") == InvokeFrom.SERVICE_API and v != UUID_NIL:
            raise ValueError("parent_message_id should be UUID_NIL for service API")
        return v


class ChatAppGenerateEntity(ConversationAppGenerateEntity, EasyUIBasedAppGenerateEntity):
    """
    Chat Application Generate Entity.
    """

    pass


class CompletionAppGenerateEntity(EasyUIBasedAppGenerateEntity):
    """
    Completion Application Generate Entity.
    """

    pass


class AgentChatAppGenerateEntity(ConversationAppGenerateEntity, EasyUIBasedAppGenerateEntity):
    """
    Agent Chat Application Generate Entity.
    """

    pass


class AgentAppGenerateEntity(ChatAppGenerateEntity):
    """
    Agent App (new Agent app type) Generate Entity.

    Subclasses ``ChatAppGenerateEntity`` so it rides the exact same EasyUI chat
    pipeline (generator, task pipeline, message cycle) without widening every
    accepted-entity union. The answer is produced by the dify-agent backend
    rather than an in-process LLM call; ``model_conf`` is synthesized from the
    bound Agent Soul model so the chat task pipeline can persist usage.

    ``agent_config_version_kind`` selects which Agent config surface the
    backend should read from: immutable snapshot, shared draft, or per-user
    build draft.

    ``agent_runtime_session_snapshot_id`` carries the runtime session scope
    used to resume or suspend within the same editable config surface.

    ``agent_runtime_exit_intent`` is API-internal lifecycle policy for the
    Agent backend session after this turn finishes. Normal chat/resume turns
    suspend on exit; build-chat finalization deletes the backend runtime.

    ``prompt_file_mappings`` preserves the raw request ``files`` array for the
    Agent backend prompt. These references are appended to the backend prompt
    text while the stored chat message keeps the user's original query.
    """

    agent_id: str
    agent_config_snapshot_id: str
    agent_config_version_kind: Literal["snapshot", "draft", "build_draft"] = "snapshot"
    agent_runtime_session_snapshot_id: str | None = None
    agent_runtime_exit_intent: AgentRuntimeExitIntent = "suspend"
    prompt_file_mappings: Sequence[JsonValue] = Field(default_factory=list)


class AdvancedChatAppGenerateEntity(ConversationAppGenerateEntity):
    """
    Advanced Chat Application Generate Entity.
    """

    # app config
    app_config: WorkflowUIBasedAppConfig = None  # type: ignore

    workflow_run_id: str | None = None
    query: str

    class SingleIterationRunEntity(BaseModel):
        """
        Single Iteration Run Entity.
        """

        node_id: str
        inputs: Mapping

    single_iteration_run: SingleIterationRunEntity | None = None

    class SingleLoopRunEntity(BaseModel):
        """
        Single Loop Run Entity.
        """

        node_id: str
        inputs: Mapping

    single_loop_run: SingleLoopRunEntity | None = None


class WorkflowAppGenerateEntity(AppGenerateEntity):
    """
    Workflow Application Generate Entity.
    """

    # app config
    app_config: WorkflowUIBasedAppConfig = None  # type: ignore
    workflow_execution_id: str

    class SingleIterationRunEntity(BaseModel):
        """
        Single Iteration Run Entity.
        """

        node_id: str
        inputs: dict

    single_iteration_run: SingleIterationRunEntity | None = None

    class SingleLoopRunEntity(BaseModel):
        """
        Single Loop Run Entity.
        """

        node_id: str
        inputs: dict

    single_loop_run: SingleLoopRunEntity | None = None


class RagPipelineGenerateEntity(WorkflowAppGenerateEntity):
    """
    RAG Pipeline Application Generate Entity.
    """

    # pipeline config
    pipeline_config: WorkflowUIBasedAppConfig
    datasource_type: str
    datasource_info: Mapping[str, Any]
    dataset_id: str
    batch: str
    document_id: str | None = None
    original_document_id: str | None = None
    start_node_id: str | None = None


from core.ops.ops_trace_manager import TraceQueueManager

AppGenerateEntity.model_rebuild()
EasyUIBasedAppGenerateEntity.model_rebuild()
ConversationAppGenerateEntity.model_rebuild()
ChatAppGenerateEntity.model_rebuild()
CompletionAppGenerateEntity.model_rebuild()
AgentChatAppGenerateEntity.model_rebuild()
AdvancedChatAppGenerateEntity.model_rebuild()
WorkflowAppGenerateEntity.model_rebuild()
RagPipelineGenerateEntity.model_rebuild()
