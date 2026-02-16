from __future__ import annotations

import enum
from collections.abc import Mapping, Sequence
from datetime import datetime
from enum import StrEnum
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from core.agent.plugin_entities import AgentProviderEntityWithPlugin
from core.datasource.entities.datasource_entities import DatasourceProviderEntityWithPlugin
from core.model_runtime.entities.model_entities import AIModelEntity
from core.model_runtime.entities.provider_entities import ProviderEntity
from core.plugin.entities.base import BasePluginEntity
from core.plugin.entities.parameters import PluginParameterOption
from core.plugin.entities.plugin import PluginDeclaration, PluginEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderEntityWithPlugin
from core.trigger.entities.entities import TriggerProviderEntity

T = TypeVar("T", bound=(BaseModel | dict | list | bool | str))


class PluginDaemonBasicResponse(BaseModel, Generic[T]):
    """
    Basic response from plugin daemon.
    """

    code: int
    message: str
    data: T | None = None


class InstallPluginMessage(BaseModel):
    """
    Message for installing a plugin.
    """

    class Event(StrEnum):
        Info = "info"
        Done = "done"
        Error = "error"

    event: Event
    data: str


class PluginToolProviderEntity(BaseModel):
    provider: str
    plugin_unique_identifier: str
    plugin_id: str
    declaration: ToolProviderEntityWithPlugin


class PluginDatasourceProviderEntity(BaseModel):
    provider: str
    plugin_unique_identifier: str
    plugin_id: str
    is_authorized: bool = False
    declaration: DatasourceProviderEntityWithPlugin


class PluginAgentProviderEntity(BaseModel):
    provider: str
    plugin_unique_identifier: str
    plugin_id: str
    declaration: AgentProviderEntityWithPlugin
    meta: PluginDeclaration.Meta


class PluginBasicBooleanResponse(BaseModel):
    """
    Basic boolean response from plugin daemon.
    """

    result: bool
    credentials: dict | None = None


class PluginModelSchemaEntity(BaseModel):
    model_schema: AIModelEntity = Field(description="The model schema.")

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())


class PluginModelProviderEntity(BaseModel):
    id: str = Field(description="ID")
    created_at: datetime = Field(description="The created at time of the model provider.")
    updated_at: datetime = Field(description="The updated at time of the model provider.")
    provider: str = Field(description="The provider of the model.")
    tenant_id: str = Field(description="The tenant ID.")
    plugin_unique_identifier: str = Field(description="The plugin unique identifier.")
    plugin_id: str = Field(description="The plugin ID.")
    declaration: ProviderEntity = Field(description="The declaration of the model provider.")


class PluginTextEmbeddingNumTokensResponse(BaseModel):
    """
    Response for number of tokens.
    """

    num_tokens: list[int] = Field(description="The number of tokens.")


class PluginLLMNumTokensResponse(BaseModel):
    """
    Response for number of tokens.
    """

    num_tokens: int = Field(description="The number of tokens.")


class PluginStringResultResponse(BaseModel):
    result: str = Field(description="The result of the string.")


class PluginVoiceEntity(BaseModel):
    name: str = Field(description="The name of the voice.")
    value: str = Field(description="The value of the voice.")


class PluginVoicesResponse(BaseModel):
    voices: list[PluginVoiceEntity] = Field(description="The result of the voices.")


class PluginDaemonError(BaseModel):
    """
    Error from plugin daemon.
    """

    error_type: str
    message: str


class PluginDaemonInnerError(Exception):
    code: int
    message: str

    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message


class PluginInstallTaskStatus(StrEnum):
    Pending = "pending"
    Running = "running"
    Success = "success"
    Failed = "failed"


class PluginInstallTaskPluginStatus(BaseModel):
    plugin_unique_identifier: str = Field(description="The plugin unique identifier of the install task.")
    plugin_id: str = Field(description="The plugin ID of the install task.")
    status: PluginInstallTaskStatus = Field(description="The status of the install task.")
    message: str = Field(description="The message of the install task.")
    icon: str = Field(description="The icon of the plugin.")
    labels: I18nObject = Field(description="The labels of the plugin.")


class PluginInstallTask(BasePluginEntity):
    status: PluginInstallTaskStatus = Field(description="The status of the install task.")
    total_plugins: int = Field(description="The total number of plugins to be installed.")
    completed_plugins: int = Field(description="The number of plugins that have been installed.")
    plugins: list[PluginInstallTaskPluginStatus] = Field(description="The status of the plugins.")


class PluginInstallTaskStartResponse(BaseModel):
    all_installed: bool = Field(description="Whether all plugins are installed.")
    task_id: str = Field(description="The ID of the install task.")


class PluginVerification(BaseModel):
    """
    Verification of the plugin.
    """

    class AuthorizedCategory(StrEnum):
        Langgenius = "langgenius"
        Partner = "partner"
        Community = "community"

    authorized_category: AuthorizedCategory = Field(description="The authorized category of the plugin.")


class PluginDecodeResponse(BaseModel):
    unique_identifier: str = Field(description="The unique identifier of the plugin.")
    manifest: PluginDeclaration
    verification: PluginVerification | None = Field(default=None, description="Basic verification information")


class PluginOAuthAuthorizationUrlResponse(BaseModel):
    authorization_url: str = Field(description="The URL of the authorization.")


class PluginOAuthCredentialsResponse(BaseModel):
    metadata: Mapping[str, Any] = Field(
        default_factory=dict, description="The metadata of the OAuth, like avatar url, name, etc."
    )
    expires_at: int = Field(default=-1, description="The expires at time of the credentials. UTC timestamp.")
    credentials: Mapping[str, Any] = Field(description="The credentials of the OAuth.")


class PluginListResponse(BaseModel):
    list: list[PluginEntity]
    total: int


class PluginDynamicSelectOptionsResponse(BaseModel):
    options: Sequence[PluginParameterOption] = Field(description="The options of the dynamic select.")


class PluginTriggerProviderEntity(BaseModel):
    provider: str
    plugin_unique_identifier: str
    plugin_id: str
    declaration: TriggerProviderEntity


class CredentialType(enum.StrEnum):
    API_KEY = "api-key"
    OAUTH2 = "oauth2"
    UNAUTHORIZED = "unauthorized"

    def get_name(self):
        if self == CredentialType.API_KEY:
            return "API KEY"
        elif self == CredentialType.OAUTH2:
            return "AUTH"
        elif self == CredentialType.UNAUTHORIZED:
            return "UNAUTHORIZED"
        else:
            return self.value.replace("-", " ").upper()

    def is_editable(self):
        return self == CredentialType.API_KEY

    def is_validate_allowed(self):
        return self == CredentialType.API_KEY

    @classmethod
    def values(cls):
        return [item.value for item in cls]

    @classmethod
    def of(cls, credential_type: str) -> CredentialType:
        type_name = credential_type.lower()
        if type_name in {"api-key", "api_key"}:
            return cls.API_KEY
        elif type_name in {"oauth2", "oauth"}:
            return cls.OAUTH2
        elif type_name == "unauthorized":
            return cls.UNAUTHORIZED
        else:
            raise ValueError(f"Invalid credential type: {credential_type}")


class PluginReadmeResponse(BaseModel):
    content: str = Field(description="The readme of the plugin.")
    language: str = Field(description="The language of the readme.")
