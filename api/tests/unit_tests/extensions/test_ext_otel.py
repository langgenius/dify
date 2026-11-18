"""
Guards the OpenTelemetry Flask instrumentation contract Dify relies on.

Flask can run teardown handlers more than once for a request. Instrumentation
versions before 0.63b0 left the span activation and context token in
``request.environ`` after the first teardown, so the second one detached an
already-used token and the OTel API logged "Failed to detach context" for every
affected request.
"""

import logging
import os
import subprocess
import sys
import textwrap
from collections.abc import Iterator
from pathlib import Path

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


@pytest.mark.parametrize("patch_gevent", [False, True])
def test_gc_metrics_use_the_configured_exporter(patch_gevent: bool) -> None:
    """Enabled OTel startup must export GC observations through its existing reader.

    Isolate the process-wide providers and instrumentors; no collector or database
    service is needed for the console exporter and an unconnected SQLite engine.
    """
    script = textwrap.dedent("""
        import gc
        from opentelemetry.metrics import get_meter_provider
        from configs import dify_config
        from dify_app import DifyApp
        from extensions import ext_otel
        from models.engine import db

        dify_config.OTEL_EXPORTER_TYPE = "console"
        dify_config.OTEL_METRIC_EXPORT_INTERVAL = 3_600_000
        dify_config.OTEL_SAMPLING_RATE = 0
        app = DifyApp(__name__)
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite://"
        db.init_app(app)
        ext_otel.init_app(app)
        gc.collect(2)
        get_meter_provider().force_flush()
    """)
    if patch_gevent:
        script = "from gevent import monkey; monkey.patch_all()\n" + script
    api_root = Path(__file__).resolve().parents[3]
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=api_root,
        env={**os.environ, "ENABLE_OTEL": "true", "PYTHONPATH": str(api_root)},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert '"name": "cpython.gc.collections"' in result.stdout
    assert '"name": "dify.gc.duration"' in result.stdout
