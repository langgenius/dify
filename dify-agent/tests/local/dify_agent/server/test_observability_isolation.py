"""Real two-endpoint OTLP isolation between platform and Agent observability."""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import logfire
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from pydantic import BaseModel
from pydantic_ai import Agent, Tool
from pydantic_ai.models.test import TestModel

import dify_agent.server.observability as observability
from dify_agent.runtime.agent_factory import create_agent
from dify_agent.runtime.observability import IsolatedTracerProvider
from dify_agent.server.observability import configure_agent_observability
from dify_agent.server.settings import ServerSettings


class _OTLPReceiver:
    """Collect decoded OTLP trace exports and request headers on a local port."""

    def __init__(self) -> None:
        received: list[tuple[dict[str, str], ExportTraceServiceRequest]] = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                request = ExportTraceServiceRequest()
                request.ParseFromString(self.rfile.read(length))
                received.append(({key.casefold(): value for key, value in self.headers.items()}, request))
                body = ExportTraceServiceResponse().SerializeToString()
                self.send_response(200)
                self.send_header("Content-Type", "application/x-protobuf")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args: object) -> None:
                return None

        self.received = received
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def endpoint(self) -> str:
        host, port = self.server.server_address[:2]
        return f"http://{host}:{port}/v1/traces"

    def service_names(self) -> list[str]:
        names: list[str] = []
        for _headers, request in self.received:
            for resource_spans in request.resource_spans:
                for attribute in resource_spans.resource.attributes:
                    if attribute.key == "service.name":
                        names.append(attribute.value.string_value)
        return names

    def span_names(self) -> list[str]:
        names: list[str] = []
        for _headers, request in self.received:
            for resource_spans in request.resource_spans:
                for scope_spans in resource_spans.scope_spans:
                    names.extend(span.name for span in scope_spans.spans)
        return names

    def scope_names(self) -> list[str]:
        names: list[str] = []
        for _headers, request in self.received:
            for resource_spans in request.resource_spans:
                for scope_spans in resource_spans.scope_spans:
                    names.append(scope_spans.scope.name)
        return names

    def spans(self) -> list[tuple[str, str, str, str]]:
        decoded: list[tuple[str, str, str, str]] = []
        for _headers, request in self.received:
            for resource_spans in request.resource_spans:
                for scope_spans in resource_spans.scope_spans:
                    for span in scope_spans.spans:
                        decoded.append((span.trace_id.hex(), span.span_id.hex(), span.parent_span_id.hex(), span.name))
        return decoded

    def authorizations(self) -> list[str | None]:
        return [headers.get("authorization") for headers, _request in self.received]

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


@pytest.fixture(autouse=True)
def isolate_environment(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(os, "environ", dict(os.environ))
    for key in tuple(os.environ):
        if key.startswith(("OTEL_", "LOGFIRE_")):
            monkeypatch.delenv(key)


@pytest.fixture
def restore_agent_instrumentation(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(Agent, "_instrument_default", False)


def _static_tool() -> str:
    return "tool-sentinel-output"


def _platform_client(endpoint: str, headers: dict[str, str]) -> logfire.Logfire:
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    return logfire.configure(
        local=True,
        send_to_logfire=False,
        console=False,
        metrics=False,
        inspect_arguments=False,
        additional_span_processors=[
            BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint, headers=headers, timeout=5))
        ],
    )


def test_agent_pipeline_is_isolated_from_platform_endpoint_and_credentials(
    restore_agent_instrumentation,
) -> None:
    platform_receiver = _OTLPReceiver()
    agent_receiver = _OTLPReceiver()
    platform: logfire.Logfire | None = None
    agent_observability = None
    try:
        platform_port = platform_receiver.server.server_address[1]
        os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = f"http://127.0.0.1:{platform_port}"
        os.environ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] = platform_receiver.endpoint
        os.environ["OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"] = f"http://127.0.0.1:{platform_port}/v1/metrics"
        os.environ["OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"] = f"http://127.0.0.1:{platform_port}/v1/logs"
        os.environ["OTEL_EXPORTER_OTLP_HEADERS"] = "Authorization=platform-test-only"
        os.environ["OTEL_RESOURCE_ATTRIBUTES"] = "service.name=platform-test"
        os.environ["LOGFIRE_TOKEN"] = "platform-test-only"
        os.environ["LOGFIRE_HTTPX_CAPTURE_ALL"] = "true"
        environment_snapshot = dict(os.environ)

        platform = _platform_client(platform_receiver.endpoint, {"Authorization": "platform-test-only"})
        settings = ServerSettings(
            trajectory_enabled=True,
            trajectory_otlp_traces_endpoint=agent_receiver.endpoint,
            trajectory_otlp_headers={"Authorization": "agent-test-only"},
            trajectory_service_name="dify-agent-trajectory",
        )
        agent_observability = configure_agent_observability(settings)
        assert agent_observability is not None

        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(_static_tool)])
        assert agent.instrument is False
        agent_observability.instrument(agent)

        with platform.span("platform-marker"):
            pass
        result = agent.run_sync("business-marker-input")
        assert result.output == "done"

        assert platform.force_flush(timeout_millis=10000)
        assert agent_observability.client.force_flush(timeout_millis=10000)

        platform_names = platform_receiver.span_names()
        agent_names = agent_receiver.span_names()
        assert "platform-marker" in platform_names
        assert "platform-marker" not in agent_names
        assert agent_names, "expected agent run spans on the business receiver"
        assert not any("pydantic" in scope for scope in platform_receiver.scope_names())
        assert set(platform_receiver.service_names()) == {"platform-test"}
        assert set(agent_receiver.service_names()) == {"dify-agent-trajectory"}
        assert platform_receiver.authorizations() == ["platform-test-only"] * len(platform_receiver.authorizations())
        assert agent_receiver.authorizations() == ["agent-test-only"] * len(agent_receiver.authorizations())
        assert dict(os.environ) == environment_snapshot
    finally:
        if agent_observability is not None:
            agent_observability.client.shutdown(timeout_millis=5000)
        if platform is not None:
            platform.shutdown(timeout_millis=5000)
        platform_receiver.close()
        agent_receiver.close()


def test_agent_pipeline_empty_headers_send_no_platform_credentials(
    restore_agent_instrumentation,
) -> None:
    agent_receiver = _OTLPReceiver()
    agent_observability = None
    try:
        os.environ["OTEL_EXPORTER_OTLP_HEADERS"] = "Authorization=platform-test-only"
        settings = ServerSettings(
            trajectory_enabled=True,
            trajectory_otlp_traces_endpoint=agent_receiver.endpoint,
            trajectory_service_name="dify-agent-trajectory",
        )
        agent_observability = configure_agent_observability(settings)
        assert agent_observability is not None

        agent = create_agent(TestModel(custom_output_text="done"), tools=[])
        agent_observability.instrument(agent)
        _ = agent.run_sync("business-marker-input")
        assert agent_observability.client.force_flush(timeout_millis=10000)

        assert agent_receiver.received, "expected spans on the business receiver"
        assert all(authorization is None for authorization in agent_receiver.authorizations())
        assert os.environ["OTEL_EXPORTER_OTLP_HEADERS"] == "Authorization=platform-test-only"
    finally:
        if agent_observability is not None:
            agent_observability.client.shutdown(timeout_millis=5000)
        agent_receiver.close()


def test_agent_observability_disabled_creates_no_instance_or_export(
    restore_agent_instrumentation,
) -> None:
    agent_receiver = _OTLPReceiver()
    try:
        settings = ServerSettings(
            trajectory_enabled=False,
            trajectory_otlp_traces_endpoint=agent_receiver.endpoint,
        )

        assert configure_agent_observability(settings) is None
        agent = create_agent(TestModel(custom_output_text="done"), tools=[])
        assert agent.instrument is False
        _ = agent.run_sync("business-marker-input")

        assert agent_receiver.received == []
    finally:
        agent_receiver.close()


def test_agent_pipeline_isolation_with_real_env_export_in_subprocess(tmp_path) -> None:
    platform_receiver = _OTLPReceiver()
    agent_receiver = _OTLPReceiver()
    try:
        child_env = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("OTEL_", "LOGFIRE_", "DIFY_AGENT_TRAJECTORY_"))
        }
        child_env.pop("PYTEST_CURRENT_TEST", None)
        platform_port = platform_receiver.server.server_address[1]
        child_env.update(
            {
                "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{platform_port}",
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": platform_receiver.endpoint,
                "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT": f"http://127.0.0.1:{platform_port}/v1/metrics",
                "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT": f"http://127.0.0.1:{platform_port}/v1/logs",
                "OTEL_TRACES_EXPORTER": "otlp",
                "OTEL_METRICS_EXPORTER": "none",
                "OTEL_LOGS_EXPORTER": "none",
                "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=platform-test-only",
                "OTEL_RESOURCE_ATTRIBUTES": "service.name=platform-test",
                "LOGFIRE_TOKEN": "platform-test-only",
                "TEST_AGENT_ENDPOINT": agent_receiver.endpoint,
            }
        )
        script = textwrap.dedent(
            """
            import os
            import httpx
            import logfire
            from pydantic_ai import Tool
            from pydantic_ai.models.test import TestModel
            from dify_agent.runtime.agent_factory import create_agent
            from dify_agent.runtime.observability import IsolatedTracerProvider
            from dify_agent.server.observability import configure_agent_observability
            from dify_agent.server.settings import ServerSettings
            platform = logfire.configure(local=True, send_to_logfire=False, console=False, metrics=False, inspect_arguments=False)
            business = None
            http = httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={'ok': True})))
            try:
                before = dict(os.environ)
                business = configure_agent_observability(ServerSettings(_env_file=None, trajectory_enabled=True,
                    trajectory_otlp_traces_endpoint=os.environ['TEST_AGENT_ENDPOINT'],
                    trajectory_otlp_headers={'Authorization':'agent-test-only'}, trajectory_service_name='dify-agent-trajectory'))
                assert business is not None
                assert dict(os.environ) == before
                platform.instrument_httpx(http, capture_all=False,
                    tracer_provider=IsolatedTracerProvider(platform, preserve_external_parent=True))
                def smoke_tool():
                    return http.get('http://test-only.local/ping').text
                agent = create_agent(TestModel(custom_output_text='done'), tools=[Tool(smoke_tool)])
                business.instrument(agent)
                with platform.span('platform-subprocess-marker'):
                    assert agent.run_sync('test-only-input').output == 'done'
                http.close()
                assert platform.force_flush(timeout_millis=10000)
                assert business.client.force_flush(timeout_millis=10000)
            finally:
                http.close()
                if business is not None:
                    business.client.shutdown(timeout_millis=5000)
                platform.shutdown(timeout_millis=5000)
            """
        )
        result = subprocess.run(
            [sys.executable, "-c", script],
            env=child_env,
            cwd=tmp_path,
            capture_output=True,
            text=True,
            timeout=45,
        )
        assert result.returncode == 0, f"stdout: {result.stdout}\nstderr: {result.stderr}"

        platform_names = platform_receiver.span_names()
        agent_names = agent_receiver.span_names()
        assert "platform-subprocess-marker" in platform_names
        assert "platform-subprocess-marker" not in agent_names
        assert not any("pydantic" in scope for scope in platform_receiver.scope_names())
        assert "invoke_agent agent" in agent_names
        assert any("smoke_tool" in name for name in agent_names)
        assert set(platform_receiver.service_names()) == {"platform-test"}
        assert set(agent_receiver.service_names()) == {"dify-agent-trajectory"}
        assert platform_receiver.authorizations() == ["platform-test-only"] * len(platform_receiver.authorizations())
        assert agent_receiver.authorizations() == ["agent-test-only"] * len(agent_receiver.authorizations())

        platform_spans = platform_receiver.spans()
        agent_spans = agent_receiver.spans()
        marker = next(span for span in platform_spans if span[3] == "platform-subprocess-marker")
        invoke = next(span for span in agent_spans if span[3] == "invoke_agent agent")
        assert invoke[2] == ""
        assert invoke[0] != marker[0]
        assert any(span[3].startswith("GET") for span in platform_spans)
        for spans in (platform_spans, agent_spans):
            local_span_ids = {span[1] for span in spans}
            for span in spans:
                assert span[2] == "" or span[2] in local_span_ids, span
    finally:
        platform_receiver.close()
        agent_receiver.close()


def test_agent_pipeline_shared_context_with_real_env_export_in_subprocess(tmp_path) -> None:
    receiver = _OTLPReceiver()
    try:
        child_env = {
            key: value for key, value in os.environ.items() if not key.startswith(("OTEL_", "LOGFIRE_", "DIFY_AGENT_"))
        }
        child_env.pop("PYTEST_CURRENT_TEST", None)
        child_env.update(
            {
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": receiver.endpoint,
                "OTEL_TRACES_EXPORTER": "otlp",
                "OTEL_METRICS_EXPORTER": "none",
                "OTEL_LOGS_EXPORTER": "none",
                "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=platform-test-only",
                "OTEL_RESOURCE_ATTRIBUTES": "service.name=platform-test",
                "LOGFIRE_TOKEN": "platform-test-only",
                "TEST_AGENT_ENDPOINT": receiver.endpoint,
            }
        )
        script = textwrap.dedent(
            """
            import os
            import httpx
            import logfire
            from pydantic_ai import Tool
            from pydantic_ai.models.test import TestModel
            from dify_agent.runtime.agent_factory import create_agent
            from dify_agent.server.observability import configure_agent_observability
            from dify_agent.server.settings import ServerSettings
            platform = logfire.configure(local=True, send_to_logfire=False, console=False, metrics=False, inspect_arguments=False)
            business = None
            http = httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={'ok': True})))
            try:
                business = configure_agent_observability(ServerSettings(_env_file=None, trajectory_enabled=True,
                    trajectory_otlp_traces_endpoint=os.environ['TEST_AGENT_ENDPOINT'],
                    trajectory_otlp_headers={'Authorization':'agent-test-only'},
                    trajectory_service_name='dify-agent-trajectory', trajectory_trace_context_mode='shared'))
                assert business is not None
                platform.instrument_httpx(http, capture_all=False, tracer_provider=platform.config.get_tracer_provider())
                def smoke_tool():
                    return http.get('http://test-only.local/ping').text
                agent = create_agent(TestModel(custom_output_text='done'), tools=[Tool(smoke_tool)])
                business.instrument(agent)
                with platform.span('shared-platform-marker'):
                    assert agent.run_sync('test-only-input').output == 'done'
                http.close()
                assert platform.force_flush(timeout_millis=10000)
                assert business.client.force_flush(timeout_millis=10000)
            finally:
                http.close()
                if business is not None:
                    business.client.shutdown(timeout_millis=5000)
                platform.shutdown(timeout_millis=5000)
            """
        )
        result = subprocess.run(
            [sys.executable, "-c", script],
            env=child_env,
            cwd=tmp_path,
            capture_output=True,
            text=True,
            timeout=45,
        )
        assert result.returncode == 0, f"stdout: {result.stdout}\nstderr: {result.stderr}"

        spans = receiver.spans()
        names = {span[3] for span in spans}
        assert {"shared-platform-marker", "invoke_agent agent"} <= names
        assert any(name.startswith("GET") for name in names)
        assert any("smoke_tool" in name or "execute_tool" in name for name in names)
        assert len({span[0] for span in spans}) == 1
        marker = next(span for span in spans if span[3] == "shared-platform-marker")
        invoke = next(span for span in spans if span[3] == "invoke_agent agent")
        assert invoke[2] == marker[1]
        local_span_ids = {span[1] for span in spans}
        for span in spans:
            assert span[2] == "" or span[2] in local_span_ids, span
        assert {"platform-test", "dify-agent-trajectory"} <= set(receiver.service_names())
        assert set(receiver.authorizations()) <= {"platform-test-only", "agent-test-only"}
    finally:
        receiver.close()


class _SmokePayload(BaseModel):
    text: str
    count: int


def test_platform_fastapi_instrumentation_omits_parsed_argument_payloads() -> None:
    exporter = InMemorySpanExporter()
    client = logfire.configure(
        local=True,
        send_to_logfire=False,
        console=False,
        metrics=False,
        inspect_arguments=False,
        additional_span_processors=[SimpleSpanProcessor(exporter)],
    )
    app = FastAPI()

    @app.post("/echo")
    def echo(payload: _SmokePayload) -> dict[str, str]:
        return {"text": payload.text}

    try:
        with client.instrument_fastapi(
            app,
            request_attributes_mapper=observability._platform_request_attributes,
            capture_headers=False,
            tracer_provider=IsolatedTracerProvider(client, preserve_external_parent=True),
        ):
            with TestClient(app) as http:
                assert http.post("/echo", json={"text": "valid-sentinel-payload", "count": 1}).status_code == 200
                assert http.post("/echo", json={"text": "invalid-sentinel-payload", "count": "x"}).status_code == 422
        assert client.force_flush(timeout_millis=10000)

        spans = exporter.get_finished_spans()
        assert spans
        serialized = repr([dict(span.attributes or {}) for span in spans])
        serialized_events = repr([dict(event.attributes or {}) for span in spans for event in span.events])
        assert any("/echo" in name for name in [span.name for span in spans])
        assert "http.status_code" in serialized
        for sentinel in ("valid-sentinel-payload", "invalid-sentinel-payload"):
            assert sentinel not in serialized
            assert sentinel not in serialized_events
        assert "fastapi.arguments.values" not in serialized
        assert "fastapi.arguments.errors" not in serialized
    finally:
        client.shutdown(timeout_millis=5000)
