import datetime
import enum
import re
from collections.abc import Mapping
from typing import Any, Optional

from pydantic import BaseModel, Field, model_validator
from werkzeug.exceptions import NotFound

from core.agent.plugin_entities import AgentStrategyProviderEntity
from core.model_runtime.entities.provider_entities import ProviderEntity
from core.plugin.entities.base import BasePluginEntity
from core.plugin.entities.endpoint import EndpointProviderDeclaration
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderEntity


class PluginInstallationSource(enum.StrEnum):
    Github = "github"
    Marketplace = "marketplace"
    Package = "package"
    Remote = "remote"


class PluginResourceRequirements(BaseModel):
    memory: int

    class Permission(BaseModel):
        class Tool(BaseModel):
            enabled: Optional[bool] = Field(default=False)

        class Model(BaseModel):
            enabled: Optional[bool] = Field(default=False)
            llm: Optional[bool] = Field(default=False)
            text_embedding: Optional[bool] = Field(default=False)
            rerank: Optional[bool] = Field(default=False)
            tts: Optional[bool] = Field(default=False)
            speech2text: Optional[bool] = Field(default=False)
            moderation: Optional[bool] = Field(default=False)

        class Node(BaseModel):
            enabled: Optional[bool] = Field(default=False)

        class Endpoint(BaseModel):
            enabled: Optional[bool] = Field(default=False)

        class Storage(BaseModel):
            enabled: Optional[bool] = Field(default=False)
            size: int = Field(ge=1024, le=1073741824, default=1048576)

        tool: Optional[Tool] = Field(default=None)
        model: Optional[Model] = Field(default=None)
        node: Optional[Node] = Field(default=None)
        endpoint: Optional[Endpoint] = Field(default=None)
        storage: Storage = Field(default=None)

    permission: Optional[Permission] = Field(default=None)


class PluginCategory(enum.StrEnum):
    Tool = "tool"
    Model = "model"
    Extension = "extension"
    AgentStrategy = "agent-strategy"


class PluginDeclaration(BaseModel):
    class Plugins(BaseModel):
        tools: Optional[list[str]] = Field(default_factory=list)
        models: Optional[list[str]] = Field(default_factory=list)
        endpoints: Optional[list[str]] = Field(default_factory=list)

    version: str = Field(..., pattern=r"^\d{1,4}(\.\d{1,4}){1,3}(-\w{1,16})?$")
    author: Optional[str] = Field(..., pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    name: str = Field(..., pattern=r"^[a-z0-9_-]{1,128}$")
    description: I18nObject
    icon: str
    label: I18nObject
    category: PluginCategory
    created_at: datetime.datetime
    resource: PluginResourceRequirements
    plugins: Plugins
    tags: list[str] = Field(default_factory=list)
    verified: bool = Field(default=False)
    tool: Optional[ToolProviderEntity] = None
    model: Optional[ProviderEntity] = None
    endpoint: Optional[EndpointProviderDeclaration] = None
    agent_strategy: Optional[AgentStrategyProviderEntity] = None

    @model_validator(mode="before")
    @classmethod
    def validate_category(cls, values: dict) -> dict:
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
    latest_version: Optional[str] = None
    latest_unique_identifier: Optional[str] = None

    @model_validator(mode="after")
    def set_plugin_id(self):
        if self.declaration.tool:
            self.declaration.tool.plugin_id = self.plugin_id
        return self


class GithubPackage(BaseModel):
    repo: str
    version: str
    package: str


class GithubVersion(BaseModel):
    repo: str
    version: str


class GenericProviderID:
    organization: str
    plugin_name: str
    provider_name: str
    is_hardcoded: bool

    def to_string(self) -> str:
        return str(self)

    def __str__(self) -> str:
        return f"{self.organization}/{self.plugin_name}/{self.provider_name}"

    def __init__(self, value: str, is_hardcoded: bool = False) -> None:
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
    def __init__(self, value: str, is_hardcoded: bool = False) -> None:
        super().__init__(value, is_hardcoded)
        if self.organization == "langgenius" and self.provider_name == "google":
            self.plugin_name = "gemini"


class ToolProviderID(GenericProviderID):
    def __init__(self, value: str, is_hardcoded: bool = False) -> None:
        super().__init__(value, is_hardcoded)
        if self.organization == "langgenius":
            if self.provider_name in ["jina", "siliconflow", "stepfun", "gitee_ai"]:
                self.plugin_name = f"{self.provider_name}_tool"


class PluginDependency(BaseModel):
    class Type(enum.StrEnum):
        Github = PluginInstallationSource.Github.value
        Marketplace = PluginInstallationSource.Marketplace.value
        Package = PluginInstallationSource.Package.value

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
    current_identifier: Optional[str] = None


class MissingPluginDependency(BaseModel):
    plugin_unique_identifier: str
    current_identifier: Optional[str] = None
