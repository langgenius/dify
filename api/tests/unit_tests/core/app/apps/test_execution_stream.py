from threading import Event

import pytest
from flask import Flask

from core.app.apps.execution_stream import EXECUTION_OUTPUT_BUFFER_SIZE, execution_owned_stream


def test_slow_subscriber_is_bounded_and_detach_drains_without_aborting():
    produced = [0]
    full = Event()
    finished = Event()
    failures = []

    def source():
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


def test_delivery_preserves_order_and_reports_real_execution_errors():
    completed = Event()
    errors = []

    def source():
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
