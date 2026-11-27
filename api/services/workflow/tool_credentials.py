"""Static tool credential configuration and projections, with no runtime provider lookup."""

from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from constants.end_user_connections import ConnectionCredentialType, OAuthClientSource
from domain.plugins.provider_id import normalize_tool_provider_id
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.tool.entities import ToolNodeData
from services.end_user_connections.revision import AuthorizationRequirementSnapshot


class ToolCredentialSource(StrEnum):
    WORKSPACE = "workspace"
    END_USER = "end_user"
    REUSE_NODE = "reuse_node"


class ToolOAuthClientType(StrEnum):
    DEFAULT = "default"
    CUSTOM = "custom"


class EndUserAuthConfig(BaseModel):
    """Missing values represent an unfinished draft, not an executable configuration."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    allowed_credential_types: list[ConnectionCredentialType] | None = Field(default=None, max_length=2)
    oauth_client_type: ToolOAuthClientType | None = None
    purpose: str | None = Field(default=None, max_length=50)

    @property
    def oauth_client_source(self) -> OAuthClientSource | None:
        if self.oauth_client_type is None:
            return None
        return (
            OAuthClientSource.PLATFORM
            if self.oauth_client_type is ToolOAuthClientType.DEFAULT
            else OAuthClientSource.WORKSPACE
        )

    @field_validator("allowed_credential_types")
    @classmethod
    def validate_unique_credential_types(
        cls, value: list[ConnectionCredentialType] | None
    ) -> list[ConnectionCredentialType] | None:
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
    credential_source: ToolCredentialSource = ToolCredentialSource.WORKSPACE
    credential_id: str | None = None
    end_user_auth: EndUserAuthConfig | None = None
    reuse_node_id: str | None = Field(default=None, min_length=1)
    test_credential_id: str | None = Field(default=None, min_length=1)


class ToolNodeSpec(ToolNodeData, ToolCredentialConfig):
    """The editor-facing schema includes Dify policy without changing Graphon's node model."""


class ToolConnectionRequirement(BaseModel):
    """Published authorization requirements, independent of personal connection readiness."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    node_id: str = Field(description="Independent authorization node ID to use as the selection key.")
    node_ids: tuple[str, ...] = Field(description="The authorization node and all nodes explicitly reusing it.")
    title: str
    purpose: str
    provider: str
    allowed_credential_types: tuple[ConnectionCredentialType, ...]


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
                allowed_credential_types=tuple(sorted(auth.allowed_credential_types)),
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


def requires_end_user_connections(graph: Mapping[str, Any]) -> bool:
    """Static discovery only: reuse delegates to a node that declares its source.

    A declared EndUser requirement must stay visible even if its configuration
    is incomplete; publication validation and Preflight diagnose that separately.
    """
    return first_end_user_tool_node(graph) is not None


def first_end_user_tool_node(graph: Mapping[str, Any]) -> str | None:
    """Find the node declaring personal credentials, including incomplete drafts."""
    return next(
        (
            str(node.get("id", "unknown"))
            for node in graph.get("nodes", [])
            if (
                isinstance(node, Mapping)
                and node.get("type") != "custom-note"
                and isinstance(data := node.get("data"), Mapping)
                and data.get("type") == BuiltinNodeTypes.TOOL
                and data.get("credential_source") == "end_user"
            )
        ),
        None,
    )


class WorkflowToolEndUserAuthError(ValueError):
    def __init__(self, node_id: str) -> None:
        super().__init__(f"Node {node_id}: EndUser credentials are not supported in workflow tools.")


class WorkflowTriggerEndUserAuthError(ValueError):
    def __init__(self, node_id: str) -> None:
        super().__init__(f"Node {node_id}: EndUser credentials are not supported in trigger workflows.")
