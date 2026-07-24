from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

import controllers.console.explore.wraps as wraps_module
import models.model as model_module
from controllers.console.explore.error import (
    AppAccessDeniedError,
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
from models import AccountTrialAppRecord, App, AppMode, InstalledApp, TrialApp


def _bind_database(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    session_proxy = MagicMock(wraps=sqlite_session)
    session_proxy.return_value = sqlite_session
    monkeypatch.setattr(wraps_module.db, "session", session_proxy)
    monkeypatch.setattr(model_module.db, "session", session_proxy)


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
        return_value=(MagicMock(), tenant_id),
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
        return_value=(MagicMock(), tenant_id),
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
        return_value=(MagicMock(), app.tenant_id),
    ):
        result = view(installed_app.id)

    assert result.id == installed_app.id
    assert result.app is not None
    assert result.app.id == app.id


def test_user_allowed_to_access_app_denied():
    installed_app = MagicMock(app_id="app-1")

    @user_allowed_to_access_app
    def view(installed_app):
        return "ok"

    feature = MagicMock()
    feature.webapp_auth.enabled = True

    with (
        patch(
            "controllers.console.explore.wraps.current_account_with_tenant",
            return_value=(MagicMock(id="user-1"), None),
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
    installed_app = MagicMock(app_id="app-1")

    @user_allowed_to_access_app
    def view(installed_app):
        return "ok"

    feature = MagicMock()
    feature.webapp_auth.enabled = True

    with (
        patch(
            "controllers.console.explore.wraps.current_account_with_tenant",
            return_value=(MagicMock(id="user-1"), None),
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
        return_value=(MagicMock(id=str(uuid4())), None),
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
        return_value=(MagicMock(id=account_id), None),
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
        return_value=(MagicMock(id=account_id), None),
    ):
        result = view(app.id)

    assert result.id == app.id


def test_trial_feature_enable_disabled():
    @trial_feature_enable
    def view():
        return "ok"

    features = MagicMock(enable_trial_app=False)

    with patch(
        "controllers.console.explore.wraps.FeatureService.get_system_features",
        return_value=features,
    ):
        with pytest.raises(Forbidden):
            view()


def test_trial_feature_enable_enabled():
    @trial_feature_enable
    def view():
        return "ok"

    features = MagicMock(enable_trial_app=True)

    with patch(
        "controllers.console.explore.wraps.FeatureService.get_system_features",
        return_value=features,
    ):
        assert view() == "ok"


def test_installed_app_resource_decorators():
    decorators = InstalledAppResource.method_decorators
    assert len(decorators) == 4


def test_trial_app_resource_decorators():
    decorators = TrialAppResource.method_decorators
    assert len(decorators) == 3
