from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask_restx import Resource
from sqlalchemy import select

from controllers.console.explore.error import (
    TrialAppFeatureDisabledError,
    TrialAppLimitExceeded,
    TrialAppNotAllowed,
)
from controllers.console.wraps import account_initialization_required
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models import AccountTrialAppRecord, App, TrialApp


def trial_app_required[**P, R](view: Callable[Concatenate[App, P], R] | None = None):
    def decorator(view: Callable[Concatenate[App, P], R]):
        @wraps(view)
        def decorated(app_id: str, *args: P.args, **kwargs: P.kwargs):
            current_user, _ = current_account_with_tenant()
            session = db.session()

            trial_app = session.scalar(select(TrialApp).where(TrialApp.app_id == str(app_id)).limit(1))

            if trial_app is None:
                raise TrialAppNotAllowed()
            app = trial_app.app_with_session(session=session)

            if app is None:
                raise TrialAppNotAllowed()

            account_trial_app_record = session.scalar(
                select(AccountTrialAppRecord)
                .where(AccountTrialAppRecord.account_id == current_user.id, AccountTrialAppRecord.app_id == app_id)
                .limit(1)
            )
            if account_trial_app_record:
                if account_trial_app_record.count >= trial_app.trial_limit:
                    raise TrialAppLimitExceeded()

            return view(app, *args, **kwargs)

        return decorated

    if view:
        return decorator(view)
    return decorator


def trial_feature_enable[**P, R](view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        if not application_services().recommended_app_queries.is_trial_enabled():
            raise TrialAppFeatureDisabledError()
        return view(*args, **kwargs)

    return decorated


class TrialAppResource(Resource):
    # must be reversed if there are multiple decorators

    method_decorators = [
        trial_app_required,
        trial_feature_enable,
        account_initialization_required,
        login_required,
    ]
