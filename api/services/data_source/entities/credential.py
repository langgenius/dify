"""Detached data contracts for datasource credentials."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class DatasourceCredentialRecord:
    id: str
    workspace_id: str
    owner_id: str | None
    name: str
    provider: str
    plugin_id: str
    auth_type: str
    encrypted_credentials: Mapping[str, object]
    expires_at: int
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class DatasourceOAuthClientConfigRecord:
    """Raw persisted OAuth client configuration detached from its SQLAlchemy session."""

    encrypted_tenant_params: Mapping[str, object] | None
    system_credentials: Mapping[str, object] | None
