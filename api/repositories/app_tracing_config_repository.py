"""SQLAlchemy persistence adapter for app tracing provider configurations."""

from typing import Any, override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import AppStatus
from models.model import App, TraceAppConfig
from services.app_tracing_config_service import (
    AppTracingConfigAppNotFoundError,
    AppTracingConfigChangedError,
    AppTracingConfigRecord,
    AppTracingConfigStore,
)


class SQLAlchemyAppTracingConfigRepository(AppTracingConfigStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
    ) -> AppTracingConfigRecord | None:
        with self._session_factory() as session:
            app = self._require_app(session, workspace_id, app_id)
            config = self._get_config(session, app_id, tracing_provider)
            return self._to_record(config, app.tracing_revision) if config is not None else None

    @override
    def create(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
    ) -> bool:
        with self._session_factory.begin() as session:
            app = self._require_app(session, workspace_id, app_id, lock=True)
            if self._get_config(session, app_id, tracing_provider) is not None:
                return False

            app.tracing_revision += 1
            session.add(
                TraceAppConfig(
                    app_id=app_id,
                    tracing_provider=tracing_provider,
                    tracing_config=dict(tracing_config),
                )
            )
            return True

    @override
    def update(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
        expected_revision: int,
    ) -> bool:
        with self._session_factory.begin() as session:
            app = self._require_app(session, workspace_id, app_id, lock=True)
            config = self._get_config(session, app_id, tracing_provider)
            if config is None:
                return False

            if app.tracing_revision != expected_revision:
                raise AppTracingConfigChangedError
            app.tracing_revision += 1
            config.tracing_config = dict(tracing_config)
            return True

    @override
    def delete(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
    ) -> bool:
        with self._session_factory.begin() as session:
            app = self._require_app(session, workspace_id, app_id, lock=True)
            config = self._get_config(session, app_id, tracing_provider)
            if config is None:
                return False

            app.tracing_revision += 1
            session.delete(config)
            return True

    @staticmethod
    def _require_app(session: Session, workspace_id: str, app_id: str, *, lock: bool = False) -> App:
        statement = select(App).where(App.id == app_id, App.tenant_id == workspace_id, App.status == AppStatus.NORMAL)
        if lock:
            statement = statement.with_for_update()
        app = session.scalar(statement)
        if app is None:
            raise AppTracingConfigAppNotFoundError
        return app

    @staticmethod
    def _get_config(session: Session, app_id: str, tracing_provider: str) -> TraceAppConfig | None:
        return session.scalar(
            select(TraceAppConfig)
            .where(
                TraceAppConfig.app_id == app_id,
                TraceAppConfig.tracing_provider == tracing_provider,
            )
            .limit(1)
        )

    @staticmethod
    def _to_record(config: TraceAppConfig, revision: int) -> AppTracingConfigRecord:
        tracing_config = dict(config.tracing_config) if config.tracing_config is not None else None
        return AppTracingConfigRecord(
            id=config.id,
            app_id=config.app_id,
            tracing_provider=config.tracing_provider,
            tracing_config=tracing_config,
            is_active=config.is_active,
            created_at=config.created_at,
            updated_at=config.updated_at,
            revision=revision,
        )
