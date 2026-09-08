"""SQLAlchemy repository for OAuth data-source bindings."""

from collections.abc import Mapping
from typing import cast, override

from pydantic import TypeAdapter
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.source import DataSourceOauthBinding
from services.data_source.binding_application_service import BindingMutationResult, DataSourceBindingStore
from services.data_source.oauth_service import DataSourceOAuthBindingRepository
from services.entities.data_source.oauth import (
    DataSourceBindingSummary,
    DataSourceOAuthAuthorization,
    DataSourceOAuthBindingRecord,
)

_SOURCE_INFO_ADAPTER = TypeAdapter(dict[str, object])


class SQLAlchemyDataSourceOAuthBindingRepository(DataSourceOAuthBindingRepository, DataSourceBindingStore):
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
                    DataSourceOauthBinding.disabled.is_not(True),
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
                    DataSourceOauthBinding.disabled.is_not(True),
                )
            )
            if binding is None:
                return False

            binding.source_info = validated_source_info
            binding.updated_at = naive_utc_now()
            return True

    @override
    def list_enabled_bindings(self, *, workspace_id: str) -> tuple[DataSourceBindingSummary, ...]:
        with self._session_factory() as session:
            bindings = session.scalars(
                select(DataSourceOauthBinding).where(
                    DataSourceOauthBinding.tenant_id == workspace_id,
                    DataSourceOauthBinding.disabled.is_not(True),
                )
            ).all()
            return tuple(
                DataSourceBindingSummary(
                    id=binding.id,
                    provider=binding.provider,
                    created_at=binding.created_at,
                    disabled=False,
                    source_info=_SOURCE_INFO_ADAPTER.validate_python(binding.source_info),
                )
                for binding in bindings
            )

    @override
    def change_disabled_state(
        self,
        *,
        workspace_id: str,
        binding_id: str,
        disabled: bool,
    ) -> BindingMutationResult:
        state_predicate = (
            DataSourceOauthBinding.disabled.is_not(True) if disabled else DataSourceOauthBinding.disabled.is_(True)
        )
        with self._session_factory.begin() as session:
            result = session.execute(
                update(DataSourceOauthBinding)
                .where(
                    DataSourceOauthBinding.tenant_id == workspace_id,
                    DataSourceOauthBinding.id == binding_id,
                    state_predicate,
                )
                .values(disabled=disabled, updated_at=naive_utc_now())
            )
            if cast(CursorResult[object], result).rowcount == 1:
                return "updated"

            binding_exists = session.scalar(
                select(DataSourceOauthBinding.id)
                .where(
                    DataSourceOauthBinding.tenant_id == workspace_id,
                    DataSourceOauthBinding.id == binding_id,
                )
                .limit(1)
            )
            if binding_exists is None:
                return "not_found"
            return "already_disabled" if disabled else "already_enabled"
