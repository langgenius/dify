import inspect
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
        if inspect.isgeneratorfunction(method):

            @wraps(method)
            def generator_wrapper(*args: object, **kwargs: object):
                # A synchronous generator runs in the caller's context: holding
                # the context around `yield from` would leave the metadata set
                # while the generator is suspended at a yield. Enter it only
                # while advancing the underlying generator so the caller's
                # context is restored before every value is handed back.
                generator = method(*args, **kwargs)

                def advance(operation: str, argument: object = None) -> object:
                    with use_credit_usage_metadata({"created_by": normalized_created_by}):
                        if operation == "next":
                            return next(generator)
                        if operation == "send":
                            return generator.send(argument)
                        return generator.throw(argument)

                try:
                    value = advance("next")
                except StopIteration as exc:
                    return exc.value

                while True:
                    try:
                        sent = yield value
                    except GeneratorExit:
                        with use_credit_usage_metadata({"created_by": normalized_created_by}):
                            generator.close()
                        raise
                    except BaseException as exc:
                        try:
                            value = advance("throw", exc)
                        except StopIteration as stop:
                            return stop.value
                    else:
                        try:
                            value = advance("send", sent)
                        except StopIteration as stop:
                            return stop.value

            return generator_wrapper

        @wraps(method)
        def wrapper(*args: object, **kwargs: object):
            with use_credit_usage_metadata({"created_by": normalized_created_by}):
                return method(*args, **kwargs)

        return wrapper

    return decorator
