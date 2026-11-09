from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from typing import TYPE_CHECKING, Any, Literal, Protocol, cast

from core.credit_usage import CreditUsageCreatedByInput, normalize_credit_usage_created_by

if TYPE_CHECKING:
    from core.app.app_config.entities import AppConfig
    from core.app.entities.app_invoke_entities import AppGenerateEntity


class AppModerationRuntime(Protocol):
    """Injected invocation-local coordination; the kernel does not choose moderation backends or policies."""

    def configure(self, entity: "AppGenerateEntity") -> None: ...

    def check_openai(
        self, tenant_id: str, app_id: str, inputs: Mapping[str, object], phase: Literal["input", "output"]
    ) -> bool | None: ...

    def output_checker(self, app_config: "AppConfig") -> Callable[[str], bool | None] | None: ...

    def replacement(self, app_config: "AppConfig", error: Exception) -> tuple[str, str] | None: ...

    def workflow_replacement(self, app_config: "AppConfig") -> Callable[[str], tuple[str, str] | None]: ...


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
