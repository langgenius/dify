"""
Guards the OpenTelemetry Flask instrumentation contract Dify relies on.

Flask can run teardown handlers more than once for a request. Instrumentation
versions before 0.63b0 left the span activation and context token in
``request.environ`` after the first teardown, so the second one detached an
already-used token and the OTel API logged "Failed to detach context" for every
affected request.
"""

import logging
from collections.abc import Iterator

import flask
import pytest
from opentelemetry.instrumentation.flask import FlaskInstrumentor

from tests.unit_tests.extensions.otel.conftest import memory_span_exporter as memory_span_exporter  # noqa: PLC0414
from tests.unit_tests.extensions.otel.conftest import mock_account_user as mock_account_user  # noqa: PLC0414
from tests.unit_tests.extensions.otel.conftest import mock_app_model as mock_app_model  # noqa: PLC0414
from tests.unit_tests.extensions.otel.conftest import mock_end_user as mock_end_user  # noqa: PLC0414
from tests.unit_tests.extensions.otel.conftest import mock_workflow_runner as mock_workflow_runner  # noqa: PLC0414
from tests.unit_tests.extensions.otel.conftest import reset_handler_instances as reset_handler_instances  # noqa: PLC0414
from tests.unit_tests.extensions.otel.conftest import (
    tracer_provider_with_memory_exporter as tracer_provider_with_memory_exporter,  # noqa: PLC0414
)


@pytest.fixture
def instrumented_app() -> Iterator[flask.Flask]:
    app = flask.Flask(__name__)

    @app.route("/ping")
    def ping() -> str:
        return "pong"

    instrumentor = FlaskInstrumentor()
    instrumentor.instrument_app(app)
    yield app
    instrumentor.uninstrument_app(app)


@pytest.mark.usefixtures("tracer_provider_with_memory_exporter")
def test_duplicate_teardown_does_not_log_detach_failure(
    instrumented_app: flask.Flask, caplog: pytest.LogCaptureFixture
) -> None:
    handlers = instrumented_app.teardown_request_funcs[None]
    # instrument_app registers its teardown handler last.
    index = len(handlers) - 1
    instrumentation_teardown = handlers[index]
    calls = 0

    def teardown_twice(exc: BaseException | None) -> None:
        nonlocal calls
        calls += 1
        instrumentation_teardown(exc)
        instrumentation_teardown(exc)

    handlers[index] = teardown_twice
    try:
        with caplog.at_level(logging.ERROR, logger="opentelemetry.context"):
            assert instrumented_app.test_client().get("/ping").status_code == 200
    finally:
        handlers[index] = instrumentation_teardown

    assert calls == 1, "the instrumentation teardown never ran, so nothing was exercised"
    assert "Failed to detach context" not in caplog.text
