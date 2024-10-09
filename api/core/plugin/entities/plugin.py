import datetime
from typing import Optional

from pydantic import BaseModel, Field

from core.model_runtime.entities.provider_entities import ProviderEntity
from core.plugin.entities.base import BasePluginEntity
from core.plugin.entities.endpoint import EndpointProviderDeclaration
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderEntity


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

    permission: Optional[Permission]


class PluginDeclaration(BaseModel):
    class Plugins(BaseModel):
        tools: Optional[list[str]] = Field(default_factory=list)
        models: Optional[list[str]] = Field(default_factory=list)
        endpoints: Optional[list[str]] = Field(default_factory=list)

    version: str = Field(..., pattern=r"^\d{1,4}(\.\d{1,4}){1,3}(-\w{1,16})?$")
    author: Optional[str] = Field(..., pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    name: str = Field(..., pattern=r"^[a-z0-9_-]{1,128}$")
    icon: str
    label: I18nObject
    created_at: datetime.datetime
    resource: PluginResourceRequirements
    plugins: Plugins
    tool: Optional[ToolProviderEntity] = None
    model: Optional[ProviderEntity] = None
    endpoint: Optional[EndpointProviderDeclaration] = None


class PluginEntity(BasePluginEntity):
    name: str
    plugin_id: str
    plugin_unique_identifier: str
    declaration: PluginDeclaration
    installation_id: str
    tenant_id: str
    endpoints_setups: int
    endpoints_active: int
    runtime_type: str
    version: str
