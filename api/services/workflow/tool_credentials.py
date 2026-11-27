"""Static tool credential configuration and projections, with no runtime provider lookup."""

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from constants.end_user_connections import ConnectionCredentialType, OAuthClientSource
from domain.plugins.provider_id import normalize_tool_provider_id
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.tool.entities import ToolNodeData
from services.end_user_connections.revision import AuthorizationRequirementSnapshot
from services.entities import tool_connection_entities
from services.entities.tool_connection_entities import ToolConnectionRequirement

first_end_user_tool_node = tool_connection_entities.first_end_user_tool_node
requires_end_user_connections = tool_connection_entities.requires_end_user_connections


class EndUserAuthConfig(BaseModel):
    """Missing values represent an unfinished draft, not an executable configuration."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    allowed_credential_types: list[Literal["api-key", "oauth2"]] | None = Field(default=None, max_length=2)
    oauth_client_type: Literal["default", "custom"] | None = None
    purpose: str | None = Field(default=None, max_length=50)

    @property
    def oauth_client_source(self) -> OAuthClientSource | None:
        if self.oauth_client_type is None:
            return None
        return OAuthClientSource.PLATFORM if self.oauth_client_type == "default" else OAuthClientSource.WORKSPACE

    @field_validator("allowed_credential_types")
    @classmethod
    def validate_unique_credential_types(
        cls, value: list[Literal["api-key", "oauth2"]] | None
    ) -> list[Literal["api-key", "oauth2"]] | None:
        if value is not None and len(value) != len(set(value)):
            raise ValueError("Authentication methods must not contain duplicates.")
        return value


class ToolCredentialConfig(BaseModel):
    """Static per-node requirements; active Connections belong to the user's Session selections.

    Independent nodes can select different Connections for the same provider. Only an explicit
    reuse reference shares another node's authentication; personal Connection IDs stay out of the graph.
    Nodes using different tools from the same provider can share authentication.
    """

    model_config = ConfigDict(frozen=True)

    # Reuse delegates the effective source and settings to the referenced node.
    credential_source: Literal["workspace", "end_user", "reuse_node"] = "workspace"
    credential_id: str | None = None
    end_user_auth: EndUserAuthConfig | None = None
    reuse_node_id: str | None = Field(default=None, min_length=1)
    test_credential_id: str | None = Field(default=None, min_length=1)


class ToolNodeSpec(ToolNodeData, ToolCredentialConfig):
    """The editor-facing schema includes Dify policy without changing Graphon's node model."""


def get_tool_connection_requirements(graph: Mapping[str, Any]) -> tuple[ToolConnectionRequirement, ...]:
    """Project published node requirements without I/O or graph changes.

    EndUser nodes must have complete authentication settings and valid provider IDs.
    Incomplete settings or invalid IDs raise ValueError; provider aliases are canonicalized.
    """
    nodes = {
        node["id"]: node["data"]
        for node in graph.get("nodes", [])
        if isinstance(node, Mapping)
        and node.get("type") != "custom-note"
        and isinstance(node.get("data"), Mapping)
        and node["data"].get("type") == BuiltinNodeTypes.TOOL
    }
    requirements: list[ToolConnectionRequirement] = []
    for node_id, data in nodes.items():
        if data.get("credential_source") != "end_user":
            continue
        config = ToolCredentialConfig.model_validate(data)
        auth = config.end_user_auth
        if auth is None or auth.purpose is None or not auth.allowed_credential_types:
            raise ValueError("Published EndUser authentication settings are incomplete.")
        title = data.get("title")
        requirements.append(
            ToolConnectionRequirement(
                node_id=node_id,
                node_ids=(
                    node_id,
                    *(
                        key
                        for key, value in nodes.items()
                        if value.get("credential_source") == "reuse_node" and value.get("reuse_node_id") == node_id
                    ),
                ),
                title=title if isinstance(title, str) and title else node_id,
                purpose=auth.purpose,
                provider=normalize_tool_provider_id(data["provider_id"]),
                allowed_credential_types=tuple(
                    sorted(ConnectionCredentialType(value) for value in auth.allowed_credential_types)
                ),
            )
        )
    return tuple(requirements)


def get_tool_authorization_requirements(graph: Mapping[str, Any]) -> tuple[AuthorizationRequirementSnapshot, ...]:
    """Return sorted snapshots from published requirements; propagate invalid-configuration errors without I/O."""
    nodes = {
        node["id"]: node["data"]
        for node in graph.get("nodes", [])
        if isinstance(node, Mapping)
        and isinstance(node.get("id"), str)
        and isinstance(node.get("data"), Mapping)
        and node.get("type") != "custom-note"
    }
    requirements: list[AuthorizationRequirementSnapshot] = []
    for item in get_tool_connection_requirements(graph):
        data = nodes[item.node_id]
        config = ToolCredentialConfig.model_validate(data)
        assert config.end_user_auth is not None
        requirements.append(
            AuthorizationRequirementSnapshot(
                node_id=item.node_id,
                node_ids=tuple(sorted(item.node_ids)),
                provider=item.provider,
                tool_name=data["tool_name"],
                purpose=item.purpose,
                allowed_credential_types=tuple(sorted(value.value for value in item.allowed_credential_types)),
                oauth_client_type=config.end_user_auth.oauth_client_type,
            )
        )
    return tuple(sorted(requirements, key=lambda item: item.node_id))


class WorkflowToolEndUserAuthError(ValueError):
    def __init__(self, node_id: str) -> None:
        super().__init__(f"Node {node_id}: EndUser credentials are not supported in workflow tools.")


class WorkflowTriggerEndUserAuthError(ValueError):
    def __init__(self, node_id: str) -> None:
        super().__init__(f"Node {node_id}: EndUser credentials are not supported in trigger workflows.")
