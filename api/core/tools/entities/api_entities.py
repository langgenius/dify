from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.__base.tool import ToolParameter
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import CredentialType, ToolProviderType


class ToolApiEntity(BaseModel):
    author: str
    name: str  # identifier
    label: I18nObject  # label
    description: I18nObject
    parameters: list[ToolParameter] | None = None
    labels: list[str] = Field(default_factory=list)
    output_schema: dict | None = None


ToolProviderTypeApiLiteral = Optional[Literal["builtin", "api", "workflow", "mcp"]]


class ToolProviderApiEntity(BaseModel):
    id: str
    author: str
    name: str  # identifier
    description: I18nObject
    icon: str | dict
    icon_dark: str | dict | None = Field(default=None, description="The dark icon of the tool")
    label: I18nObject  # label
    type: ToolProviderType
    masked_credentials: dict | None = None
    original_credentials: dict | None = None
    is_team_authorization: bool = False
    allow_delete: bool = True
    plugin_id: str | None = Field(default="", description="The plugin id of the tool")
    plugin_unique_identifier: str | None = Field(default="", description="The unique identifier of the tool")
    tools: list[ToolApiEntity] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)
    # MCP
    server_url: str | None = Field(default="", description="The server url of the tool")
    updated_at: int = Field(default_factory=lambda: int(datetime.now().timestamp()))
    server_identifier: str | None = Field(default="", description="The server identifier of the MCP tool")
    timeout: float | None = Field(default=30.0, description="The timeout of the MCP tool")
    sse_read_timeout: float | None = Field(default=300.0, description="The SSE read timeout of the MCP tool")
    masked_headers: dict[str, str] | None = Field(default=None, description="The masked headers of the MCP tool")
    original_headers: dict[str, str] | None = Field(default=None, description="The original headers of the MCP tool")

    @field_validator("tools", mode="before")
    @classmethod
    def convert_none_to_empty_list(cls, v):
        return v if v is not None else []

    def to_dict(self):
        # -------------
        # overwrite tool parameter types for temp fix
        tools = jsonable_encoder(self.tools)
        for tool in tools:
            if tool.get("parameters"):
                for parameter in tool.get("parameters"):
                    if parameter.get("type") == ToolParameter.ToolParameterType.SYSTEM_FILES.value:
                        parameter["type"] = "files"
                    if parameter.get("input_schema") is None:
                        parameter.pop("input_schema", None)
        # -------------
        optional_fields = self.optional_field("server_url", self.server_url)
        if self.type == ToolProviderType.MCP:
            optional_fields.update(self.optional_field("updated_at", self.updated_at))
            optional_fields.update(self.optional_field("server_identifier", self.server_identifier))
            optional_fields.update(self.optional_field("timeout", self.timeout))
            optional_fields.update(self.optional_field("sse_read_timeout", self.sse_read_timeout))
            optional_fields.update(self.optional_field("masked_headers", self.masked_headers))
            optional_fields.update(self.optional_field("original_headers", self.original_headers))
        return {
            "id": self.id,
            "author": self.author,
            "name": self.name,
            "plugin_id": self.plugin_id,
            "plugin_unique_identifier": self.plugin_unique_identifier,
            "description": self.description.to_dict(),
            "icon": self.icon,
            "icon_dark": self.icon_dark,
            "label": self.label.to_dict(),
            "type": self.type.value,
            "team_credentials": self.masked_credentials,
            "is_team_authorization": self.is_team_authorization,
            "allow_delete": self.allow_delete,
            "tools": tools,
            "labels": self.labels,
            **optional_fields,
        }

    def optional_field(self, key: str, value: Any):
        """Return dict with key-value if value is truthy, empty dict otherwise."""
        return {key: value} if value else {}


class ToolProviderCredentialApiEntity(BaseModel):
    id: str = Field(description="The unique id of the credential")
    name: str = Field(description="The name of the credential")
    provider: str = Field(description="The provider of the credential")
    credential_type: CredentialType = Field(description="The type of the credential")
    is_default: bool = Field(
        default=False, description="Whether the credential is the default credential for the provider in the workspace"
    )
    credentials: dict = Field(description="The credentials of the provider")


class ToolProviderCredentialInfoApiEntity(BaseModel):
    supported_credential_types: list[str] = Field(description="The supported credential types of the provider")
    is_oauth_custom_client_enabled: bool = Field(
        default=False, description="Whether the OAuth custom client is enabled for the provider"
    )
    credentials: list[ToolProviderCredentialApiEntity] = Field(description="The credentials of the provider")
