"""Static tool authorization requirements shared by application query services."""

from collections.abc import Mapping
from typing import Any, NamedTuple, Protocol

from pydantic import BaseModel, ConfigDict, Field

from constants.end_user_connections import ConnectionCredentialType


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
    plugin_unique_identifier: str
    icon: str
    icon_dark: str | None


class ConnectionRevisions(Protocol):
    def resolve(
        self, tenant_id: str, app_id: str, graph: Mapping[str, Any]
    ) -> tuple[str, tuple[ConnectionProviderMetadata, ...]]: ...
