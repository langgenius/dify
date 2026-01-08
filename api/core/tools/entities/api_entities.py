from collections.abc import Mapping
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from core.entities.mcp_provider import MCPAuthentication, MCPConfiguration
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.__base.tool import ToolParameter
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType


class ToolApiEntity(BaseModel):
    author: str
    name: str  # identifier
    label: I18nObject  # label
    description: I18nObject
    parameters: list[ToolParameter] | None = None
    labels: list[str] = Field(default_factory=list)
    output_schema: Mapping[str, object] = Field(default_factory=dict)


ToolProviderTypeApiLiteral = Literal["builtin", "api", "workflow", "mcp"] | None


class ToolProviderApiEntity(BaseModel):
    id: str
    author: str
    name: str  # identifier
    description: I18nObject
    icon: str | Mapping[str, str]
    icon_dark: str | Mapping[str, str] = ""
    label: I18nObject  # label
    type: ToolProviderType
    masked_credentials: Mapping[str, object] = Field(default_factory=dict)
    original_credentials: Mapping[str, object] = Field(default_factory=dict)
    is_team_authorization: bool = False
    allow_delete: bool = True
    plugin_id: str | None = Field(default="", description="The plugin id of the tool")
    plugin_unique_identifier: str | None = Field(default="", description="The unique identifier of the tool")
    tools: list[ToolApiEntity] = Field(default_factory=list[ToolApiEntity])
    labels: list[str] = Field(default_factory=list)
    # MCP
    server_url: str | None = Field(default="", description="The server url of the tool")
    updated_at: int = Field(default_factory=lambda: int(datetime.now().timestamp()))
    server_identifier: str | None = Field(default="", description="The server identifier of the MCP tool")

    masked_headers: dict[str, str] | None = Field(default=None, description="The masked headers of the MCP tool")
    original_headers: dict[str, str] | None = Field(default=None, description="The original headers of the MCP tool")
    authentication: MCPAuthentication | None = Field(default=None, description="The OAuth config of the MCP tool")
    is_dynamic_registration: bool = Field(default=True, description="Whether the MCP tool is dynamically registered")
    configuration: MCPConfiguration | None = Field(
        default=None, description="The timeout and sse_read_timeout of the MCP tool"
    )
    # Workflow
    workflow_app_id: str | None = Field(default=None, description="The app id of the workflow tool")

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
                    if parameter.get("type") == ToolParameter.ToolParameterType.SYSTEM_FILES:
                        parameter["type"] = "files"
                    if parameter.get("input_schema") is None:
                        parameter.pop("input_schema", None)
        # -------------
        optional_fields = self.optional_field("server_url", self.server_url)
        if self.type == ToolProviderType.MCP:
            optional_fields.update(self.optional_field("updated_at", self.updated_at))
            optional_fields.update(self.optional_field("server_identifier", self.server_identifier))
            optional_fields.update(
                self.optional_field(
                    "configuration", self.configuration.model_dump() if self.configuration else MCPConfiguration()
                )
            )
            optional_fields.update(
                self.optional_field("authentication", self.authentication.model_dump() if self.authentication else None)
            )
            optional_fields.update(self.optional_field("is_dynamic_registration", self.is_dynamic_registration))
            optional_fields.update(self.optional_field("masked_headers", self.masked_headers))
            optional_fields.update(self.optional_field("original_headers", self.original_headers))
        elif self.type == ToolProviderType.WORKFLOW:
            optional_fields.update(self.optional_field("workflow_app_id", self.workflow_app_id))
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
    credentials: Mapping[str, object] = Field(description="The credentials of the provider", default_factory=dict)


class ToolProviderCredentialInfoApiEntity(BaseModel):
    supported_credential_types: list[CredentialType] = Field(
        description="The supported credential types of the provider"
    )
    is_oauth_custom_client_enabled: bool = Field(
        default=False, description="Whether the OAuth custom client is enabled for the provider"
    )
    credentials: list[ToolProviderCredentialApiEntity] = Field(description="The credentials of the provider")
