"""Trial execution admission for handlers using a detached app reference."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from controllers.console.explore.error import TrialAppFeatureDisabledError, TrialAppLimitExceeded, TrialAppNotAllowed
from extensions.ext_application_services import application_services
from machinery.context import RequestContext
from services.trial_app_access_service import (
    TrialAppRef,
    TrialAppUnavailableError,
    TrialAppUsageLimitExceededError,
)


def trial_feature_enable[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Gate trial execution before resolving app membership or account usage."""

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        if not application_services().recommended_app_queries.is_trial_enabled():
            raise TrialAppFeatureDisabledError()
        return view(*args, **kwargs)

    return decorated


def get_trial_app[T, **P, R](
    view: Callable[Concatenate[T, RequestContext, TrialAppRef, P], R],
) -> Callable[Concatenate[T, RequestContext, P], R]:
    """Check trial availability and inject an admitted app after Console admission."""

    @wraps(view)
    def decorated(self: T, request_context: RequestContext, /, *args: P.args, **kwargs: P.kwargs) -> R:
        app_id = kwargs.pop("app_id", None)
        if app_id is None:
            raise RuntimeError("The trial app admission route must provide app_id")
        try:
            trial_app = application_services().trial_app_access.get_access(
                app_id=str(app_id), account_id=request_context.account_id
            )
        except TrialAppUnavailableError as error:
            raise TrialAppNotAllowed() from error
        except TrialAppUsageLimitExceededError as error:
            raise TrialAppLimitExceeded() from error
        return view(self, request_context, trial_app, *args, **kwargs)

    return trial_feature_enable(decorated)
