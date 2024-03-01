from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel

from core.app.app_config.entities import EasyUIBasedAppConfig, WorkflowUIBasedAppConfig
from core.entities.provider_configuration import ProviderModelBundle
from core.file.file_obj import FileObj
from core.model_runtime.entities.model_entities import AIModelEntity


class InvokeFrom(Enum):
    """
    Invoke From.
    """
    SERVICE_API = 'service-api'
    WEB_APP = 'web-app'
    EXPLORE = 'explore'
    DEBUGGER = 'debugger'

    @classmethod
    def value_of(cls, value: str) -> 'InvokeFrom':
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f'invalid invoke from value {value}')

    def to_source(self) -> str:
        """
        Get source of invoke from.

        :return: source
        """
        if self == InvokeFrom.WEB_APP:
            return 'web_app'
        elif self == InvokeFrom.DEBUGGER:
            return 'dev'
        elif self == InvokeFrom.EXPLORE:
            return 'explore_app'
        elif self == InvokeFrom.SERVICE_API:
            return 'api'

        return 'dev'


class EasyUIBasedModelConfigEntity(BaseModel):
    """
    Model Config Entity.
    """
    provider: str
    model: str
    model_schema: AIModelEntity
    mode: str
    provider_model_bundle: ProviderModelBundle
    credentials: dict[str, Any] = {}
    parameters: dict[str, Any] = {}
    stop: list[str] = []


class EasyUIBasedAppGenerateEntity(BaseModel):
    """
    EasyUI Based Application Generate Entity.
    """
    task_id: str

    # app config
    app_config: EasyUIBasedAppConfig
    model_config: EasyUIBasedModelConfigEntity

    conversation_id: Optional[str] = None
    inputs: dict[str, str]
    query: Optional[str] = None
    files: list[FileObj] = []
    user_id: str
    # extras
    stream: bool
    invoke_from: InvokeFrom

    # extra parameters, like: auto_generate_conversation_name
    extras: dict[str, Any] = {}


class WorkflowUIBasedAppGenerateEntity(BaseModel):
    """
    Workflow UI Based Application Generate Entity.
    """
    task_id: str

    # app config
    app_config: WorkflowUIBasedAppConfig

    inputs: dict[str, str]
    files: list[FileObj] = []
    user_id: str
    # extras
    stream: bool
    invoke_from: InvokeFrom

    # extra parameters
    extras: dict[str, Any] = {}


class AdvancedChatAppGenerateEntity(WorkflowUIBasedAppGenerateEntity):
    conversation_id: Optional[str] = None
    query: str
