import json
from collections.abc import Callable
from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.model import App, AppMode, TraceAppConfig
from repositories.app.console_repository import ConsoleAppRepository
from repositories.app.tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from services.app_tracing_config_service import (
    AppTraceSettings,
    AppTracingConfigAppNotFoundError,
    AppTracingConfigConflictError,
    AppTracingConfigRecord,
)
from tests.helpers.unit.repositories.app.console_visibility import UNADDRESSABLE_IN_WORKSPACE, MakeUnaddressable

_APP_ID = "11111111-1111-1111-1111-111111111111"
_WORKSPACE_ID = "22222222-2222-2222-2222-222222222222"
_OTHER_WORKSPACE_ID = "33333333-3333-3333-3333-333333333333"
_PROVIDER = "langfuse"


def _persist_app(session: Session) -> None:
    session.add(
        App(
            id=_APP_ID,
            tenant_id=_WORKSPACE_ID,
            name="Tracing App",
            description="",
            mode=AppMode.CHAT,
            icon_type=None,
            icon=None,
            icon_background=None,
            enable_site=True,
            enable_api=True,
        )
    )
    session.commit()


def _repository(session_factory: sessionmaker[Session]) -> SQLAlchemyAppTracingConfigRepository:
    return SQLAlchemyAppTracingConfigRepository(session_factory=session_factory)


def test_config_lifecycle_is_persisted_by_owned_transactions(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app(sqlite_session)
    repository = _repository(sqlite_session_factory)

    assert repository.get(workspace_id=_WORKSPACE_ID, app_id=_APP_ID, tracing_provider=_PROVIDER) is None
    assert repository.create(
        workspace_id=_WORKSPACE_ID,
        app_id=_APP_ID,
        tracing_provider=_PROVIDER,
        tracing_config={"public_key": "original"},
    )
    assert not repository.create(
        workspace_id=_WORKSPACE_ID,
        app_id=_APP_ID,
        tracing_provider=_PROVIDER,
        tracing_config={"public_key": "duplicate"},
    )

    record = repository.get(workspace_id=_WORKSPACE_ID, app_id=_APP_ID, tracing_provider=_PROVIDER)
    assert isinstance(record, AppTracingConfigRecord)
    assert record.app_id == _APP_ID
    assert record.tracing_provider == _PROVIDER
    assert record.tracing_config == {"public_key": "original"}

    assert repository.update(
        workspace_id=_WORKSPACE_ID,
        app_id=_APP_ID,
        tracing_provider=_PROVIDER,
        tracing_config={"public_key": "updated"},
        expected=record,
    )
    with sqlite_session_factory() as session:
        config = session.scalar(select(TraceAppConfig).where(TraceAppConfig.app_id == _APP_ID))
        assert config is not None
        assert config.tracing_config == {"public_key": "updated"}

    assert repository.delete(workspace_id=_WORKSPACE_ID, app_id=_APP_ID, tracing_provider=_PROVIDER)
    with pytest.raises(AppTracingConfigConflictError):
        repository.update(
            workspace_id=_WORKSPACE_ID,
            app_id=_APP_ID,
            tracing_provider=_PROVIDER,
            tracing_config={"public_key": "missing"},
            expected=record,
        )
    assert not repository.delete(workspace_id=_WORKSPACE_ID, app_id=_APP_ID, tracing_provider=_PROVIDER)
    with sqlite_session_factory() as session:
        assert session.scalar(select(TraceAppConfig).where(TraceAppConfig.app_id == _APP_ID)) is None


@pytest.mark.parametrize(
    ("workspace_id", "make_unaddressable"),
    [pytest.param(_OTHER_WORKSPACE_ID, None, id="other-workspace")]
    + [pytest.param(_WORKSPACE_ID, *case.values, id=case.id) for case in UNADDRESSABLE_IN_WORKSPACE],
)
def test_all_operations_reject_apps_console_cannot_address(
    workspace_id: str,
    make_unaddressable: MakeUnaddressable | None,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app(sqlite_session)
    if make_unaddressable is not None:
        with sqlite_session_factory.begin() as session:
            make_unaddressable(session, _APP_ID)

    repository = _repository(sqlite_session_factory)
    operations: tuple[Callable[[], object], ...] = (
        lambda: repository.get(workspace_id=workspace_id, app_id=_APP_ID, tracing_provider=_PROVIDER),
        lambda: repository.set_trace(
            workspace_id=workspace_id, app_id=_APP_ID, settings=AppTraceSettings(), expected=None
        ),
        lambda: repository.create(
            workspace_id=workspace_id,
            app_id=_APP_ID,
            tracing_provider=_PROVIDER,
            tracing_config={},
        ),
        lambda: repository.update(
            workspace_id=workspace_id,
            app_id=_APP_ID,
            tracing_provider=_PROVIDER,
            tracing_config={},
            expected=AppTracingConfigRecord("config", _APP_ID, _PROVIDER, {}, True, datetime.now(), datetime.now()),
        ),
        lambda: repository.delete(workspace_id=workspace_id, app_id=_APP_ID, tracing_provider=_PROVIDER),
    )

    for operation in operations:
        with pytest.raises(AppTracingConfigAppNotFoundError):
            operation()


def test_record_mapping_does_not_expose_the_orm_model_or_its_config_dict(
    sqlite_session: Session,
) -> None:
    _persist_app(sqlite_session)
    config = TraceAppConfig(
        app_id=_APP_ID,
        tracing_provider=_PROVIDER,
        tracing_config={"public_key": "original"},
    )
    sqlite_session.add(config)
    sqlite_session.commit()

    record = SQLAlchemyAppTracingConfigRepository._to_record(config)

    assert isinstance(record, AppTracingConfigRecord)
    assert record is not config
    assert record.tracing_config == config.tracing_config
    assert record.tracing_config is not config.tracing_config
    assert record.tracing_config is not None
    record.tracing_config["public_key"] = "changed"
    assert config.tracing_config == {"public_key": "original"}


"""Tracing policy round-trips without dropping content or Agent capture choices."""


def test_capture_policy_round_trip_and_legacy_defaults(sqlite_session_factory: sessionmaker[Session]) -> None:
    context = RequestContext("request", None, "account", "tenant")
    with sqlite_session_factory.begin() as session:
        session.add(
            App(
                id="app",
                tenant_id="tenant",
                name="Trace app",
                mode="workflow",
                enable_site=False,
                enable_api=False,
                tracing=json.dumps({"enabled": True, "tracing_provider": "langfuse"}),
            )
        )
    repository = ConsoleAppRepository(session_factory=sqlite_session_factory)
    assert repository.get_trace(context, "app") == AppTraceSettings(True, "langfuse", False, True)
    writer = SQLAlchemyAppTracingConfigRepository(session_factory=sqlite_session_factory)
    writer.create(
        workspace_id="tenant", app_id="app", tracing_provider="langfuse", tracing_config={"secret": "encrypted"}
    )
    expected = writer.get(workspace_id="tenant", app_id="app", tracing_provider="langfuse")
    policy = AppTraceSettings(True, "langfuse", True, False)
    writer.set_trace(workspace_id="tenant", app_id="app", settings=policy, expected=expected)
    assert repository.get_trace(context, "app") == policy
    with sqlite_session_factory() as session:
        app = session.get(App, "app")
        assert app is not None
        assert app.tracing is not None
        assert json.loads(app.tracing) == {
            "enabled": True,
            "tracing_provider": "langfuse",
            "capture_content": True,
            "capture_agent": False,
        }
    with pytest.raises(AppTracingConfigAppNotFoundError):
        writer.set_trace(workspace_id="other-tenant", app_id="app", settings=AppTraceSettings(), expected=None)
    assert repository.get_trace(context, "app") == policy
