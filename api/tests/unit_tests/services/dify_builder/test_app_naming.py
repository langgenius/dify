"""Builder-driven app rename: usable proposals only, and never fatal."""

from dataclasses import dataclass
from unittest.mock import Mock, patch

import pytest
import pytest_mock
import sqlalchemy.orm
from sqlalchemy import Engine

from models.model import App, AppMode
from services.dify_builder import app_naming
from tests.unit_tests.model_factories import make_app


@dataclass(frozen=True)
class NamingDatabase:
    engine: Engine


@pytest.fixture
def db_stubbed(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: sqlalchemy.Engine,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    mocker: pytest_mock.MockerFixture,
) -> Mock:
    """Use the actual database owner so swallowed setup errors cannot make tests pass."""
    monkeypatch.setattr(app_naming, "db", NamingDatabase(sqlite_engine))
    with sqlite_session_factory.begin() as session:
        session.add(make_app(app_id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW, name="Set up an expense"))
    return mocker.spy(app_naming, "sessionmaker")


def test_an_unusable_proposal_never_touches_the_database(db_stubbed: Mock) -> None:
    stored = app_naming.rename_app_from_proposal(app_id="a", tenant_id="t", account_id="acc", proposed='  ""  ')
    assert stored == ""
    db_stubbed.assert_not_called()


@pytest.mark.usefixtures("db_stubbed")
def test_a_usable_proposal_is_normalized_before_it_is_stored(
    mocker: pytest_mock.MockerFixture, sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session]
) -> None:
    # Only the notification boundary is inert; native rename and SQL commit execute.
    import services.app_service as owner

    mocker.patch.object(owner.app_was_updated, "send", return_value=[])
    rename = mocker.spy(app_naming.AppService, "rename_app")
    stored = app_naming.rename_app_from_proposal(
        app_id="app-1", tenant_id="tenant-1", account_id="acc-1", proposed='  "Expense approval"\n'
    )
    rename.assert_called_once()
    args, kwargs = rename.call_args
    assert args[2] == "Expense approval"
    assert kwargs["account_id"] == "acc-1"
    assert stored == "Expense approval"
    with sqlite_session_factory() as session:
        row = session.get(App, "app-1")
        assert row is not None
        assert (row.name, row.updated_by) == (stored, "acc-1")


@pytest.mark.usefixtures("db_stubbed")
def test_a_proposal_equal_to_the_current_name_is_not_written(
    mocker: pytest_mock.MockerFixture, sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, "app-1")
        assert app is not None
        app.name = "Expense approval"
    rename = mocker.spy(app_naming.AppService, "rename_app")
    stored = app_naming.rename_app_from_proposal(
        app_id="app-1", tenant_id="tenant-1", account_id="acc-1", proposed="Expense approval"
    )
    rename.assert_not_called()
    assert stored == "Expense approval"


@pytest.mark.usefixtures("db_stubbed")
def test_a_missing_app_is_not_an_error(mocker: pytest_mock.MockerFixture) -> None:
    rename = mocker.spy(app_naming.AppService, "rename_app")
    stored = app_naming.rename_app_from_proposal(app_id="gone", tenant_id="t", account_id="acc", proposed="Anything")
    rename.assert_not_called()
    assert stored == ""


@pytest.mark.usefixtures("db_stubbed")
def test_a_failing_rename_is_swallowed(mocker: pytest_mock.MockerFixture) -> None:
    mocker.patch.object(app_naming.AppService, "__init__", side_effect=RuntimeError("boom"))
    assert (
        app_naming.rename_app_from_proposal(
            app_id="app-1", tenant_id="tenant-1", account_id="acc-1", proposed="Expense approval"
        )
        == ""
    )


@pytest.mark.usefixtures("db_stubbed")
def test_current_app_name_reads_the_stored_name(
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, "app-1")
        assert app is not None
        app.name = "Refund approval"
    assert app_naming.current_app_name(app_id="app-1", tenant_id="tenant-1") == "Refund approval"


@pytest.mark.usefixtures("db_stubbed")
def test_current_app_name_is_empty_for_an_app_it_cannot_read() -> None:
    assert app_naming.current_app_name(app_id="gone", tenant_id="t") == ""


@pytest.mark.usefixtures("db_stubbed")
def test_current_app_name_swallows_a_failing_read() -> None:
    with patch.object(app_naming, "_load_app", side_effect=RuntimeError("boom")):
        assert app_naming.current_app_name(app_id="a", tenant_id="t") == ""
