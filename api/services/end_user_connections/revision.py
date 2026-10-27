"""Content-addressed authorization contracts, independent of workflow publications."""

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from operator import itemgetter
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict

from constants.end_user_connections import ConnectionRevisionAcceptanceReason
from libs.helper import UUIDStr
from services.end_user_connections.entities import WebConnectionContext

ConnectionRevision = UUIDStr


class ProviderContractSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    plugin_unique_identifier: str
    provider: str


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
        data["providers"] = sorted(data["providers"], key=itemgetter("provider"))
        for requirement in data["requirements"]:
            requirement["node_ids"] = sorted(requirement["node_ids"])
            requirement["allowed_credential_types"] = sorted(requirement["allowed_credential_types"])
        data["requirements"] = sorted(data["requirements"], key=itemgetter("node_id"))
        return json.dumps(data, sort_keys=True, separators=(",", ":"))

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(self.canonical_json().encode()).hexdigest()


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
    def save_revision(self, snapshot: ConnectionContractSnapshot) -> str: ...

    def get_revision(self, tenant_id: str, app_id: str, revision: str) -> ConnectionContractSnapshot | None: ...


class ConnectionRevisions(Protocol):
    def resolve(self, tenant_id: str, app_id: str, graph: Mapping[str, Any]) -> str: ...


class ConnectionProviderRevisions(Protocol):
    def resolve(self, context: WebConnectionContext, provider: str) -> str: ...

    def require(self, context: WebConnectionContext, provider: str, revision: str) -> ProviderContractSnapshot: ...

    def acceptance(
        self, context: WebConnectionContext, provider: str, revision: str, admitted: ProviderContractSnapshot
    ) -> ConnectionRevisionAcceptance: ...
