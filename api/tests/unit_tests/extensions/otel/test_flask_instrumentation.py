"""
Guards the OpenTelemetry Flask instrumentation contract Dify relies on.

Flask can run teardown handlers more than once for a request. Instrumentation
versions before 0.63b0 left the span activation and context token in
``request.environ`` after the first teardown, so the second one detached an
already-used token and the OTel API logged "Failed to detach context" for every
affected request.
"""

import logging

import flask
import pytest
from opentelemetry.instrumentation.flask import (
    _ENVIRON_ACTIVATION_KEY,
    _ENVIRON_TOKEN,
    FlaskInstrumentor,
)


@pytest.fixture
def instrumented_app():
    app = flask.Flask(__name__)

    @app.route("/ping")
    def ping():
        return "pong"

    instrumentor = FlaskInstrumentor()
    instrumentor.instrument_app(app)
    yield app
    instrumentor.uninstrument_app(app)


@pytest.mark.usefixtures("tracer_provider_with_memory_exporter")
def test_teardown_clears_request_environ(instrumented_app):
    leftovers = {}

    def capture(_exc):
        leftovers["activation"] = _ENVIRON_ACTIVATION_KEY in flask.request.environ
        leftovers["token"] = _ENVIRON_TOKEN in flask.request.environ

    # Flask runs teardown handlers LIFO, so the first entry runs last.
    instrumented_app.teardown_request_funcs[None].insert(0, capture)

    assert instrumented_app.test_client().get("/ping").status_code == 200
    assert leftovers == {"activation": False, "token": False}


@pytest.mark.usefixtures("tracer_provider_with_memory_exporter")
def test_duplicate_teardown_does_not_log_detach_failure(instrumented_app, caplog):
    handlers = instrumented_app.teardown_request_funcs[None]
    instrumentation_teardown = instrumented_app._teardown_request
    index = handlers.index(instrumentation_teardown)

    def teardown_twice(exc):
        instrumentation_teardown(exc)
        instrumentation_teardown(exc)

    handlers[index] = teardown_twice
    try:
        with caplog.at_level(logging.ERROR, logger="opentelemetry.context"):
            assert instrumented_app.test_client().get("/ping").status_code == 200
    finally:
        handlers[index] = instrumentation_teardown

    assert "Failed to detach context" not in caplog.text
