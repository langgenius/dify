"""Actor-aware and trusted-source SQLAlchemy repository for datasource credentials."""

import json
from collections.abc import Mapping
from typing import cast

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.credential_permission import CredentialType
from models.dataset import Dataset, Document
from models.oauth import DatasourceOauthParamConfig, DatasourceOauthTenantParamConfig, DatasourceProvider
from repositories.credential_permission_repository import apply_credential_visibility_filter_for_actor
from services.entities.data_source.credential import DatasourceCredentialRecord, DatasourceOAuthClientConfigRecord

_CREDENTIALS_ADAPTER = TypeAdapter(dict[str, object])


def _source_mapping(value: object) -> Mapping[str, object]:
    try:
        if isinstance(value, str):
            return _CREDENTIALS_ADAPTER.validate_python(json.loads(value))
        return _CREDENTIALS_ADAPTER.validate_python(value)
    except (TypeError, ValueError, ValidationError):
        return {}


def datasource_credential_record(provider: DatasourceProvider) -> DatasourceCredentialRecord:
    return DatasourceCredentialRecord(
        id=provider.id,
        workspace_id=provider.tenant_id,
        owner_id=provider.user_id,
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
        query = apply_credential_visibility_filter_for_actor(
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
            return datasource_credential_record(provider_record) if provider_record is not None else None

    def get_oauth_client_config(
        self,
        *,
        workspace_id: str,
        provider: str,
        plugin_id: str,
    ) -> DatasourceOAuthClientConfigRecord:
        """Load OAuth client rows in one bounded read transaction."""

        with self._session_factory() as session:
            return read_oauth_client_config(session, workspace_id=workspace_id, provider=provider, plugin_id=plugin_id)

    def update_if_unchanged(
        self,
        *,
        record: DatasourceCredentialRecord,
        encrypted_credentials: Mapping[str, object],
        expires_at: int,
    ) -> bool:
        with self._session_factory.begin() as session:
            return update_datasource_credentials_if_unchanged(
                session, record=record, encrypted_credentials=encrypted_credentials, expires_at=expires_at
            )

    def get_for_stored_document(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        document_id: str,
        credential_id: str | None,
        provider: str,
        plugin_id: str,
    ) -> DatasourceCredentialRecord | None:
        with self._session_factory() as session:
            query = (
                select(DatasourceProvider, Document.data_source_info)
                .select_from(Document)
                .join(Dataset, Dataset.id == Document.dataset_id)
                .join(DatasourceProvider, DatasourceProvider.tenant_id == Document.tenant_id)
                .where(
                    Dataset.id == dataset_id,
                    Dataset.tenant_id == workspace_id,
                    Document.id == document_id,
                    Document.dataset_id == dataset_id,
                    Document.tenant_id == workspace_id,
                    Document.data_source_type == "notion_import",
                    DatasourceProvider.tenant_id == workspace_id,
                    DatasourceProvider.provider == provider,
                    DatasourceProvider.plugin_id == plugin_id,
                )
            )
            if credential_id is not None:
                query = query.where(DatasourceProvider.id == credential_id)
            else:
                query = query.where(DatasourceProvider.is_default.is_(True)).order_by(
                    DatasourceProvider.created_at.asc()
                )
            row = session.execute(query.limit(1)).one_or_none()
            if row is None:
                return None
            datasource_provider, raw_source_info = row
            source_info = _source_mapping(raw_source_info)
            if credential_id is not None and source_info.get("credential_id") != credential_id:
                return None
            return datasource_credential_record(datasource_provider)


def read_oauth_client_config(
    session: Session, *, workspace_id: str, provider: str, plugin_id: str
) -> DatasourceOAuthClientConfigRecord:
    tenant_config = session.scalar(
        select(DatasourceOauthTenantParamConfig)
        .where(
            DatasourceOauthTenantParamConfig.tenant_id == workspace_id,
            DatasourceOauthTenantParamConfig.provider == provider,
            DatasourceOauthTenantParamConfig.plugin_id == plugin_id,
            DatasourceOauthTenantParamConfig.enabled.is_(True),
        )
        .limit(1)
    )
    system_config = session.scalar(
        select(DatasourceOauthParamConfig)
        .where(
            DatasourceOauthParamConfig.provider == provider,
            DatasourceOauthParamConfig.plugin_id == plugin_id,
        )
        .limit(1)
    )
    return DatasourceOAuthClientConfigRecord(
        encrypted_tenant_params=(dict(tenant_config.client_params) if tenant_config is not None else None),
        system_credentials=(dict(system_config.system_credentials) if system_config is not None else None),
    )


def update_datasource_credentials_if_unchanged(
    session: Session,
    *,
    record: DatasourceCredentialRecord,
    encrypted_credentials: Mapping[str, object],
    expires_at: int,
) -> bool:
    credentials = _CREDENTIALS_ADAPTER.validate_python(encrypted_credentials)
    result = session.execute(
        update(DatasourceProvider)
        .where(
            DatasourceProvider.id == record.id,
            DatasourceProvider.tenant_id == record.workspace_id,
            DatasourceProvider.provider == record.provider,
            DatasourceProvider.plugin_id == record.plugin_id,
            DatasourceProvider.user_id == record.owner_id,
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


def read_provider_credentials(
    session: Session,
    *,
    workspace_id: str,
    provider: str,
    plugin_id: str,
    credential_id: str | None = None,
    first_only: bool = False,
) -> list[DatasourceProvider]:
    statement = (
        select(DatasourceProvider)
        .where(
            DatasourceProvider.tenant_id == workspace_id,
            DatasourceProvider.provider == provider,
            DatasourceProvider.plugin_id == plugin_id,
        )
        .order_by(DatasourceProvider.is_default.desc(), DatasourceProvider.created_at.asc())
    )
    if credential_id is not None:
        statement = statement.where(DatasourceProvider.id == credential_id)
    if first_only:
        statement = statement.limit(1)
    return list(session.scalars(statement))
