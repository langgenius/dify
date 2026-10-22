from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from services.credentials.query import CredentialQuery, DatasourceCredentialListItem


@dataclass(frozen=True)
class DatasourceCredentialLookup:
    workspace_id: str
    provider: str
    plugin_id: str
    actor_id: str | None


@dataclass
class DatasourceCredentialQuery(CredentialQuery):
    """Answers datasource credential lookups from a fixed list and records each lookup."""

    credentials: Sequence[DatasourceCredentialListItem] = ()
    lookups: list[DatasourceCredentialLookup] = field(default_factory=list)

    def list_datasources(
        self, *, workspace_id: str, provider: str, plugin_id: str, actor_id: str | None
    ) -> Sequence[DatasourceCredentialListItem]:
        self.lookups.append(
            DatasourceCredentialLookup(
                workspace_id=workspace_id, provider=provider, plugin_id=plugin_id, actor_id=actor_id
            )
        )
        return self.credentials


@dataclass(frozen=True)
class CredentialServices:
    """The part of the application services registry that credential controllers read."""

    credential_queries: CredentialQuery
