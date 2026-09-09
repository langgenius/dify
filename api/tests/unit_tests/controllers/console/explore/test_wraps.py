from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, scoped_session

import controllers.console.explore.wraps as wraps_module
import models.model as model_module
from controllers.console.explore.error import (
    TrialAppFeatureDisabledError,
    TrialAppLimitExceeded,
    TrialAppNotAllowed,
)
from controllers.console.explore.wraps import (
    TrialAppResource,
    trial_app_required,
    trial_feature_enable,
)
from models import Account, AccountTrialAppRecord, App, AppMode, TrialApp


def _bind_database(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    session_registry = scoped_session(lambda: sqlite_session)
    monkeypatch.setattr(wraps_module.db, "session", session_registry)
    monkeypatch.setattr(model_module.db, "session", session_registry)


def _account(*, account_id: str | None = None) -> Account:
    account = Account(name="Explore user", email="user@example.com")
    if account_id is not None:
        account.id = account_id
    return account


def _app() -> App:
    app = App(
        tenant_id=str(uuid4()),
        name="Explore App",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
    )
    app.id = str(uuid4())
    return app


@pytest.mark.parametrize("sqlite_session", [(TrialApp, App, AccountTrialAppRecord)], indirect=True)
def test_trial_app_required_not_allowed(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    _bind_database(monkeypatch, sqlite_session)

    @trial_app_required
    def view(app):
        return "ok"

    with patch(
        "controllers.console.explore.wraps.current_account_with_tenant",
        return_value=(_account(account_id=str(uuid4())), None),
    ):
        with pytest.raises(TrialAppNotAllowed):
            view(str(uuid4()))


@pytest.mark.parametrize("sqlite_session", [(TrialApp, App, AccountTrialAppRecord)], indirect=True)
def test_trial_app_required_limit_exceeded(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    account_id = str(uuid4())
    app = _app()
    trial_app = TrialApp(app_id=app.id, tenant_id=app.tenant_id, trial_limit=1)
    record = AccountTrialAppRecord(account_id=account_id, app_id=app.id, count=1)
    sqlite_session.add_all([app, trial_app, record])
    sqlite_session.commit()
    _bind_database(monkeypatch, sqlite_session)

    @trial_app_required
    def view(app):
        return "ok"

    with patch(
        "controllers.console.explore.wraps.current_account_with_tenant",
        return_value=(_account(account_id=account_id), None),
    ):
        with pytest.raises(TrialAppLimitExceeded):
            view(app.id)


@pytest.mark.parametrize("sqlite_session", [(TrialApp, App, AccountTrialAppRecord)], indirect=True)
def test_trial_app_required_success(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    account_id = str(uuid4())
    app = _app()
    trial_app = TrialApp(app_id=app.id, tenant_id=app.tenant_id, trial_limit=2)
    record = AccountTrialAppRecord(account_id=account_id, app_id=app.id, count=1)
    sqlite_session.add_all([app, trial_app, record])
    sqlite_session.commit()
    _bind_database(monkeypatch, sqlite_session)

    @trial_app_required
    def view(app):
        return app

    with patch(
        "controllers.console.explore.wraps.current_account_with_tenant",
        return_value=(_account(account_id=account_id), None),
    ):
        result = view(app.id)

    assert result.id == app.id


def test_trial_feature_enable_disabled():
    @trial_feature_enable
    def view():
        return "ok"

    services = MagicMock()
    services.recommended_app_queries.is_trial_enabled.return_value = False
    with patch("controllers.console.explore.wraps.application_services", return_value=services):
        with pytest.raises(TrialAppFeatureDisabledError) as exc_info:
            view()

    assert exc_info.value.data == {
        "code": "trial_app_feature_disabled",
        "message": "Trial app feature is not enabled.",
        "status": 403,
    }


def test_trial_feature_enable_enabled():
    @trial_feature_enable
    def view():
        return "ok"

    services = MagicMock()
    services.recommended_app_queries.is_trial_enabled.return_value = True
    with patch("controllers.console.explore.wraps.application_services", return_value=services):
        assert view() == "ok"


def test_trial_app_resource_decorators():
    assert TrialAppResource.method_decorators == [
        trial_app_required,
        trial_feature_enable,
        wraps_module.account_initialization_required,
        wraps_module.login_required,
    ]
