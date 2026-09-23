"""Persistence adapter for data-source API-key authentication bindings."""

import json
from copy import deepcopy
from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.source import DataSourceApiKeyAuthBinding
from services.auth.data_source_api_key_auth_service import DataSourceApiKeyAuthBindingRepository
from services.entities.data_source_api_key_auth_entities import (
    DataSourceApiKeyAuthBindingRecord,
    DataSourceApiKeyAuthCredentials,
)


class SQLAlchemyDataSourceApiKeyAuthBindingRepository(DataSourceApiKeyAuthBindingRepository):
    """Own a short-lived Session for every binding operation."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def list_enabled(self, workspace_id: str) -> tuple[DataSourceApiKeyAuthBindingRecord, ...]:
        stmt = (
            select(
                DataSourceApiKeyAuthBinding.id,
                DataSourceApiKeyAuthBinding.category,
                DataSourceApiKeyAuthBinding.provider,
                DataSourceApiKeyAuthBinding.disabled,
                DataSourceApiKeyAuthBinding.created_at,
                DataSourceApiKeyAuthBinding.updated_at,
            )
            .where(
                DataSourceApiKeyAuthBinding.tenant_id == workspace_id,
                DataSourceApiKeyAuthBinding.disabled.is_(False),
            )
            .order_by(DataSourceApiKeyAuthBinding.created_at.asc())
        )
        with self._session_factory() as session:
            rows = session.execute(stmt).all()

        return tuple(
            DataSourceApiKeyAuthBindingRecord(
                id=binding_id,
                category=category,
                provider=provider,
                disabled=bool(disabled),
                created_at=created_at,
                updated_at=updated_at,
            )
            for binding_id, category, provider, disabled, created_at, updated_at in rows
        )

    @override
    def create(
        self,
        workspace_id: str,
        category: str,
        provider: str,
        credentials: DataSourceApiKeyAuthCredentials,
    ) -> None:
        config = deepcopy(dict(credentials.options))
        config["api_key"] = credentials.api_key
        binding = DataSourceApiKeyAuthBinding(
            tenant_id=workspace_id,
            category=category,
            provider=provider,
            credentials=json.dumps(
                {"auth_type": credentials.auth_type, "config": config},
                ensure_ascii=False,
            ),
        )
        with self._session_factory.begin() as session:
            session.add(binding)

    @override
    def delete(self, workspace_id: str, binding_id: str) -> None:
        stmt = select(DataSourceApiKeyAuthBinding).where(
            DataSourceApiKeyAuthBinding.tenant_id == workspace_id,
            DataSourceApiKeyAuthBinding.id == binding_id,
        )
        with self._session_factory.begin() as session:
            binding = session.scalar(stmt)
            if binding is not None:
                session.delete(binding)
