"""Real application sinks and HTTPX instrumentation; httpcore pool is synthetic."""

import io
import logging
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from typing import Never

import httpcore
import httpx
import pytest
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.utils import is_instrumentation_enabled
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from dify_app import DifyApp
from extensions import ext_logging
from extensions.otel import instrumentation
from libs import sensitive_http_telemetry as telemetry_module
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.logging_helpers import protect_existing_log_routes

CANARY = "nw4-secret-query-canary"
URL = f"https://example.invalid/private-path?token={CANARY}"


@pytest.fixture
def application_logs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> Iterator[Callable[[], tuple[io.StringIO, Path]]]:
    root = logging.getLogger()
    old_handlers, old_level = root.handlers[:], root.level
    output = io.StringIO()
    logfile = tmp_path / "application.log"
    apply_config_overrides(monkeypatch, LOG_FILE=str(logfile), LOG_LEVEL="INFO", LOG_OUTPUT_FORMAT="text", LOG_TZ="")
    owned_handlers: list[logging.Handler] = []
    engine = logging.getLogger("sqlalchemy.engine")
    monkeypatch.setattr(engine, "level", engine.level)
    monkeypatch.setattr(engine, "propagate", engine.propagate)

    def initialize() -> tuple[io.StringIO, Path]:
        # Pytest attaches its capture handlers between setup and call phases.
        # Initialize the real app during the call, preserving those test sinks.
        protect_existing_log_routes(monkeypatch, emitters=telemetry_module._HTTP_LOGGERS)
        root.handlers = []
        monkeypatch.setattr(ext_logging.sys, "stdout", output)
        ext_logging.init_app(DifyApp(__name__))
        owned_handlers.extend(root.handlers)
        return output, logfile

    try:
        yield initialize
    finally:
        for handler in set(owned_handlers).difference(old_handlers):
            handler.close()
        root.handlers = old_handlers
        root.setLevel(old_level)


def persisted(logs: tuple[io.StringIO, Path]) -> str:
    for handler in logging.getLogger().handlers:
        handler.flush()
    return logs[0].getvalue() + logs[1].read_text()


def synthetic_client() -> httpx.Client:
    """Real HTTPX/HTTPTransport path; replace only the socket-owning httpcore pool."""
    transport = httpx.HTTPTransport()
    assert isinstance(transport._pool, httpcore.ConnectionPool)

    def response(request: httpcore.Request) -> httpcore.Response:
        assert request.url.host == b"example.invalid"
        return httpcore.Response(200, content=b"ok")

    transport._pool.handle_request = response
    return httpx.Client(transport=transport, trust_env=False)


def test_current_httpx_info_really_persists_full_query(
    application_logs: Callable[[], tuple[io.StringIO, Path]],
) -> None:
    logs = application_logs()
    with synthetic_client() as client:
        assert client.get(URL).text == "ok"
    assert CANARY in persisted(logs)


@pytest.mark.parametrize("log_format", ["text", "json"])
def test_guard_blocks_real_httpx_query_and_exception_in_console_and_file(
    application_logs: Callable[[], tuple[io.StringIO, Path]], monkeypatch: pytest.MonkeyPatch, log_format: str
) -> None:
    logs = application_logs()
    module = telemetry_module
    apply_config_overrides(monkeypatch, LOG_OUTPUT_FORMAT=log_format)
    formatter = ext_logging._create_formatter()
    for handler in logging.getLogger().handlers:
        handler.setFormatter(formatter)
    with module.sensitive_http_telemetry(), synthetic_client() as client:
        assert client.get(URL).text == "ok"
        try:
            raise ValueError(CANARY)
        except ValueError:
            logging.getLogger("core.helper.ssrf_proxy").exception("transport failed %s", URL)
    with synthetic_client() as client:
        client.get("https://example.invalid/ordinary-after")
    text = persisted(logs)
    assert CANARY not in text
    assert "private-path" not in text
    assert text.count("ordinary-after") == 2  # console + file, ordinary INFO remains


@pytest.mark.parametrize("error_type", [ValueError, KeyboardInterrupt, SystemExit])
def test_nested_context_restores_after_exception_and_baseexception(
    application_logs: Callable[[], tuple[io.StringIO, Path]], error_type: type[BaseException]
) -> None:
    logs = application_logs()
    module = telemetry_module
    logger = logging.getLogger("httpx")

    def interrupted() -> None:
        with module.sensitive_http_telemetry():
            assert not is_instrumentation_enabled()
            logger.error(CANARY)
            raise error_type("synthetic interruption")

    with module.sensitive_http_telemetry():
        with pytest.raises(error_type):
            interrupted()
        assert not is_instrumentation_enabled()
        logger.error(CANARY)
    assert is_instrumentation_enabled()
    logger.info("ordinary-after-reset")
    text = persisted(logs)
    assert CANARY not in text
    assert "ordinary-after-reset" in text


def test_concurrent_ordinary_thread_keeps_httpx_logs(application_logs: Callable[[], tuple[io.StringIO, Path]]) -> None:
    logs = application_logs()
    module = telemetry_module
    barrier = Barrier(2)

    def sensitive() -> None:
        with module.sensitive_http_telemetry(), synthetic_client() as client:
            barrier.wait(timeout=5)
            client.get(URL)
            barrier.wait(timeout=5)

    def ordinary() -> None:
        barrier.wait(timeout=5)
        with synthetic_client() as client:
            client.get("https://example.invalid/concurrent-ordinary")
        barrier.wait(timeout=5)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(sensitive), executor.submit(ordinary)]
        for future in futures:
            future.result(timeout=10)
    text = persisted(logs)
    assert CANARY not in text
    assert "concurrent-ordinary" in text


@pytest.mark.parametrize("configuration", ["no-handlers", "unfiltered-root", "removed-filter"])
def test_unready_configuration_refuses_before_transport(
    application_logs: Callable[[], tuple[io.StringIO, Path]], configuration: str
) -> None:
    application_logs()
    module = telemetry_module
    root = logging.getLogger()
    if configuration == "no-handlers":
        root.handlers = []
    elif configuration == "unfiltered-root":
        root.addHandler(logging.StreamHandler(io.StringIO()))
    else:
        root.handlers[0].filters.clear()
    entered = False
    with pytest.raises(module.SensitiveHttpTelemetryUnavailable):
        module.assert_sensitive_http_telemetry_ready()
    with pytest.raises(module.SensitiveHttpTelemetryUnavailable), module.sensitive_http_telemetry():
        entered = True
    assert not entered


def test_context_rechecks_configuration_after_preclaim_readiness(
    application_logs: Callable[[], tuple[io.StringIO, Path]],
) -> None:
    application_logs()
    module = telemetry_module
    module.assert_sensitive_http_telemetry_ready()
    handler = logging.StreamHandler(io.StringIO())
    logging.getLogger().addHandler(handler)
    entered = False
    with pytest.raises(module.SensitiveHttpTelemetryUnavailable), module.sensitive_http_telemetry():
        entered = True
    assert not entered


@pytest.mark.parametrize("name", ["httpx", "httpx.child", "httpcore", "httpcore.connection", "core.helper.ssrf_proxy"])
@pytest.mark.parametrize("configuration", ["direct-handler", "no-propagation"])
def test_known_lower_http_logger_bypass_refuses(
    application_logs: Callable[[], tuple[io.StringIO, Path]],
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    configuration: str,
) -> None:
    application_logs()
    module = telemetry_module
    logger = logging.getLogger(name)
    if configuration == "direct-handler":
        monkeypatch.setattr(logger, "handlers", [logging.StreamHandler(io.StringIO())])
    else:
        monkeypatch.setattr(logger, "propagate", False)
    with pytest.raises(module.SensitiveHttpTelemetryUnavailable):
        module.assert_sensitive_http_telemetry_ready()


def test_guard_never_changes_logger_configuration(application_logs: Callable[[], tuple[io.StringIO, Path]]) -> None:
    application_logs()
    module = telemetry_module
    before = [(handler, handler.level, tuple(handler.filters)) for handler in logging.getLogger().handlers]
    level = logging.getLogger().level
    with module.sensitive_http_telemetry():
        with module.sensitive_http_telemetry():
            pass
    assert before == [(handler, handler.level, tuple(handler.filters)) for handler in logging.getLogger().handlers]
    assert level == logging.getLogger().level


@pytest.mark.parametrize("name", ["graphon.graph_engine.worker", "graphon.graph_engine.worker.child", "graphon"])
@pytest.mark.parametrize("configuration", ["direct-handler", "no-propagation"])
def test_additional_native_logger_bypass_refuses_without_changing_http_default(
    application_logs: Callable[[], tuple[io.StringIO, Path]],
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    configuration: str,
) -> None:
    application_logs()
    module = telemetry_module
    logger = logging.getLogger(name)
    if configuration == "direct-handler":
        monkeypatch.setattr(logger, "handlers", [logging.StreamHandler(io.StringIO())])
    else:
        monkeypatch.setattr(logger, "propagate", False)
    # Ordinary HTTP admission retains its existing routes and behavior.
    module.assert_sensitive_http_telemetry_ready()
    routes = ("graphon.graph_engine.worker",)
    with pytest.raises(module.SensitiveHttpTelemetryUnavailable):
        module.assert_sensitive_http_telemetry_ready(additional_emitters=routes)
    entered = False
    with (
        pytest.raises(module.SensitiveHttpTelemetryUnavailable),
        module.sensitive_http_telemetry(additional_emitters=routes),
    ):
        entered = True
    assert not entered


def test_additional_protected_routes_drop_scoped_exception_and_restore_ordinary_logs(
    application_logs: Callable[[], tuple[io.StringIO, Path]], monkeypatch: pytest.MonkeyPatch
) -> None:
    logs = application_logs()
    module = telemetry_module
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    handler.addFilter(module.SensitiveHttpLogFilter())
    logger = logging.getLogger("services.workflow_runtime.workflow_generator")
    monkeypatch.setattr(logger, "handlers", [handler])
    routes = (logger.name, "graphon.graph_engine.worker")

    def emit_and_fail() -> None:
        with module.sensitive_http_telemetry(additional_emitters=routes):
            try:
                raise ValueError(CANARY)
            except ValueError:
                logger.exception("native worker failed %s", CANARY)
            raise ValueError("synthetic interruption")

    try:
        with pytest.raises(ValueError, match="synthetic interruption"):
            emit_and_fail()
        logger.info("ordinary-native-route-after")
        text = persisted(logs) + output.getvalue()
        assert CANARY not in text
        assert "ordinary-native-route-after" in text
        assert is_instrumentation_enabled()
    finally:
        handler.close()


def test_additional_route_is_rechecked_at_context_entry(
    application_logs: Callable[[], tuple[io.StringIO, Path]], monkeypatch: pytest.MonkeyPatch
) -> None:
    application_logs()
    module = telemetry_module
    logger = logging.getLogger("graphon.graph_engine.worker")
    routes = (logger.name,)
    module.assert_sensitive_http_telemetry_ready(additional_emitters=routes)
    monkeypatch.setattr(logger, "handlers", [logging.StreamHandler(io.StringIO())])
    entered = False
    with (
        pytest.raises(module.SensitiveHttpTelemetryUnavailable),
        module.sensitive_http_telemetry(additional_emitters=routes),
    ):
        entered = True
    assert not entered


def test_actual_enabled_httpx_global_instrumentation_preserves_only_ordinary_spans(
    application_logs: Callable[[], tuple[io.StringIO, Path]],
) -> None:
    logs = application_logs()
    module = telemetry_module
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    instrumentor = HTTPXClientInstrumentor()
    instrumentor.instrument(tracer_provider=provider)
    try:
        with synthetic_client() as client:
            client.get("https://example.invalid/ordinary-before")
            with module.sensitive_http_telemetry():
                client.get(URL)
            client.get("https://example.invalid/ordinary-after")
        spans = exporter.get_finished_spans()
        assert len(spans) == 2
        serialized = repr([(span.attributes, span.events) for span in spans])
        assert "ordinary-before" in serialized
        assert "ordinary-after" in serialized
        assert CANARY not in serialized
        assert "private-path" not in serialized
        assert CANARY not in persisted(logs)
    finally:
        instrumentor.uninstrument()
        provider.shutdown()


def test_existing_exception_logging_handler_filters_sensitive_parent_span_events(
    application_logs: Callable[[], tuple[io.StringIO, Path]],
) -> None:
    application_logs()
    module = telemetry_module
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer(__name__)
    instrumentation.instrument_exception_logging()
    try:
        module.assert_sensitive_http_telemetry_ready()
        with tracer.start_as_current_span("existing-parent"):
            with module.sensitive_http_telemetry():
                try:
                    raise ValueError(CANARY)
                except ValueError:
                    logging.getLogger("httpcore").exception("failure %s", URL)
            try:
                raise ValueError("ordinary-exception")
            except ValueError:
                logging.getLogger("httpcore").exception("ordinary-error")
        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        events = repr([(event.name, event.attributes) for event in spans[0].events])
        assert CANARY not in events
        assert "ordinary-exception" in events
        assert "ordinary-error" in events
    finally:
        provider.shutdown()


def test_concurrent_ordinary_thread_keeps_real_auto_instrumented_span(
    application_logs: Callable[[], tuple[io.StringIO, Path]],
) -> None:
    logs = application_logs()
    module = telemetry_module
    barrier = Barrier(2)
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    instrumentor = HTTPXClientInstrumentor()
    instrumentor.instrument(tracer_provider=provider)

    def sensitive() -> None:
        with module.sensitive_http_telemetry(), synthetic_client() as client:
            barrier.wait(timeout=5)
            client.get(URL)
            barrier.wait(timeout=5)

    def ordinary() -> None:
        barrier.wait(timeout=5)
        with synthetic_client() as client:
            client.get("https://example.invalid/concurrent-trace")
        barrier.wait(timeout=5)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(sensitive), executor.submit(ordinary)]
            for future in futures:
                future.result(timeout=10)
        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert "concurrent-trace" in repr(spans[0].attributes)
        assert CANARY not in repr(spans[0].attributes)
        text = persisted(logs)
        assert "concurrent-trace" in text
        assert CANARY not in text
    finally:
        instrumentor.uninstrument()
        provider.shutdown()


def test_actual_thread_lease_rejects_live_release_and_preserves_other_threads(
    application_logs: Callable[[], tuple[io.StringIO, Path]],
) -> None:
    from threading import Event, Thread

    logs = application_logs()
    module = telemetry_module
    entered, release = Event(), Event()
    leases = []

    def sensitive() -> None:
        lease = module.protect_current_thread_logs(additional_emitters=("graphon",))
        leases.append(lease)
        with pytest.raises(module.SensitiveHttpTelemetryUnavailable):
            lease.release_after_exit()
        entered.set()
        assert release.wait(3)
        logging.getLogger("graphon.graph_engine.error_handler").error(CANARY)

    thread = Thread(target=sensitive)
    thread.start()
    try:
        assert entered.wait(2)
        assert leases[0].thread is thread
        with pytest.raises(module.SensitiveHttpTelemetryUnavailable):
            leases[0].release_after_exit()
        logging.getLogger("graphon").error("ordinary-other-thread")
    finally:
        release.set()
        thread.join(2)
    assert not thread.is_alive()
    leases[0].release_after_exit()
    leases[0].release_after_exit()
    logging.getLogger("graphon").error("ordinary-after-lease")
    text = persisted(logs)
    assert CANARY not in text
    assert "ordinary-other-thread" in text
    assert "ordinary-after-lease" in text


def test_multiple_owned_thread_leases_do_not_remove_each_other_or_protect_new_identity(
    application_logs: Callable[[], tuple[io.StringIO, Path]],
) -> None:
    from threading import Thread

    logs = application_logs()
    module = telemetry_module
    leases = []

    def sensitive() -> None:
        leases.extend((module.protect_current_thread_logs(), module.protect_current_thread_logs()))
        logging.getLogger("httpx").error(CANARY)

    thread = Thread(target=sensitive, name="same-name")
    thread.start()
    thread.join(2)
    assert len(leases) == 2
    leases[0].release_after_exit()
    assert leases[1].thread is thread
    # The old OS ident may be reused; association is the exact Thread object.
    ordinary = Thread(target=lambda: logging.getLogger("httpx").error("ordinary-new-identity"), name="same-name")
    ordinary.start()
    ordinary.join(2)
    leases[1].release_after_exit()
    assert CANARY not in persisted(logs)
    assert "ordinary-new-identity" in persisted(logs)


@pytest.mark.parametrize("configuration", ["unfiltered-root", "custom-route"])
def test_thread_lease_refuses_unready_sinks_before_registration(
    application_logs: Callable[[], tuple[io.StringIO, Path]], monkeypatch: pytest.MonkeyPatch, configuration: str
) -> None:
    application_logs()
    module = telemetry_module
    if configuration == "unfiltered-root":
        logging.getLogger().addHandler(logging.StreamHandler(io.StringIO()))
    else:
        monkeypatch.setattr(logging.getLogger("graphon.dispatcher"), "propagate", False)
    with pytest.raises(module.SensitiveHttpTelemetryUnavailable):
        module.protect_current_thread_logs(additional_emitters=("graphon",))


def test_thread_lease_drops_before_render_and_retains_unknown_background(
    application_logs: Callable[[], tuple[io.StringIO, Path]],
) -> None:
    from threading import Event, Thread

    logs = application_logs()
    module = telemetry_module
    entered, finish = Event(), Event()
    leases = []

    rendered = []

    class Unrenderable:
        def __str__(self) -> Never:
            rendered.append(True)
            raise AssertionError("protected record rendered")

    def unknown_background() -> None:
        leases.append(module.protect_current_thread_logs())
        entered.set()
        assert finish.wait(3)
        logging.getLogger("httpx").error("raw %s", Unrenderable())

    thread = Thread(target=unknown_background)
    thread.start()
    try:
        assert entered.wait(2)
        with pytest.raises(module.SensitiveHttpTelemetryUnavailable):
            leases[0].release_after_exit()
    finally:
        finish.set()
        thread.join(2)
    leases[0].release_after_exit()
    assert rendered == []
    assert "raw" not in persisted(logs)
