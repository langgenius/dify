from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from typing import Any, Protocol, cast

from core.credit_usage import CreditUsageCreatedByInput, normalize_credit_usage_created_by

_credit_usage_metadata: ContextVar[dict[str, object] | None] = ContextVar(
    "credit_usage_metadata",
    default=None,
)


class _CreditUsageMetadataCarrier(Protocol):
    _request_metadata: Mapping[str, object] | None


def get_credit_usage_metadata() -> Mapping[str, object] | None:
    return _credit_usage_metadata.get()


@contextmanager
def use_credit_usage_metadata(metadata: Mapping[str, object] | None) -> Generator[None, None, None]:
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
