"""Content-addressed authorization contracts, independent of workflow publications."""

import json
from dataclasses import dataclass
from operator import itemgetter
from typing import Protocol

from pydantic import BaseModel, ConfigDict

from constants.end_user_connections import ConnectionRevisionAcceptanceReason, OAuthClientSource
from libs.uuid_validation import UUIDStr
from services.end_user_connections.entities import WebConnectionContext
from services.entities import tool_connection_entities

ConnectionRevision = UUIDStr
ConnectionProviderMetadata = tool_connection_entities.ConnectionProviderMetadata
ConnectionRevisions = tool_connection_entities.ConnectionRevisions


class OAuthClientContractSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    source: OAuthClientSource
    # None means this Client is missing or disabled.
    configuration_id: str | None
    fingerprint: str | None


class ProviderContractSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    plugin_unique_identifier: str
    provider: str
    oauth_clients: tuple[OAuthClientContractSnapshot, ...] = ()


class AuthorizationRequirementSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    allowed_credential_types: tuple[str, ...]
    node_id: str
    node_ids: tuple[str, ...]
    oauth_client_type: str | None
    provider: str
    purpose: str
    tool_name: str


class ConnectionContractSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    tenant_id: str
    app_id: str
    providers: tuple[ProviderContractSnapshot, ...]
    requirements: tuple[AuthorizationRequirementSnapshot, ...]

    def canonical_json(self) -> str:
        data = self.model_dump(mode="json")
        for provider in data["providers"]:
            provider["oauth_clients"] = sorted(provider["oauth_clients"], key=itemgetter("source"))
        data["providers"] = sorted(data["providers"], key=itemgetter("provider"))
        for requirement in data["requirements"]:
            requirement["node_ids"] = sorted(requirement["node_ids"])
            requirement["allowed_credential_types"] = sorted(requirement["allowed_credential_types"])
        data["requirements"] = sorted(data["requirements"], key=itemgetter("node_id"))
        return json.dumps(data, sort_keys=True, separators=(",", ":"))


@dataclass(frozen=True, slots=True)
class ConnectionRevisionAcceptance:
    revision_id: str
    source_revision_id: str | None

    @property
    def reason(self) -> ConnectionRevisionAcceptanceReason:
        if self.source_revision_id is None:
            return ConnectionRevisionAcceptanceReason.APPROVED
        return ConnectionRevisionAcceptanceReason.INHERITED

    @classmethod
    def from_revisions(cls, submitted: str, accepted: str) -> "ConnectionRevisionAcceptance":
        return cls(accepted, submitted if submitted != accepted else None)


class ConnectionRevisionSnapshots(Protocol):
    def oauth_client_snapshot(
        self, tenant_id: str, provider: str, source: OAuthClientSource
    ) -> OAuthClientContractSnapshot: ...

    def save_revision(self, snapshot: ConnectionContractSnapshot) -> str: ...

    def get_revision(self, tenant_id: str, app_id: str, revision: str) -> ConnectionContractSnapshot | None: ...


class ConnectionProviderRevisions(Protocol):
    def resolve(
        self, context: WebConnectionContext, provider: str, *, oauth_client_source: OAuthClientSource | None = None
    ) -> str: ...

    def require(
        self,
        context: WebConnectionContext,
        provider: str,
        revision: str,
        *,
        oauth_client_source: OAuthClientSource | None = None,
    ) -> ProviderContractSnapshot: ...

    def acceptance(
        self, context: WebConnectionContext, provider: str, revision: str, admitted: ProviderContractSnapshot
    ) -> ConnectionRevisionAcceptance: ...
