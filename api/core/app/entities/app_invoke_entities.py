from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from constants import UUID_NIL
from core.app.app_config.entities import EasyUIBasedAppConfig, WorkflowUIBasedAppConfig
from core.entities.provider_configuration import ProviderModelBundle
from core.file import File, FileUploadConfig
from core.model_runtime.entities.model_entities import AIModelEntity

if TYPE_CHECKING:
    from core.ops.ops_trace_manager import TraceQueueManager


class InvokeFrom(StrEnum):
    """
    Invoke From.
    """

    # SERVICE_API indicates that this invocation is from an API call to Dify app.
    #
    # Description of service api in Dify docs:
    # https://docs.dify.ai/en/guides/application-publishing/developing-with-apis
    SERVICE_API = "service-api"

    # WEB_APP indicates that this invocation is from
    # the web app of the workflow (or chatflow).
    #
    # Description of web app in Dify docs:
    # https://docs.dify.ai/en/guides/application-publishing/launch-your-webapp-quickly/README
    WEB_APP = "web-app"

    # TRIGGER indicates that this invocation is from a trigger.
    # this is used for plugin trigger and webhook trigger.
    TRIGGER = "trigger"

    # EXPLORE indicates that this invocation is from
    # the workflow (or chatflow) explore page.
    EXPLORE = "explore"
    # DEBUGGER indicates that this invocation is from
    # the workflow (or chatflow) edit page.
    DEBUGGER = "debugger"
    # PUBLISHED_PIPELINE indicates that this invocation runs a published RAG pipeline workflow.
    PUBLISHED_PIPELINE = "published"

    # VALIDATION indicates that this invocation is from validation.
    VALIDATION = "validation"

    @classmethod
    def value_of(cls, value: str):
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid invoke from value {value}")

    def to_source(self) -> str:
        """
        Get source of invoke from.

        :return: source
        """
        if self == InvokeFrom.WEB_APP:
            return "web_app"
        elif self == InvokeFrom.DEBUGGER:
            return "dev"
        elif self == InvokeFrom.EXPLORE:
            return "explore_app"
        elif self == InvokeFrom.TRIGGER:
            return "trigger"
        elif self == InvokeFrom.SERVICE_API:
            return "api"

        return "dev"


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
    trace_manager: Optional["TraceQueueManager"] = None


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
