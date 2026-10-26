"""Content-addressed authorization contracts, independent of workflow publications."""

import hashlib
import json
from collections.abc import Mapping
from operator import itemgetter
from typing import Annotated, Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

ConnectionRevision = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class ProviderContractSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str
    plugin_unique_identifier: str


class AuthorizationRequirementSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    node_id: str
    node_ids: tuple[str, ...]
    provider: str
    tool_name: str
    purpose: str
    allowed_credential_types: tuple[str, ...]
    oauth_client_type: str | None


class ConnectionContractSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    tenant_id: str
    app_id: str
    providers: tuple[ProviderContractSnapshot, ...]
    requirements: tuple[AuthorizationRequirementSnapshot, ...]

    @property
    def revision(self) -> str:
        data = self.model_dump(mode="json")
        data["providers"] = sorted(data["providers"], key=itemgetter("provider"))
        for requirement in data["requirements"]:
            requirement["node_ids"] = sorted(requirement["node_ids"])
            requirement["allowed_credential_types"] = sorted(requirement["allowed_credential_types"])
        data["requirements"] = sorted(data["requirements"], key=itemgetter("node_id"))
        payload = json.dumps(data, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode()).hexdigest()


class ConnectionRevisions(Protocol):
    def resolve(self, tenant_id: str, app_id: str, graph: Mapping[str, Any]) -> str: ...
