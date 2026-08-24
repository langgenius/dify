from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, scoped_session
from werkzeug.exceptions import NotFound

import controllers.console.explore.wraps as wraps_module
import models.model as model_module
from controllers.console.explore.error import (
    AppAccessDeniedError,
    TrialAppFeatureDisabledError,
    TrialAppLimitExceeded,
    TrialAppNotAllowed,
)
from controllers.console.explore.wraps import (
    InstalledAppResource,
    TrialAppResource,
    installed_app_required,
    trial_app_required,
    trial_feature_enable,
    user_allowed_to_access_app,
)
from models import Account, AccountTrialAppRecord, App, AppMode, InstalledApp, TrialApp


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


def _installed_app(*, app_id: str, tenant_id: str) -> InstalledApp:
    return InstalledApp(
        tenant_id=tenant_id,
        app_id=app_id,
        app_owner_tenant_id=str(uuid4()),
        position=0,
        is_pinned=False,
        last_used_at=None,
    )


@pytest.mark.parametrize("sqlite_session", [(InstalledApp, App)], indirect=True)
def test_installed_app_required_not_found(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    tenant_id = str(uuid4())
    _bind_database(monkeypatch, sqlite_session)

    @installed_app_required
    def view(installed_app):
        return "ok"

    with patch(
        "controllers.console.explore.wraps.current_account_with_tenant",
        return_value=(_account(), tenant_id),
    ):
        with pytest.raises(NotFound):
            view(str(uuid4()))


@pytest.mark.parametrize("sqlite_session", [(InstalledApp, App)], indirect=True)
def test_installed_app_required_app_deleted(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    tenant_id = str(uuid4())
    installed_app = _installed_app(app_id=str(uuid4()), tenant_id=tenant_id)
    sqlite_session.add(installed_app)
    sqlite_session.commit()
    installed_app_id = installed_app.id
    _bind_database(monkeypatch, sqlite_session)

    @installed_app_required
    def view(installed_app):
        return "ok"

    with patch(
        "controllers.console.explore.wraps.current_account_with_tenant",
        return_value=(_account(), tenant_id),
    ):
        with pytest.raises(NotFound):
            view(installed_app_id)

    assert sqlite_session.get(InstalledApp, installed_app_id) is None


@pytest.mark.parametrize("sqlite_session", [(InstalledApp, App)], indirect=True)
def test_installed_app_required_success(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    app = _app()
    installed_app = _installed_app(app_id=app.id, tenant_id=app.tenant_id)
    sqlite_session.add_all([app, installed_app])
    sqlite_session.commit()
    _bind_database(monkeypatch, sqlite_session)

    @installed_app_required
    def view(installed_app):
        return installed_app

    with patch(
        "controllers.console.explore.wraps.current_account_with_tenant",
        return_value=(_account(), app.tenant_id),
    ):
        result = view(installed_app.id)

    assert result.id == installed_app.id
    assert result.app is not None
    assert result.app.id == app.id


def test_user_allowed_to_access_app_denied():
    installed_app = _installed_app(app_id="app-1", tenant_id="tenant-1")

    @user_allowed_to_access_app
    def view(installed_app):
        return "ok"

    feature = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=True))

    with (
        patch(
            "controllers.console.explore.wraps.current_account_with_tenant",
            return_value=(_account(account_id="user-1"), None),
        ),
        patch(
            "controllers.console.explore.wraps.FeatureService.get_system_features",
            return_value=feature,
        ),
        patch(
            "controllers.console.explore.wraps.EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp",
            return_value=False,
        ),
    ):
        with pytest.raises(AppAccessDeniedError):
            view(installed_app)


def test_user_allowed_to_access_app_success():
    installed_app = _installed_app(app_id="app-1", tenant_id="tenant-1")

    @user_allowed_to_access_app
    def view(installed_app):
        return "ok"

    feature = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=True))

    with (
        patch(
            "controllers.console.explore.wraps.current_account_with_tenant",
            return_value=(_account(account_id="user-1"), None),
        ),
        patch(
            "controllers.console.explore.wraps.FeatureService.get_system_features",
            return_value=feature,
        ),
        patch(
            "controllers.console.explore.wraps.EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp",
            return_value=True,
        ),
    ):
        assert view(installed_app) == "ok"


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


def test_installed_app_resource_decorators():
    decorators = InstalledAppResource.method_decorators
    assert len(decorators) == 4


def test_trial_app_resource_decorators():
    assert TrialAppResource.method_decorators == [
        trial_app_required,
        trial_feature_enable,
        wraps_module.account_initialization_required,
        wraps_module.login_required,
    ]
