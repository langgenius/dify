from collections.abc import Generator
from contextvars import ContextVar
from threading import Event, Thread
from types import GeneratorType
from typing import override

import pytest
from flask import Flask, current_app
from werkzeug.local import LocalProxy

from core.app.apps import execution_stream as module
from core.app.apps.execution_stream import EXECUTION_OUTPUT_BUFFER_SIZE, execution_owned_stream


def test_slow_subscriber_is_bounded_and_detach_drains_without_aborting() -> None:
    produced = [0]
    full = Event()
    finished = Event()
    failures: list[Exception] = []

    def source() -> Generator[int]:
        for value in range(1000):
            produced[0] += 1
            if produced[0] == EXECUTION_OUTPUT_BUFFER_SIZE + 1:
                full.set()
            yield value

    with Flask("bounded-stream").app_context():
        output = execution_owned_stream(source(), on_finished=finished.set, on_failed=failures.append)
        assert full.wait(2)
        assert produced[0] == EXECUTION_OUTPUT_BUFFER_SIZE + 1
        output.close()  # Includes closing before the first HTTP read.
    assert finished.wait(2)
    assert produced[0] == 1000
    assert not failures


def test_delivery_preserves_order_and_reports_real_execution_errors() -> None:
    completed = Event()
    errors: list[Exception] = []

    def source() -> Generator[str]:
        yield "first"
        yield "second"
        raise ValueError("fixture-failure")

    with Flask("execution-error").app_context():
        output = execution_owned_stream(source(), on_finished=completed.set, on_failed=errors.append)
        assert next(output) == "first"
        assert next(output) == "second"
        try:
            with pytest.raises(ValueError, match="fixture-failure"):
                next(output)
        finally:
            output.close()
    assert completed.wait(2)
    assert len(errors) == 1


def test_generator_abc_send_exhaustion_preserves_context_and_restores_caller() -> None:
    caller_proxy: object = current_app
    assert isinstance(caller_proxy, LocalProxy)
    caller = caller_proxy._get_current_object()
    assert isinstance(caller, Flask)
    value = ContextVar("classic-stream-unit-context", default="unset")
    token = value.set("owned")
    completed = Event()
    contexts: list[tuple[str, str]] = []
    failures: list[Exception] = []

    def source() -> Generator[str]:
        contexts.append((current_app.name, value.get()))
        yield "first"
        yield "second"

    try:
        with Flask("typed-classic-owner").app_context():
            output = execution_owned_stream(source(), on_finished=completed.set, on_failed=failures.append)
            assert isinstance(output, Generator)
            assert not isinstance(output, GeneratorType)  # Deliberate Generator ABC, not native identity.
            assert output.send(None) == "first"
            assert list(output) == ["second"]
            output.close()
        assert completed.wait(2)
        assert contexts == [("typed-classic-owner", "owned")]
        assert failures == []
        restored_proxy: object = current_app
        assert isinstance(restored_proxy, LocalProxy)
        assert restored_proxy._get_current_object() is caller
    finally:
        value.reset(token)


@pytest.mark.parametrize("read_first", [False, True], ids=["zero-reads", "one-chunk"])
def test_repeated_close_detaches_the_armed_owner_but_does_not_cancel_production(read_first: bool) -> None:
    waiting = Event()
    resume = Event()
    completed = Event()
    produced: list[str] = []
    finished: list[str] = []
    failures: list[Exception] = []

    def source() -> Generator[str]:
        produced.append("first")
        yield "first"
        waiting.set()
        assert resume.wait(2)
        produced.append("second")
        yield "second"

    def finish() -> None:
        finished.append("finished")
        completed.set()

    with Flask("detach-armed").app_context():
        output = execution_owned_stream(source(), on_finished=finish, on_failed=failures.append)
        try:
            assert waiting.wait(2)
            if read_first:
                assert next(output) == "first"
            output.close()
            output.close()
            assert finished == []
            with pytest.raises(StopIteration):
                output.send(None)
        finally:
            resume.set()
            output.close()
    assert completed.wait(2)
    assert produced == ["first", "second"]
    assert finished == ["finished"]
    assert failures == []


@pytest.mark.parametrize("legacy_signature", [False, True], ids=["exception-instance", "type-and-value"])
def test_throw_before_first_read_forwards_native_behavior_without_failing_the_producer(legacy_signature: bool) -> None:
    completed = Event()
    failures: list[Exception] = []

    def source() -> Generator[str]:
        yield "producer-result"

    with Flask("throw-before-read").app_context():
        output = execution_owned_stream(source(), on_finished=completed.set, on_failed=failures.append)
        if legacy_signature:
            with pytest.deprecated_call(), pytest.raises(ValueError, match="consumer-only"):
                output.throw(ValueError, "consumer-only")
        else:
            with pytest.raises(ValueError, match="consumer-only"):
                output.throw(ValueError("consumer-only"))
        output.close()
    assert completed.wait(2)
    assert failures == []


def test_thread_start_failure_closes_original_armed_source_once_and_finishes_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_closed: list[str] = []
    finished: list[str] = []
    failures: list[Exception] = []

    def source() -> Generator[str]:
        try:
            yield "armed-source"
            yield "never-executed"
        finally:
            source_closed.append("closed")

    class RejectedThread(Thread):
        @override
        def start(self) -> None:
            raise RuntimeError("thread-start-rejected")

    original_source = source()
    assert next(original_source) == "armed-source"
    monkeypatch.setattr(module, "Thread", RejectedThread)
    with Flask("thread-start-failure").app_context(), pytest.raises(RuntimeError, match="thread-start-rejected"):
        execution_owned_stream(
            original_source, on_finished=lambda: finished.append("finished"), on_failed=failures.append
        )
    assert source_closed == ["closed"]
    assert finished == ["finished"]
    assert failures == []
