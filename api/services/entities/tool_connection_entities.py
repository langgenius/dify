"""Framework-neutral values and discovery for published tool connection requirements."""

from collections.abc import Mapping
from typing import Any, NamedTuple, Protocol

from pydantic import BaseModel, ConfigDict, Field

from constants.end_user_connections import ConnectionCredentialType
from core.tools.entities.common_entities import I18nObject


class ToolConnectionRequirement(BaseModel):
    """Published authorization requirements, independent of personal connection readiness."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    node_id: str = Field(description="Independent authorization node ID to use as the selection key.")
    node_ids: tuple[str, ...] = Field(description="The authorization node and all nodes explicitly reusing it.")
    title: str
    purpose: str
    provider: str
    allowed_credential_types: tuple[ConnectionCredentialType, ...]


class ConnectionProviderMetadata(NamedTuple):
    provider: str
    provider_label: I18nObject
    plugin_unique_identifier: str
    icon: str
    icon_dark: str | None


class ConnectionRevisions(Protocol):
    def resolve(
        self, tenant_id: str, app_id: str, graph: Mapping[str, Any]
    ) -> tuple[str, tuple[ConnectionProviderMetadata, ...]]: ...


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
                and data.get("type") == "tool"
                and data.get("credential_source") == "end_user"
            )
        ),
        None,
    )
