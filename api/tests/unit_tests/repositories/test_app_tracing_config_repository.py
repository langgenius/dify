from collections.abc import Callable

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from models.model import App, AppMode, TraceAppConfig
from repositories.app_tracing_config_repository import SQLAlchemyAppTracingConfigRepository
from services.app_tracing_config_service import AppTracingConfigAppNotFoundError, AppTracingConfigRecord

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
    )
    with sqlite_session_factory() as session:
        config = session.scalar(select(TraceAppConfig).where(TraceAppConfig.app_id == _APP_ID))
        assert config is not None
        assert config.tracing_config == {"public_key": "updated"}

    assert repository.delete(workspace_id=_WORKSPACE_ID, app_id=_APP_ID, tracing_provider=_PROVIDER)
    assert not repository.update(
        workspace_id=_WORKSPACE_ID,
        app_id=_APP_ID,
        tracing_provider=_PROVIDER,
        tracing_config={"public_key": "missing"},
    )
    assert not repository.delete(workspace_id=_WORKSPACE_ID, app_id=_APP_ID, tracing_provider=_PROVIDER)
    with sqlite_session_factory() as session:
        assert session.scalar(select(TraceAppConfig).where(TraceAppConfig.app_id == _APP_ID)) is None


@pytest.mark.parametrize("app_state", ["other-workspace", "non-normal"])
def test_all_operations_reject_apps_outside_the_active_workspace_scope(
    app_state: str,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app(sqlite_session)
    workspace_id = _OTHER_WORKSPACE_ID
    if app_state == "non-normal":
        sqlite_session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"), {"app_id": _APP_ID})
        sqlite_session.commit()
        workspace_id = _WORKSPACE_ID

    repository = _repository(sqlite_session_factory)
    operations: tuple[Callable[[], object], ...] = (
        lambda: repository.get(workspace_id=workspace_id, app_id=_APP_ID, tracing_provider=_PROVIDER),
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
