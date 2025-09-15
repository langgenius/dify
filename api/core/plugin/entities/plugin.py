import datetime
import re
from collections.abc import Mapping
from enum import StrEnum, auto
from typing import Any

from packaging.version import InvalidVersion, Version
from pydantic import BaseModel, Field, field_validator, model_validator
from werkzeug.exceptions import NotFound

from core.agent.plugin_entities import AgentStrategyProviderEntity
from core.model_runtime.entities.provider_entities import ProviderEntity
from core.plugin.entities.base import BasePluginEntity
from core.plugin.entities.endpoint import EndpointProviderDeclaration
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderEntity


class PluginInstallationSource(StrEnum):
    Github = auto()
    Marketplace = auto()
    Package = auto()
    Remote = auto()


class PluginResourceRequirements(BaseModel):
    memory: int

    class Permission(BaseModel):
        class Tool(BaseModel):
            enabled: bool | None = Field(default=False)

        class Model(BaseModel):
            enabled: bool | None = Field(default=False)
            llm: bool | None = Field(default=False)
            text_embedding: bool | None = Field(default=False)
            rerank: bool | None = Field(default=False)
            tts: bool | None = Field(default=False)
            speech2text: bool | None = Field(default=False)
            moderation: bool | None = Field(default=False)

        class Node(BaseModel):
            enabled: bool | None = Field(default=False)

        class Endpoint(BaseModel):
            enabled: bool | None = Field(default=False)

        class Storage(BaseModel):
            enabled: bool | None = Field(default=False)
            size: int = Field(ge=1024, le=1073741824, default=1048576)

        tool: Tool | None = Field(default=None)
        model: Model | None = Field(default=None)
        node: Node | None = Field(default=None)
        endpoint: Endpoint | None = Field(default=None)
        storage: Storage | None = Field(default=None)

    permission: Permission | None = Field(default=None)


class PluginCategory(StrEnum):
    Tool = auto()
    Model = auto()
    Extension = auto()
    AgentStrategy = "agent-strategy"


class PluginDeclaration(BaseModel):
    class Plugins(BaseModel):
        tools: list[str] | None = Field(default_factory=list[str])
        models: list[str] | None = Field(default_factory=list[str])
        endpoints: list[str] | None = Field(default_factory=list[str])

    class Meta(BaseModel):
        minimum_dify_version: str | None = Field(default=None)
        version: str | None = Field(default=None)

        @field_validator("minimum_dify_version")
        @classmethod
        def validate_minimum_dify_version(cls, v: str | None) -> str | None:
            if v is None:
                return v
            try:
                Version(v)
                return v
            except InvalidVersion as e:
                raise ValueError(f"Invalid version format: {v}") from e

    version: str = Field(...)
    author: str | None = Field(..., pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    name: str = Field(..., pattern=r"^[a-z0-9_-]{1,128}$")
    description: I18nObject
    icon: str
    icon_dark: str | None = Field(default=None)
    label: I18nObject
    category: PluginCategory
    created_at: datetime.datetime
    resource: PluginResourceRequirements
    plugins: Plugins
    tags: list[str] = Field(default_factory=list)
    repo: str | None = Field(default=None)
    verified: bool = Field(default=False)
    tool: ToolProviderEntity | None = None
    model: ProviderEntity | None = None
    endpoint: EndpointProviderDeclaration | None = None
    agent_strategy: AgentStrategyProviderEntity | None = None
    meta: Meta

    @field_validator("version")
    @classmethod
    def validate_version(cls, v: str) -> str:
        try:
            Version(v)
            return v
        except InvalidVersion as e:
            raise ValueError(f"Invalid version format: {v}") from e

    @model_validator(mode="before")
    @classmethod
    def validate_category(cls, values: dict):
        # auto detect category
        if values.get("tool"):
            values["category"] = PluginCategory.Tool
        elif values.get("model"):
            values["category"] = PluginCategory.Model
        elif values.get("agent_strategy"):
            values["category"] = PluginCategory.AgentStrategy
        else:
            values["category"] = PluginCategory.Extension
        return values


class PluginInstallation(BasePluginEntity):
    tenant_id: str
    endpoints_setups: int
    endpoints_active: int
    runtime_type: str
    source: PluginInstallationSource
    meta: Mapping[str, Any]
    plugin_id: str
    plugin_unique_identifier: str
    version: str
    checksum: str
    declaration: PluginDeclaration


class PluginEntity(PluginInstallation):
    name: str
    installation_id: str
    version: str

    @model_validator(mode="after")
    def set_plugin_id(self):
        if self.declaration.tool:
            self.declaration.tool.plugin_id = self.plugin_id
        return self


class GenericProviderID:
    organization: str
    plugin_name: str
    provider_name: str
    is_hardcoded: bool

    def to_string(self) -> str:
        return str(self)

    def __str__(self) -> str:
        return f"{self.organization}/{self.plugin_name}/{self.provider_name}"

    def __init__(self, value: str, is_hardcoded: bool = False):
        if not value:
            raise NotFound("plugin not found, please add plugin")
        # check if the value is a valid plugin id with format: $organization/$plugin_name/$provider_name
        if not re.match(r"^[a-z0-9_-]+\/[a-z0-9_-]+\/[a-z0-9_-]+$", value):
            # check if matches [a-z0-9_-]+, if yes, append with langgenius/$value/$value
            if re.match(r"^[a-z0-9_-]+$", value):
                value = f"langgenius/{value}/{value}"
            else:
                raise ValueError(f"Invalid plugin id {value}")

        self.organization, self.plugin_name, self.provider_name = value.split("/")
        self.is_hardcoded = is_hardcoded

    def is_langgenius(self) -> bool:
        return self.organization == "langgenius"

    @property
    def plugin_id(self) -> str:
        return f"{self.organization}/{self.plugin_name}"


class ModelProviderID(GenericProviderID):
    def __init__(self, value: str, is_hardcoded: bool = False):
        super().__init__(value, is_hardcoded)
        if self.organization == "langgenius" and self.provider_name == "google":
            self.plugin_name = "gemini"


class ToolProviderID(GenericProviderID):
    def __init__(self, value: str, is_hardcoded: bool = False):
        super().__init__(value, is_hardcoded)
        if self.organization == "langgenius":
            if self.provider_name in ["jina", "siliconflow", "stepfun", "gitee_ai"]:
                self.plugin_name = f"{self.provider_name}_tool"


class PluginDependency(BaseModel):
    class Type(StrEnum):
        Github = PluginInstallationSource.Github
        Marketplace = PluginInstallationSource.Marketplace
        Package = PluginInstallationSource.Package

    class Github(BaseModel):
        repo: str
        version: str
        package: str
        github_plugin_unique_identifier: str

        @property
        def plugin_unique_identifier(self) -> str:
            return self.github_plugin_unique_identifier

    class Marketplace(BaseModel):
        marketplace_plugin_unique_identifier: str

        @property
        def plugin_unique_identifier(self) -> str:
            return self.marketplace_plugin_unique_identifier

    class Package(BaseModel):
        plugin_unique_identifier: str

    type: Type
    value: Github | Marketplace | Package
    current_identifier: str | None = None


class MissingPluginDependency(BaseModel):
    plugin_unique_identifier: str
    current_identifier: str | None = None
