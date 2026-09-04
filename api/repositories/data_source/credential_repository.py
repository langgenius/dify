"""Actor-aware SQLAlchemy repository for datasource credentials."""

from collections.abc import Mapping
from typing import cast

from pydantic import TypeAdapter
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.credential_permission import CredentialType
from models.oauth import DatasourceProvider
from services.credential_permission_service import CredentialPermissionService
from services.entities.data_source.credential import DatasourceCredentialRecord

_CREDENTIALS_ADAPTER = TypeAdapter(dict[str, object])


def _record(provider: DatasourceProvider) -> DatasourceCredentialRecord:
    return DatasourceCredentialRecord(
        id=provider.id,
        workspace_id=provider.tenant_id,
        name=provider.name,
        provider=provider.provider,
        plugin_id=provider.plugin_id,
        auth_type=provider.auth_type,
        encrypted_credentials=_CREDENTIALS_ADAPTER.validate_python(provider.encrypted_credentials),
        expires_at=provider.expires_at,
        updated_at=provider.updated_at,
    )


class SQLAlchemyDatasourceCredentialRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_visible(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> DatasourceCredentialRecord | None:
        query = select(DatasourceProvider).where(
            DatasourceProvider.tenant_id == workspace_id,
            DatasourceProvider.id == credential_id,
            DatasourceProvider.provider == provider,
            DatasourceProvider.plugin_id == plugin_id,
        )
        query = CredentialPermissionService.apply_visibility_filter_for_actor(
            query,
            tenant_id=workspace_id,
            model_id_column=DatasourceProvider.id,
            model_user_id_column=DatasourceProvider.user_id,
            model_visibility_column=DatasourceProvider.visibility,
            credential_type=CredentialType.DATASOURCE_PROVIDER,
            actor_id=actor_id,
        )
        with self._session_factory() as session:
            provider_record = session.scalar(query.limit(1))
            return _record(provider_record) if provider_record is not None else None

    def update_if_unchanged(
        self,
        *,
        record: DatasourceCredentialRecord,
        encrypted_credentials: Mapping[str, object],
        expires_at: int,
    ) -> bool:
        credentials = _CREDENTIALS_ADAPTER.validate_python(encrypted_credentials)
        with self._session_factory.begin() as session:
            result = session.execute(
                update(DatasourceProvider)
                .where(
                    DatasourceProvider.id == record.id,
                    DatasourceProvider.tenant_id == record.workspace_id,
                    DatasourceProvider.provider == record.provider,
                    DatasourceProvider.plugin_id == record.plugin_id,
                    DatasourceProvider.encrypted_credentials
                    == _CREDENTIALS_ADAPTER.validate_python(record.encrypted_credentials),
                    DatasourceProvider.expires_at == record.expires_at,
                )
                .values(
                    encrypted_credentials=credentials,
                    expires_at=expires_at,
                    updated_at=naive_utc_now(),
                )
            )
            return cast(CursorResult[object], result).rowcount == 1
