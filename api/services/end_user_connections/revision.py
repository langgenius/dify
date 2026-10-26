"""Content-addressed authorization contracts, independent of workflow publications."""

import hashlib
import json
from collections.abc import Mapping
from operator import itemgetter
from typing import Annotated, Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

from services.end_user_connections.entities import WebConnectionContext

ConnectionRevision = Annotated[str, Field(pattern=r"^cr_[0-9a-f]{64}$", min_length=67, max_length=67)]


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
    def revision(self) -> str:
        return "cr_" + hashlib.sha256(self.canonical_json().encode()).hexdigest()


class ConnectionRevisionSnapshots(Protocol):
    def save_revision(self, snapshot: ConnectionContractSnapshot) -> str: ...

    def get_revision(self, tenant_id: str, app_id: str, revision: str) -> ConnectionContractSnapshot | None: ...


class ConnectionRevisions(Protocol):
    def resolve(self, tenant_id: str, app_id: str, graph: Mapping[str, Any]) -> str: ...


class ConnectionProviderRevisions(Protocol):
    def resolve(self, context: WebConnectionContext, provider: str) -> str: ...

    def require(self, context: WebConnectionContext, provider: str, revision: str) -> ProviderContractSnapshot: ...

    def reference(self, context: WebConnectionContext, provider: str, revision: str) -> ProviderContractSnapshot:
        """Validate a persisted Provider reference without requiring its current installation."""
        ...
