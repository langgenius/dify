from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine, event, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from models.enums import AppStatus, CustomizeTokenStrategy, EndUserType
from models.model import App, AppMode, AppModelConfig, EndUser, Site
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.webapp_access_query_service import WebAppAccessUnavailableError

_APP_ID = "11111111-1111-1111-1111-111111111111"
_TENANT_ID = "22222222-2222-2222-2222-222222222222"
_END_USER_ID = "33333333-3333-3333-3333-333333333333"
_OTHER_APP_ID = "44444444-4444-4444-4444-444444444444"
_OTHER_TENANT_ID = "55555555-5555-5555-5555-555555555555"


def _persist_webapp_session(session: Session, *, enable_site: bool = True) -> None:
    session.add(
        App(
            id=_APP_ID,
            tenant_id=_TENANT_ID,
            name="Session App",
            description="",
            mode=AppMode.CHAT,
            icon_type=None,
            icon=None,
            icon_background=None,
            enable_site=enable_site,
            enable_api=True,
        )
    )
    session.add(
        Site(
            app_id=_APP_ID,
            code="site-code",
            title="Test Site",
            default_language="en-US",
            customize_token_strategy=CustomizeTokenStrategy.UUID,
        )
    )
    session.add(
        EndUser(
            id=_END_USER_ID,
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            type=EndUserType.BROWSER,
            session_id="browser-session",
        )
    )
    session.commit()


def test_find_app_id_by_code_returns_matching_site_app(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        config = AppModelConfig(app_id=_APP_ID)
        config.id = "22222222-2222-2222-2222-222222222222"
        session.add(config)
        session.add(
            App(
                id=_APP_ID,
                tenant_id=_APP_ID,
                name="Test App",
                mode="chat",
                enable_site=True,
                enable_api=True,
                app_model_config_id=config.id,
            )
        )
        session.add(
            Site(
                app_id=_APP_ID,
                code="site-code",
                title="Test Site",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.UUID,
            )
        )

    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert repository.find_app_id_by_code("site-code") == _APP_ID
    assert repository.is_app_available(_APP_ID) is True


@pytest.mark.parametrize("disabled", ["app", "deleted-app", "missing-site", "site-status", "app-status"])
def test_inactive_or_dangling_site_does_not_resolve_as_public_app(
    sqlite_session_factory: sessionmaker[Session], disabled: str
) -> None:
    with sqlite_session_factory.begin() as session:
        if disabled != "deleted-app":
            config = AppModelConfig(app_id=_APP_ID)
            session.add(config)
            session.flush()
            session.add(
                App(
                    id=_APP_ID,
                    tenant_id=_APP_ID,
                    name="Test App",
                    mode="chat",
                    enable_site=disabled != "app",
                    enable_api=True,
                    app_model_config_id=config.id,
                )
            )
        if disabled != "missing-site":
            session.add(
                Site(
                    app_id=_APP_ID,
                    code="hidden",
                    title="Hidden",
                    status=AppStatus.NORMAL,
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.UUID,
                )
            )
        session.flush()
        if disabled == "site-status":
            session.execute(text("UPDATE sites SET status='disabled' WHERE app_id=:app_id"), {"app_id": _APP_ID})
        elif disabled == "app-status":
            session.execute(text("UPDATE apps SET status='disabled' WHERE id=:app_id"), {"app_id": _APP_ID})
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)
    assert repository.find_app_id_by_code("hidden") is None
    assert repository.is_app_available(_APP_ID) is False


def test_malformed_app_id_is_not_a_database_error() -> None:
    factory = MagicMock()
    repository = WebAppAccessQueryRepository(session_factory=factory)
    assert repository.is_app_available("not-an-app-id") is False
    factory.assert_not_called()


def test_app_id_database_failure_remains_unavailable(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
) -> None:
    database_error = OperationalError("select", {}, RuntimeError("connection failed"))

    def fail_query(*_args: object) -> None:
        raise database_error

    event.listen(sqlite_engine, "before_cursor_execute", fail_query)
    try:
        repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)
        with pytest.raises(WebAppAccessUnavailableError) as raised:
            repository.is_app_available(_APP_ID)
        assert raised.value.__cause__ is database_error
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", fail_query)


def test_find_app_id_by_code_returns_none_for_missing_code(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert repository.find_app_id_by_code("missing-code") is None


def test_find_active_session_returns_framework_neutral_record(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_webapp_session(sqlite_session)
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    record = repository.find_active_session(
        app_id=_APP_ID,
        app_code="site-code",
        end_user_id=_END_USER_ID,
    )

    assert record is not None
    assert record.end_user_session_id == "browser-session"


def test_find_active_session_rejects_disabled_app(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_webapp_session(sqlite_session, enable_site=False)
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert (
        repository.find_active_session(
            app_id=_APP_ID,
            app_code="site-code",
            end_user_id=_END_USER_ID,
        )
        is None
    )


@pytest.mark.parametrize(
    ("site_app_id", "end_user_app_id", "end_user_tenant_id"),
    [
        pytest.param(_OTHER_APP_ID, _APP_ID, _TENANT_ID, id="site-app-mismatch"),
        pytest.param(_APP_ID, _OTHER_APP_ID, _TENANT_ID, id="end-user-app-mismatch"),
        pytest.param(_APP_ID, _APP_ID, _OTHER_TENANT_ID, id="end-user-tenant-mismatch"),
    ],
)
def test_find_active_session_rejects_mismatched_owners(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    site_app_id: str,
    end_user_app_id: str,
    end_user_tenant_id: str,
) -> None:
    _persist_webapp_session(sqlite_session)
    with sqlite_session_factory.begin() as session:
        session.add(
            App(
                id=_OTHER_APP_ID,
                tenant_id=_TENANT_ID,
                name="Other App",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=True,
            )
        )
        site = session.scalar(select(Site).where(Site.code == "site-code"))
        end_user = session.get(EndUser, _END_USER_ID)
        assert site is not None
        assert end_user is not None
        site.app_id = site_app_id
        end_user.app_id = end_user_app_id
        end_user.tenant_id = end_user_tenant_id

    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert (
        repository.find_active_session(
            app_id=_APP_ID,
            app_code="site-code",
            end_user_id=_END_USER_ID,
        )
        is None
    )


@pytest.mark.parametrize(
    ("app_id", "app_code", "end_user_id"),
    [
        pytest.param(_OTHER_APP_ID, "site-code", _END_USER_ID, id="missing-app"),
        pytest.param(_APP_ID, "missing-code", _END_USER_ID, id="missing-site"),
        pytest.param(_APP_ID, "site-code", "66666666-6666-6666-6666-666666666666", id="missing-end-user"),
    ],
)
def test_find_active_session_rejects_missing_records(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    app_id: str,
    app_code: str,
    end_user_id: str,
) -> None:
    _persist_webapp_session(sqlite_session)
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert repository.find_active_session(app_id=app_id, app_code=app_code, end_user_id=end_user_id) is None


def test_find_app_id_by_code_maps_database_failures_to_unavailable() -> None:
    database_error = OperationalError("select", {}, RuntimeError("connection failed"))
    session = MagicMock()
    session.__enter__.return_value.scalar.side_effect = database_error
    repository = WebAppAccessQueryRepository(session_factory=MagicMock(return_value=session))

    with pytest.raises(WebAppAccessUnavailableError) as raised:
        repository.find_app_id_by_code("site-code")

    assert raised.value.__cause__ is database_error


def test_find_app_id_by_code_does_not_hide_unknown_errors() -> None:
    failure = TypeError("repository bug")
    session = MagicMock()
    session.__enter__.return_value.scalar.side_effect = failure
    repository = WebAppAccessQueryRepository(session_factory=MagicMock(return_value=session))

    with pytest.raises(TypeError) as raised:
        repository.find_app_id_by_code("site-code")

    assert raised.value is failure
