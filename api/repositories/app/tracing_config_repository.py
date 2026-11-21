"""SQLAlchemy persistence adapter for app tracing provider configurations and policies."""

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
from services.tracing.delivery import StoredTraceDestination, TraceDestinationQuery
from services.tracing.scopes import TracingPolicyQuery

_trace_settings = TypeAdapter(AppTraceSettings)


def trace_settings_from_column(raw: str | None) -> AppTraceSettings:
    """Read ``App.tracing`` for the trace pipeline: a value it cannot read disables tracing."""
    if not raw:
        return AppTraceSettings()
    try:
        stored = json.loads(raw)
    except ValueError:
        return AppTraceSettings()
    if not isinstance(stored, dict):
        return AppTraceSettings()
    provider = stored.get("tracing_provider")
    return AppTraceSettings(
        enabled=stored.get("enabled") is True,
        tracing_provider=provider if isinstance(provider, str) else None,
        capture_content=stored.get("capture_content") is True,
        capture_agent=stored.get("capture_agent") is not False,
    )


class SQLAlchemyAppTracingConfigRepository(AppTracingConfigStore, TracingPolicyQuery, TraceDestinationQuery):
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

    @override
    def policy(self, *, tenant_id: str, app_id: str) -> AppTraceSettings | None:
        with self._session_factory() as session:
            row = session.execute(select(App.tracing).where(App.id == app_id, App.tenant_id == tenant_id)).first()
        return trace_settings_from_column(row.tracing) if row is not None else None

    @override
    def active_destination(self, *, tenant_id: str, app_id: str) -> StoredTraceDestination | None:
        with self._session_factory() as session:
            settings = trace_settings_from_column(
                session.scalar(select(App.tracing).where(App.id == app_id, App.tenant_id == tenant_id))
            )
            if not settings.enabled or settings.tracing_provider is None:
                return None
            stored = session.scalar(
                select(TraceAppConfig.tracing_config)
                .join(App, App.id == TraceAppConfig.app_id)
                .where(
                    TraceAppConfig.app_id == app_id,
                    App.tenant_id == tenant_id,
                    TraceAppConfig.tracing_provider == settings.tracing_provider,
                    TraceAppConfig.is_active.is_(True),
                )
            )
        if not isinstance(stored, dict):
            return None
        return StoredTraceDestination(provider_id=settings.tracing_provider, config=dict(stored))

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
