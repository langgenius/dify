from concurrent.futures import ThreadPoolExecutor

import pytest
from opentelemetry import context as otel_context

from extensions.otel.context import propagate_context


def test_propagate_context_captures_context_when_wrapped() -> None:
    context_key = otel_context.create_key("test-context")
    captured_context = otel_context.set_value(context_key, "captured")

    token = otel_context.attach(captured_context)
    try:
        wrapped = propagate_context(lambda: otel_context.get_value(context_key))
    finally:
        otel_context.detach(token)

    with ThreadPoolExecutor(max_workers=1) as executor:
        assert executor.submit(wrapped).result() == "captured"


def test_propagate_context_detaches_context_after_exception() -> None:
    context_key = otel_context.create_key("test-context")
    captured_context = otel_context.set_value(context_key, "captured")

    def raise_error() -> None:
        raise RuntimeError("retrieval failed")

    token = otel_context.attach(captured_context)
    try:
        wrapped = propagate_context(raise_error)
    finally:
        otel_context.detach(token)

    def invoke_and_read_context() -> str | None:
        with pytest.raises(RuntimeError, match="retrieval failed"):
            wrapped()
        return otel_context.get_value(context_key)

    with ThreadPoolExecutor(max_workers=1) as executor:
        assert executor.submit(invoke_and_read_context).result() is None


def test_propagate_context_preserves_function_metadata() -> None:
    def retrieve() -> None:
        pass

    wrapped = propagate_context(retrieve)

    assert wrapped.__name__ == "retrieve"
