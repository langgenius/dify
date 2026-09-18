"""Builder-driven app rename: usable proposals only, and never fatal."""

import contextlib
from unittest.mock import MagicMock, patch

import pytest

from services.dify_builder import app_naming


@pytest.fixture
def db_stubbed():
    """Stub the engine so nothing here needs a Flask app context.

    Without it the real ``db.engine`` raises, ``rename_app_from_proposal``
    swallows that, and every assertion below passes for the wrong reason.
    """
    with (
        patch.object(app_naming, "db", MagicMock()),
        patch.object(app_naming, "sessionmaker") as factory,
    ):
        factory.return_value.return_value = contextlib.nullcontext(MagicMock(name="session"))
        yield factory


def test_an_unusable_proposal_never_touches_the_database(db_stubbed):
    # No session is opened at all -- the derived name simply stands.
    app_naming.rename_app_from_proposal(app_id="a", tenant_id="t", account_id="acc", proposed='  ""  ')
    db_stubbed.assert_not_called()


@pytest.mark.usefixtures("db_stubbed")
def test_a_usable_proposal_is_normalized_before_it_is_stored():
    app = MagicMock()
    app.name = "Set up an expense"
    with (
        patch.object(app_naming, "AppService") as app_service,
        patch.object(app_naming, "_load_app", return_value=app),
    ):
        app_naming.rename_app_from_proposal(
            app_id="app-1", tenant_id="tenant-1", account_id="acc-1", proposed='  "Expense approval"\n'
        )
    app_service.return_value.rename_app.assert_called_once()
    args, kwargs = app_service.return_value.rename_app.call_args
    assert args[1] == "Expense approval"
    assert kwargs["account_id"] == "acc-1"


@pytest.mark.usefixtures("db_stubbed")
def test_a_proposal_equal_to_the_current_name_is_not_written():
    app = MagicMock()
    app.name = "Expense approval"
    with (
        patch.object(app_naming, "AppService") as app_service,
        patch.object(app_naming, "_load_app", return_value=app),
    ):
        app_naming.rename_app_from_proposal(
            app_id="app-1", tenant_id="tenant-1", account_id="acc-1", proposed="Expense approval"
        )
    app_service.return_value.rename_app.assert_not_called()


@pytest.mark.usefixtures("db_stubbed")
def test_a_missing_app_is_not_an_error():
    with (
        patch.object(app_naming, "AppService") as app_service,
        patch.object(app_naming, "_load_app", return_value=None),
    ):
        app_naming.rename_app_from_proposal(app_id="gone", tenant_id="t", account_id="acc", proposed="Anything")
    app_service.return_value.rename_app.assert_not_called()


@pytest.mark.usefixtures("db_stubbed")
def test_a_failing_rename_is_swallowed():
    # A cosmetic rename must never take the build down with it.
    with (
        patch.object(app_naming, "AppService", side_effect=RuntimeError("boom")),
        patch.object(app_naming, "_load_app", return_value=MagicMock()),
    ):
        app_naming.rename_app_from_proposal(app_id="a", tenant_id="t", account_id="acc", proposed="Expense approval")
