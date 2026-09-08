"""SQLAlchemy repository for OAuth data-source bindings."""

from collections.abc import Mapping
from typing import override

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.source import DataSourceOauthBinding
from services.data_source_oauth_service import DataSourceOAuthBindingRepository
from services.entities.data_source_oauth_entities import (
    DataSourceOAuthAuthorization,
    DataSourceOAuthBindingRecord,
)

_SOURCE_INFO_ADAPTER = TypeAdapter(dict[str, object])


class SQLAlchemyDataSourceOAuthBindingRepository(DataSourceOAuthBindingRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def upsert_authorization(
        self,
        *,
        workspace_id: str,
        provider: str,
        authorization: DataSourceOAuthAuthorization,
    ) -> None:
        source_info = _SOURCE_INFO_ADAPTER.validate_python(authorization.source_info)
        with self._session_factory.begin() as session:
            binding = session.scalar(
                select(DataSourceOauthBinding).where(
                    DataSourceOauthBinding.tenant_id == workspace_id,
                    DataSourceOauthBinding.provider == provider,
                    DataSourceOauthBinding.access_token == authorization.access_token,
                )
            )
            if binding is None:
                session.add(
                    DataSourceOauthBinding(
                        tenant_id=workspace_id,
                        provider=provider,
                        access_token=authorization.access_token,
                        source_info=source_info,
                    )
                )
                return

            binding.source_info = source_info
            binding.disabled = False
            binding.updated_at = naive_utc_now()

    @override
    def get_enabled(
        self,
        *,
        workspace_id: str,
        provider: str,
        binding_id: str,
    ) -> DataSourceOAuthBindingRecord | None:
        with self._session_factory() as session:
            binding = session.scalar(
                select(DataSourceOauthBinding).where(
                    DataSourceOauthBinding.tenant_id == workspace_id,
                    DataSourceOauthBinding.provider == provider,
                    DataSourceOauthBinding.id == binding_id,
                    DataSourceOauthBinding.disabled.is_(False),
                )
            )
            if binding is None:
                return None

            return DataSourceOAuthBindingRecord(
                id=binding.id,
                access_token=binding.access_token,
                source_info=_SOURCE_INFO_ADAPTER.validate_python(binding.source_info),
            )

    @override
    def update_source_info(
        self,
        *,
        workspace_id: str,
        provider: str,
        binding_id: str,
        source_info: Mapping[str, object],
    ) -> bool:
        validated_source_info = _SOURCE_INFO_ADAPTER.validate_python(source_info)
        with self._session_factory.begin() as session:
            binding = session.scalar(
                select(DataSourceOauthBinding).where(
                    DataSourceOauthBinding.tenant_id == workspace_id,
                    DataSourceOauthBinding.provider == provider,
                    DataSourceOauthBinding.id == binding_id,
                    DataSourceOauthBinding.disabled.is_(False),
                )
            )
            if binding is None:
                return False

            binding.source_info = validated_source_info
            binding.updated_at = naive_utc_now()
            return True
