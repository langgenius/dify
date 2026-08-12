from unittest.mock import MagicMock

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from models.model import Site
from repositories.webapp_access_query_repository import WebAppAccessQueryRepository
from services.webapp_access_query_service import WebAppAccessUnavailableError

_APP_ID = "11111111-1111-1111-1111-111111111111"


def test_find_app_id_by_code_returns_matching_site_app(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            Site(
                app_id=_APP_ID,
                code="site-code",
                title="Test Site",
                default_language="en-US",
                customize_token_strategy="uuid",
            )
        )

    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert repository.find_app_id_by_code("site-code") == _APP_ID


def test_find_app_id_by_code_returns_none_for_missing_code(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = WebAppAccessQueryRepository(session_factory=sqlite_session_factory)

    assert repository.find_app_id_by_code("missing-code") is None


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
