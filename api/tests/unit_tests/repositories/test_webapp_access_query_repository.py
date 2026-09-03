from unittest.mock import MagicMock

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from models.enums import CustomizeTokenStrategy, EndUserType
from models.model import App, AppMode, EndUser, Site
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.webapp_access_query_service import WebAppAccessUnavailableError

_APP_ID = "11111111-1111-1111-1111-111111111111"
_TENANT_ID = "22222222-2222-2222-2222-222222222222"
_END_USER_ID = "33333333-3333-3333-3333-333333333333"


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
