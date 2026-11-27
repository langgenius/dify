"""Reading the stored app name into a Builder session."""

from dataclasses import dataclass
from unittest.mock import patch

import pytest
import sqlalchemy.orm
from sqlalchemy import Engine

from models.model import App, AppMode
from services.dify_builder import app_naming
from tests.helpers.unit.model_factories import make_app


@dataclass(frozen=True)
class NamingDatabase:
    engine: Engine


@pytest.fixture
def db_stubbed(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: sqlalchemy.Engine,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
) -> None:
    """Use the actual database owner so swallowed setup errors cannot make tests pass."""
    monkeypatch.setattr(app_naming, "db", NamingDatabase(sqlite_engine))
    with sqlite_session_factory.begin() as session:
        session.add(make_app(app_id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW, name="Set up an expense"))


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
