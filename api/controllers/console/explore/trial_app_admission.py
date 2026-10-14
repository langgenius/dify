"""Trial execution admission for handlers using a detached app reference."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from controllers.console.explore.error import TrialAppFeatureDisabledError, TrialAppLimitExceeded, TrialAppNotAllowed
from extensions.ext_application_services import application_services
from libs.external_api import document_errors
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

    return document_errors(decorated, TrialAppFeatureDisabledError)


def _admit_trial_app(request_context: RequestContext, kwargs: dict[str, object], *, check_usage: bool) -> TrialAppRef:
    """Resolve the route's trial app for the caller; quota is only checked when asked."""
    app_id = kwargs.pop("app_id", None)
    if app_id is None:
        raise RuntimeError("The trial app admission route must provide app_id")
    try:
        return application_services().trial_apps.access.get_access(
            app_id=str(app_id), account_id=request_context.account_id, check_usage=check_usage
        )
    except TrialAppUnavailableError as error:
        raise TrialAppNotAllowed() from error


def get_trial_app[T, **P, R](
    view: Callable[Concatenate[T, RequestContext, TrialAppRef, P], R],
) -> Callable[Concatenate[T, RequestContext, P], R]:
    """Admit the trial app for a generation, which needs remaining quota."""

    @wraps(view)
    def decorated(self: T, request_context: RequestContext, /, *args: P.args, **kwargs: P.kwargs) -> R:
        try:
            trial_app = _admit_trial_app(request_context, kwargs, check_usage=True)
        except TrialAppUsageLimitExceededError as error:
            raise TrialAppLimitExceeded() from error
        return view(self, request_context, trial_app, *args, **kwargs)

    return trial_feature_enable(document_errors(decorated, TrialAppNotAllowed, TrialAppLimitExceeded))


def get_trial_app_for_stop[T, **P, R](
    view: Callable[Concatenate[T, RequestContext, TrialAppRef, P], R],
) -> Callable[Concatenate[T, RequestContext, P], R]:
    """Admit the trial app for a cancellation, which needs access but no remaining quota."""

    @wraps(view)
    def decorated(self: T, request_context: RequestContext, /, *args: P.args, **kwargs: P.kwargs) -> R:
        trial_app = _admit_trial_app(request_context, kwargs, check_usage=False)
        return view(self, request_context, trial_app, *args, **kwargs)

    return trial_feature_enable(document_errors(decorated, TrialAppNotAllowed))
