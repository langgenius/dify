"""Safe datasource credential metadata queries for workspace-level API callers."""

from dataclasses import dataclass

from services.credentials.query import CredentialQuery


@dataclass(frozen=True, slots=True)
class DatasourceCredentialMetadata:
    id: str
    name: str
    type: str
    is_default: bool


class DatasourceCredentialMetadataService:
    """List and resolve datasource credential ids without exposing credential values."""

    def __init__(self, *, credential_query: CredentialQuery) -> None:
        self._credential_query = credential_query

    def list(self, *, tenant_id: str, plugin_id: str, provider: str) -> list[DatasourceCredentialMetadata]:
        # Dataset Service API keys and the KnowledgeFS bridge are workspace principals, not
        # account principals. Match datasource runtime binding, which is tenant-scoped.
        rows = self._credential_query.list_datasources(
            workspace_id=tenant_id,
            plugin_id=plugin_id,
            provider=provider,
            actor_id=None,
        )
        credentials = [
            DatasourceCredentialMetadata(
                id=row.id,
                name=row.name,
                type=row.auth_type,
                is_default=row.is_default,
            )
            for row in rows
        ]
        return sorted(credentials, key=lambda item: (not item.is_default, item.name.casefold(), item.id))

    def resolve_default(self, *, tenant_id: str, plugin_id: str, provider: str) -> DatasourceCredentialMetadata | None:
        credentials = self.list(tenant_id=tenant_id, plugin_id=plugin_id, provider=provider)
        fallback = credentials[0] if credentials else None
        return next((credential for credential in credentials if credential.is_default), fallback)
