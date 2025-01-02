from collections.abc import Mapping, Sequence
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from constants import UUID_NIL
from core.app.app_config.entities import EasyUIBasedAppConfig, WorkflowUIBasedAppConfig
from core.entities.provider_configuration import ProviderModelBundle
from core.file import File, FileUploadConfig
from core.model_runtime.entities.model_entities import AIModelEntity
from core.ops.ops_trace_manager import TraceQueueManager


class InvokeFrom(Enum):
    """
    Invoke From.
    """

    SERVICE_API = "service-api"
    WEB_APP = "web-app"
    EXPLORE = "explore"
    DEBUGGER = "debugger"

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
    credentials: dict[str, Any] = {}
    parameters: dict[str, Any] = {}
    stop: list[str] = []

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class AppGenerateEntity(BaseModel):
    """
    App Generate Entity.
    """

    task_id: str

    # app config
    app_config: Any
    file_upload_config: Optional[FileUploadConfig] = None

    inputs: Mapping[str, Any]
    files: Sequence[File]
    user_id: str

    # extras
    stream: bool
    invoke_from: InvokeFrom

    # invoke call depth
    call_depth: int = 0

    # extra parameters, like: auto_generate_conversation_name
    extras: dict[str, Any] = {}

    # tracing instance
    trace_manager: Optional[TraceQueueManager] = None

    class Config:
        arbitrary_types_allowed = True


class EasyUIBasedAppGenerateEntity(AppGenerateEntity):
    """
    Chat Application Generate Entity.
    """

    # app config
    app_config: EasyUIBasedAppConfig
    model_conf: ModelConfigWithCredentialsEntity

    query: Optional[str] = None

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class ConversationAppGenerateEntity(AppGenerateEntity):
    """
    Base entity for conversation-based app generation.
    """

    conversation_id: Optional[str] = None
    parent_message_id: Optional[str] = Field(
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
    app_config: WorkflowUIBasedAppConfig

    workflow_run_id: Optional[str] = None
    query: str

    class SingleIterationRunEntity(BaseModel):
        """
        Single Iteration Run Entity.
        """

        node_id: str
        inputs: dict

    single_iteration_run: Optional[SingleIterationRunEntity] = None


class WorkflowAppGenerateEntity(AppGenerateEntity):
    """
    Workflow Application Generate Entity.
    """

    # app config
    app_config: WorkflowUIBasedAppConfig
    workflow_run_id: str

    class SingleIterationRunEntity(BaseModel):
        """
        Single Iteration Run Entity.
        """

        node_id: str
        inputs: dict

    single_iteration_run: Optional[SingleIterationRunEntity] = None
