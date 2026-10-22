"""SQLAlchemy persistence adapter for app tracing provider configurations."""

import json
from dataclasses import asdict, replace
from typing import Any, override

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import AppStatus
from models.model import App, TraceAppConfig
from repositories.app.console_visibility import console_visible_condition
from services.app_tracing_config_service import (
    AppTraceSettings,
    AppTracingConfigAppNotFoundError,
    AppTracingConfigConflictError,
    AppTracingConfigNotFoundError,
    AppTracingConfigRecord,
    AppTracingConfigStore,
)

_trace_settings = TypeAdapter(AppTraceSettings)


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
            self._require_app(session, workspace_id, app_id)
            config = self._get_config(session, app_id, tracing_provider)
            return self._to_record(config) if config is not None else None

    @override
    def create(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
        activate: bool = False,
    ) -> bool:
        with self._session_factory.begin() as session:
            app = self._require_app(session, workspace_id, app_id, lock=True)
            if self._get_config(session, app_id, tracing_provider) is not None:
                return False

            session.add(
                TraceAppConfig(
                    app_id=app_id,
                    tracing_provider=tracing_provider,
                    tracing_config=dict(tracing_config),
                )
            )
            if activate:
                self._activate(app, tracing_provider)
            return True

    @override
    def update(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
        expected: AppTracingConfigRecord,
        activate: bool = False,
    ) -> bool:
        with self._session_factory.begin() as session:
            app = self._require_app(session, workspace_id, app_id, lock=True)
            config = self._get_config(session, app_id, tracing_provider)
            if config is None:
                raise AppTracingConfigConflictError

            self._check_expected(config, expected)
            config.tracing_config = dict(tracing_config)
            if activate:
                config.is_active = True
                self._activate(app, tracing_provider)
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

            settings = self._settings(app)
            if settings.tracing_provider == tracing_provider:
                app.tracing = json.dumps(asdict(replace(settings, enabled=False, tracing_provider=None)))
            session.delete(config)
            return True

    @override
    def set_trace(
        self, *, workspace_id: str, app_id: str, settings: AppTraceSettings, expected: AppTracingConfigRecord | None
    ) -> None:
        with self._session_factory.begin() as session:
            app = self._require_app(session, workspace_id, app_id, lock=True)
            if settings.enabled:
                if settings.tracing_provider is None or expected is None:
                    raise AppTracingConfigNotFoundError
                config = self._get_config(session, app_id, settings.tracing_provider)
                if config is None:
                    raise AppTracingConfigConflictError
                self._check_expected(config, expected)
                if not config.is_active or not config.tracing_config:
                    raise AppTracingConfigNotFoundError
            app.tracing = json.dumps(asdict(settings))

    @staticmethod
    def _settings(app: App) -> AppTraceSettings:
        return _trace_settings.validate_json(app.tracing) if app.tracing else AppTraceSettings()

    @classmethod
    def _activate(cls, app: App, provider: str) -> None:
        app.tracing = json.dumps(asdict(replace(cls._settings(app), enabled=True, tracing_provider=provider)))

    @staticmethod
    def _check_expected(config: TraceAppConfig, expected: AppTracingConfigRecord) -> None:
        if (config.id, config.tracing_config, config.is_active) != (
            expected.id,
            expected.tracing_config,
            expected.is_active,
        ):
            raise AppTracingConfigConflictError

    @staticmethod
    def _require_app(session: Session, workspace_id: str, app_id: str, *, lock: bool = False) -> App:
        statement = select(App).where(
            App.id == app_id,
            App.tenant_id == workspace_id,
            App.status == AppStatus.NORMAL,
            console_visible_condition(),
        )
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
    def _to_record(config: TraceAppConfig) -> AppTracingConfigRecord:
        tracing_config = dict(config.tracing_config) if config.tracing_config is not None else None
        return AppTracingConfigRecord(
            id=config.id,
            app_id=config.app_id,
            tracing_provider=config.tracing_provider,
            tracing_config=tracing_config,
            is_active=config.is_active,
            created_at=config.created_at,
            updated_at=config.updated_at,
        )
