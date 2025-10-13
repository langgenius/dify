from collections.abc import Callable
from functools import wraps
from typing import Concatenate, ParamSpec, TypeVar

from flask import abort
from flask_login import current_user
from flask_restx import Resource
from werkzeug.exceptions import NotFound

from controllers.console.explore.error import AppAccessDeniedError, TrialAppLimitExceeded, TrialAppNotAllowed
from controllers.console.wraps import account_initialization_required
from extensions.ext_database import db
from libs.login import login_required
from models import AccountTrialAppRecord, App, InstalledApp, TrialApp
from services.app_service import AppService
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService
from models.account import Account

P = ParamSpec("P")
R = TypeVar("R")
T = TypeVar("T")


def installed_app_required(view: Callable[Concatenate[InstalledApp, P], R] | None = None):
    def decorator(view: Callable[Concatenate[InstalledApp, P], R]):
        @wraps(view)
        def decorated(installed_app_id: str, *args: P.args, **kwargs: P.kwargs):
            assert isinstance(current_user, Account)
            assert current_user.current_tenant_id is not None
            installed_app = (
                db.session.query(InstalledApp)
                .where(
                    InstalledApp.id == str(installed_app_id), InstalledApp.tenant_id == current_user.current_tenant_id
                )
                .first()
            )

            if installed_app is None:
                raise NotFound("Installed app not found")

            if not installed_app.app:
                db.session.delete(installed_app)
                db.session.commit()

                raise NotFound("Installed app not found")

            return view(installed_app, *args, **kwargs)

        return decorated

    if view:
        return decorator(view)
    return decorator


def user_allowed_to_access_app(view: Callable[Concatenate[InstalledApp, P], R] | None = None):
    def decorator(view: Callable[Concatenate[InstalledApp, P], R]):
        @wraps(view)
        def decorated(installed_app: InstalledApp, *args: P.args, **kwargs: P.kwargs):
            feature = FeatureService.get_system_features()
            if feature.webapp_auth.enabled:
                assert isinstance(current_user, Account)
                app_id = installed_app.app_id
                app_code = AppService.get_app_code_by_id(app_id)
                res = EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(
                    user_id=str(current_user.id),
                    app_code=app_code,
                )
                if not res:
                    raise AppAccessDeniedError()

            return view(installed_app, *args, **kwargs)

        return decorated

    if view:
        return decorator(view)
    return decorator


def trial_app_required(view: Callable[Concatenate[App, P], R] | None = None):
    def decorator(view: Callable[Concatenate[App, P], R]):
        @wraps(view)
        def decorated(app_id: str, *args: P.args, **kwargs: P.kwargs):
            trial_app = db.session.query(TrialApp).where(TrialApp.app_id == str(app_id)).first()

            if trial_app is None:
                raise TrialAppNotAllowed()
            app = trial_app.app

            if app is None:
                raise TrialAppNotAllowed()

            account_trial_app_record = (
                db.session.query(AccountTrialAppRecord)
                .where(AccountTrialAppRecord.account_id == current_user.id, AccountTrialAppRecord.app_id == app_id)
                .first()
            )
            if account_trial_app_record:
                if account_trial_app_record.count >= trial_app.trial_limit:
                    raise TrialAppLimitExceeded()

            return view(app, *args, **kwargs)

        return decorated

    if view:
        return decorator(view)
    return decorator


def trial_feature_enable(view: Callable[..., R]) -> Callable[..., R]:
    @wraps(view)
    def decorated(*args, **kwargs):
        features = FeatureService.get_system_features()
        if not features.enable_trial_app:
            abort(403, "Trial app feature is not enabled.")
        return view(*args, **kwargs)

    return decorated


def explore_banner_enabled(view: Callable[..., R]) -> Callable[..., R]:
    @wraps(view)
    def decorated(*args, **kwargs):
        features = FeatureService.get_system_features()
        if not features.enable_explore_banner:
            abort(403, "Explore banner feature is not enabled.")
        return view(*args, **kwargs)

    return decorated


class InstalledAppResource(Resource):
    # must be reversed if there are multiple decorators

    method_decorators = [
        user_allowed_to_access_app,
        installed_app_required,
        account_initialization_required,
        login_required,
    ]


class TrialAppResource(Resource):
    # must be reversed if there are multiple decorators

    method_decorators = [
        trial_app_required,
        account_initialization_required,
        login_required,
    ]
