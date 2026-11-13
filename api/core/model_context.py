from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from typing import Any, Protocol, cast

from core.app.apps.exc import AppGenerateError
from core.credit_usage import CreditUsageCreatedByInput, normalize_credit_usage_created_by


class AppModerationRuntime(Protocol):
    """Injected invocation-local coordination; the kernel does not choose moderation backends or policies.

    App result shapes stay loosely typed so this shared kernel port does not pull
    configuration, persistence, or framework modules into unrelated callers.
    """

    def evaluate_input(self, app_config: Any, inputs: Mapping[str, object], query: str) -> Any: ...

    def evaluate_output(self, app_config: Any, text: str) -> Any: ...

    def output_evaluator(self, app_config: Any) -> Callable[[str], Any] | None: ...

    def replacement(self, app_config: Any, error: Exception) -> tuple[str, str] | None: ...

    def workflow_replacement(self, app_config: Any) -> Callable[[str], tuple[str, str] | None]: ...

    def workflow_error(self, app_config: Any, message: str) -> AppGenerateError | None: ...


_app_moderation_runtime: ContextVar[AppModerationRuntime | None] = ContextVar("app_moderation_runtime", default=None)


def get_app_moderation_runtime() -> AppModerationRuntime | None:
    """Return the injected coordinator, or None for independent app/model invocation."""
    return _app_moderation_runtime.get()


@contextmanager
def use_app_moderation_runtime(runtime: AppModerationRuntime) -> Generator[None]:
    """Bind a trusted runtime for worker context copies and restore the caller context on every exit."""
    token = _app_moderation_runtime.set(runtime)
    try:
        yield
    finally:
        _app_moderation_runtime.reset(token)


_credit_usage_metadata: ContextVar[dict[str, object] | None] = ContextVar(
    "credit_usage_metadata",
    default=None,
)


class _CreditUsageMetadataCarrier(Protocol):
    _request_metadata: Mapping[str, object] | None


def get_credit_usage_metadata() -> Mapping[str, object] | None:
    return _credit_usage_metadata.get()


@contextmanager
def use_credit_usage_metadata(metadata: Mapping[str, object] | None) -> Generator[None]:
    if metadata is None:
        yield
        return

    current_metadata = _credit_usage_metadata.get()
    effective_metadata = {**metadata, **(current_metadata or {})}
    token = _credit_usage_metadata.set(effective_metadata)
    try:
        yield
    finally:
        _credit_usage_metadata.reset(token)


def with_credit_usage_metadata(method: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(method)
    def wrapper(self, *args: object, **kwargs: object):
        carrier = cast(_CreditUsageMetadataCarrier, self)
        with use_credit_usage_metadata(carrier._request_metadata):
            return method(self, *args, **kwargs)

    return wrapper


def with_credit_usage_created_by(
    created_by: CreditUsageCreatedByInput,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    normalized_created_by = normalize_credit_usage_created_by(created_by)

    def decorator(method: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(method)
        def wrapper(*args: object, **kwargs: object):
            with use_credit_usage_metadata({"created_by": normalized_created_by}):
                return method(*args, **kwargs)

        return wrapper

    return decorator
