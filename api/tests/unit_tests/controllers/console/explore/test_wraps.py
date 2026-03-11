from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

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


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def test_installed_app_required_not_found():
    @installed_app_required
    def view(installed_app):
        return "ok"

    with (
        patch(
            "controllers.console.explore.wraps.current_account_with_tenant",
            return_value=(MagicMock(), "tenant-1"),
        ),
        patch("controllers.console.explore.wraps.db.session.query") as q,
    ):
        q.return_value.where.return_value.first.return_value = None

        with pytest.raises(NotFound):
            view("app-id")


def test_installed_app_required_app_deleted():
    installed_app = MagicMock(app=None)

    @installed_app_required
    def view(installed_app):
        return "ok"

    with (
        patch(
            "controllers.console.explore.wraps.current_account_with_tenant",
            return_value=(MagicMock(), "tenant-1"),
        ),
        patch("controllers.console.explore.wraps.db.session.query") as q,
        patch("controllers.console.explore.wraps.db.session.delete"),
        patch("controllers.console.explore.wraps.db.session.commit"),
    ):
        q.return_value.where.return_value.first.return_value = installed_app

        with pytest.raises(NotFound):
            view("app-id")


def test_installed_app_required_success():
    installed_app = MagicMock(app=MagicMock())

    @installed_app_required
    def view(installed_app):
        return installed_app

    with (
        patch(
            "controllers.console.explore.wraps.current_account_with_tenant",
            return_value=(MagicMock(), "tenant-1"),
        ),
        patch("controllers.console.explore.wraps.db.session.query") as q,
    ):
        q.return_value.where.return_value.first.return_value = installed_app

        result = view("app-id")
        assert result == installed_app


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


def test_trial_app_required_not_allowed():
    @trial_app_required
    def view(app):
        return "ok"

    with (
        patch(
            "controllers.console.explore.wraps.current_account_with_tenant",
            return_value=(MagicMock(id="user-1"), None),
        ),
        patch("controllers.console.explore.wraps.db.session.query") as q,
    ):
        q.return_value.where.return_value.first.return_value = None

        with pytest.raises(TrialAppNotAllowed):
            view("app-id")


def test_trial_app_required_limit_exceeded():
    trial_app = MagicMock(trial_limit=1, app=MagicMock())
    record = MagicMock(count=1)

    @trial_app_required
    def view(app):
        return "ok"

    with (
        patch(
            "controllers.console.explore.wraps.current_account_with_tenant",
            return_value=(MagicMock(id="user-1"), None),
        ),
        patch("controllers.console.explore.wraps.db.session.query") as q,
    ):
        q.return_value.where.return_value.first.side_effect = [
            trial_app,
            record,
        ]

        with pytest.raises(TrialAppLimitExceeded):
            view("app-id")


def test_trial_app_required_success():
    trial_app = MagicMock(trial_limit=2, app=MagicMock())
    record = MagicMock(count=1)

    @trial_app_required
    def view(app):
        return app

    with (
        patch(
            "controllers.console.explore.wraps.current_account_with_tenant",
            return_value=(MagicMock(id="user-1"), None),
        ),
        patch("controllers.console.explore.wraps.db.session.query") as q,
    ):
        q.return_value.where.return_value.first.side_effect = [
            trial_app,
            record,
        ]

        result = view("app-id")
        assert result == trial_app.app


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
