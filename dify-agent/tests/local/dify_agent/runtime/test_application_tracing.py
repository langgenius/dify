"""Exercise the actual Pydantic AI/Logfire tree and JSON delivery over local HTTP."""

import asyncio
import json
import os
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from uuid import uuid4

import httpx
import logfire
import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export import SpanExportResult
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags, use_span
from pydantic import ValidationError
from pydantic_ai import Tool
from pydantic_ai.models.test import TestModel
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.toolsets import FunctionToolset

from dify_agent.layers.dify_plugin import llm_layer
from dify_agent.layers.execution_context import ApplicationTracingContext, DifyExecutionContextLayerConfig
from dify_agent.protocol.schemas import CreateRunRequest, RunComposition, RunLayerSpec, RunSucceededEvent
from dify_agent.protocol.tracing import AgentTraceBatch
from dify_agent.runtime.agent_factory import create_agent
from dify_agent.runtime.application_trace_exporter import (
    ApplicationBatchSpanProcessor,
    DIFY_TRACING_INVOCATION_ID_ATTRIBUTE,
    DIFY_TRACING_RUN_ID_ATTRIBUTE,
    JSONSpanExporter,
)
from dify_agent.runtime.context import Services
from dify_agent.runtime.event_sink import InMemoryRunEventSink
from dify_agent.runtime.observability import AgentObservability
from dify_agent.runtime.runner import AgentRunRunner
from dify_agent.server.observability import configure_application_observability
from dify_agent.server.settings import ServerSettings


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    for key in tuple(os.environ):
        if key.startswith(("OTEL_", "LOGFIRE_", "DIFY_AGENT_")):
            monkeypatch.delenv(key)


@pytest.fixture
def inbox() -> Iterator[SimpleNamespace]:
    state = SimpleNamespace(batches=[], headers=[], paths=[], failures=0, status=None)

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            batch = AgentTraceBatch.model_validate(payload)
            state.batches.append(payload)
            state.headers.append(self.headers.get("X-Inner-Api-Key"))
            state.paths.append(self.path)
            status = state.status or (503 if state.failures else 200)
            state.failures = max(0, state.failures - 1)
            response = json.dumps(
                {"result": "success", "batch_id": str(batch.batch_id), "accepted_spans": len(batch.spans)}
            ).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    state.url = f"http://127.0.0.1:{server.server_port}"
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


def tracing_context(*, capture_content=False, sampled=True, run_id=None):
    return ApplicationTracingContext(
        run_id=run_id or uuid4(),
        invocation_id=uuid4(),
        trace_id=uuid4().hex,
        parent_span_id=uuid4().hex[:16],
        session_id="test-session",
        capture_content=capture_content,
        sampled=sampled,
    )


def execution_context(tracing):
    return DifyExecutionContextLayerConfig(
        tenant_id="test-tenant",
        app_id="test-app",
        agent_id="test-agent",
        agent_mode="agent_app",
        invoke_from="web-app",
        tracing=tracing,
    )


def configured_collector(inbox):
    collector = configure_application_observability(
        ServerSettings(
            application_tracing_enabled=True,
            inner_api_url=inbox.url,
            inner_api_key="test-inner-key",
        )
    )
    assert collector is not None
    return collector


def _tool() -> str:
    return "tool-private-content"


@pytest.mark.parametrize("capture_content", [False, True])
def test_actual_agent_tree_uses_api_parent_and_per_run_content_policy(inbox, capture_content):
    collector = configured_collector(inbox)
    tracing = tracing_context(capture_content=capture_content)
    agent = create_agent(
        TestModel(custom_output_text="answer-private-content"),
        toolsets=[FunctionToolset(tools=[Tool(_tool)])],
        capabilities=[],
    )
    collector.instrument(agent, execution_context=execution_context(tracing))
    unrelated = NonRecordingSpan(SpanContext(trace_id=1, span_id=2, is_remote=True, trace_flags=TraceFlags(1)))
    try:
        with use_span(unrelated):
            assert agent.run_sync("prompt-private-content").output == "answer-private-content"
        assert asyncio.run(collector.finish_invocation(tracing))
        spans = [span for batch in inbox.batches for span in batch["spans"]]
        assert spans
        assert any("execute_tool" in span["name"] or "_tool" in span["name"] for span in spans)
        roots = [span for span in spans if span["parent_span_id"] == tracing.parent_span_id]
        assert len(roots) == 1
        assert roots[0]["name"] == "invoke_agent dify-agent"
        ids = {span["span_id"] for span in spans}
        for span in spans:
            assert span["trace_id"] == tracing.trace_id
            assert span["parent_span_id"] == tracing.parent_span_id or span["parent_span_id"] in ids
            assert span["attributes"]["dify.tenant_id"] == "test-tenant"
            assert span["attributes"][DIFY_TRACING_INVOCATION_ID_ATTRIBUTE] == str(tracing.invocation_id)
        serialized = json.dumps(spans)
        assert ("prompt-private-content" in serialized) is capture_content
        assert ("tool-private-content" in serialized) is capture_content
        assert inbox.batches[-1]["final"] is True
        assert inbox.batches[-1]["spans"] == []
        assert set(inbox.paths) == {"/inner/api/agent/tracing/batches"}
        assert set(inbox.headers) == {"test-inner-key"}
    finally:
        asyncio.run(collector.aclose())


def test_retry_reuses_exact_batch_and_completion_waits_for_ack(inbox):
    collector = configured_collector(inbox)
    tracing = tracing_context()
    inbox.failures = 1
    agent = create_agent(TestModel(), toolsets=[], capabilities=[])
    collector.instrument(agent, execution_context=execution_context(tracing))
    try:
        agent.run_sync("hello")
        assert asyncio.run(collector.finish_invocation(tracing))
        assert len(inbox.batches) >= 3
        assert inbox.batches[0] == inbox.batches[1]
        assert inbox.batches[-1]["final"] is True
    finally:
        asyncio.run(collector.aclose())


def test_unacknowledged_invocation_never_emits_final_or_blocks_another_invocation(inbox):
    collector = configured_collector(inbox)
    first = tracing_context()
    second = tracing_context(run_id=first.run_id)
    try:
        agent = create_agent(TestModel(), toolsets=[], capabilities=[])
        collector.instrument(agent, execution_context=execution_context(first))
        agent.run_sync("hello")
        inbox.status = 503
        assert not asyncio.run(collector.finish_invocation(first))
        assert not any(batch["final"] for batch in inbox.batches)
        inbox.status = None
        collector.instrument(agent, execution_context=execution_context(second))
        agent.run_sync("second")
        assert asyncio.run(collector.finish_invocation(second))
        finals = [batch for batch in inbox.batches if batch["final"]]
        assert [batch["invocation_id"] for batch in finals] == [str(second.invocation_id)]
    finally:
        asyncio.run(collector.aclose())


def test_sampling_off_sends_only_completion(inbox):
    collector = configured_collector(inbox)
    tracing = tracing_context(sampled=False)
    agent = create_agent(TestModel(), toolsets=[], capabilities=[])
    collector.instrument(agent, execution_context=execution_context(tracing))
    try:
        agent.run_sync("hello")
        assert asyncio.run(collector.finish_invocation(tracing))
        assert len(inbox.batches) == 1
        assert inbox.batches[0]["final"] is True
        assert inbox.batches[0]["spans"] == []
    finally:
        asyncio.run(collector.aclose())


def test_shutdown_drains_ended_spans_without_inventing_completion(inbox):
    collector = configured_collector(inbox)
    tracing = tracing_context()
    agent = create_agent(TestModel(), toolsets=[], capabilities=[])
    collector.instrument(agent, execution_context=execution_context(tracing))
    agent.run_sync("hello")
    asyncio.run(collector.aclose())
    assert any(batch["spans"] for batch in inbox.batches)
    assert not any(batch["final"] for batch in inbox.batches)


def test_concurrent_invocations_keep_parent_and_content_policy_separate(inbox):
    collector = configured_collector(inbox)
    first = tracing_context(capture_content=False)
    second = tracing_context(capture_content=True, run_id=first.run_id)

    async def invoke(tracing, prompt):
        agent = create_agent(TestModel(), toolsets=[], capabilities=[])
        collector.instrument(agent, execution_context=execution_context(tracing))
        await agent.run(prompt)
        assert await collector.finish_invocation(tracing)

    try:

        async def both():
            await asyncio.gather(invoke(first, "private-first"), invoke(second, "visible-second"))

        asyncio.run(both())
        for tracing in (first, second):
            batches = [batch for batch in inbox.batches if batch["invocation_id"] == str(tracing.invocation_id)]
            assert batches[-1]["final"] is True
            spans = [span for batch in batches for span in batch["spans"]]
            roots = [span for span in spans if span["parent_span_id"] == tracing.parent_span_id]
            assert len(roots) == 1
            assert {span["trace_id"] for span in spans} == {tracing.trace_id}
            assert "private-first" not in json.dumps(spans)
            assert ("visible-second" in json.dumps(spans)) is tracing.capture_content
    finally:
        asyncio.run(collector.aclose())


def test_queue_overflow_does_not_acknowledge_complete_run(inbox):
    tracing = tracing_context()
    exporter = JSONSpanExporter(inner_api_url=inbox.url, inner_api_key="test-inner-key")
    processor = ApplicationBatchSpanProcessor(
        exporter, max_queue_size=1, max_export_batch_size=10, schedule_delay_seconds=3600
    )
    provider = TracerProvider()
    provider.add_span_processor(processor)
    tracer = provider.get_tracer("test")
    attributes = {
        DIFY_TRACING_RUN_ID_ATTRIBUTE: str(tracing.run_id),
        DIFY_TRACING_INVOCATION_ID_ATTRIBUTE: str(tracing.invocation_id),
        "choices": ("a", "b"),
    }
    try:
        for name in ("one", "two"):
            with tracer.start_as_current_span(name, attributes=attributes):
                pass
        assert processor.force_flush()
        assert not exporter.finish_invocation(tracing.run_id, tracing.invocation_id)
        assert not exporter.finish_invocation(tracing.run_id, tracing.invocation_id)
        assert not any(batch["final"] for batch in inbox.batches)
        assert inbox.batches[0]["spans"][0]["attributes"]["choices"] == ["a", "b"]
    finally:
        provider.shutdown()


@pytest.mark.parametrize("delivery_status", [None, 503])
def test_runner_prefers_application_pipeline_and_finishes_before_success(inbox, monkeypatch, delivery_status):
    collector = configured_collector(inbox)
    inbox.status = delivery_status
    tracing = tracing_context()
    deployment_exporter = InMemorySpanExporter()
    deployment_client = logfire.configure(
        local=True,
        send_to_logfire=False,
        console=False,
        metrics=False,
        additional_span_processors=[SimpleSpanProcessor(deployment_exporter)],
    )
    monkeypatch.setattr(llm_layer.Capability, "build_model", lambda self, deps: TestModel())
    incoming = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(name="execution_context", config=execution_context(tracing).model_dump(mode="json")),
                RunLayerSpec(name="llm", config={"plugin_id": "test", "model_provider": "test", "model": "test"}),
                RunLayerSpec(name="prompt", config={"user": "hello"}),
            ]
        )
    )

    async def run():
        async with httpx.AsyncClient(trust_env=False) as client:
            sink = InMemoryRunEventSink()
            runner = AgentRunRunner(
                sink=sink,
                request=incoming,
                run_id="backend-run",
                services=Services(client, client),
                agent_observability=AgentObservability(client=deployment_client),
                application_observability=collector,
            )
            await runner.run()
            assert isinstance(sink.events["backend-run"][-1], RunSucceededEvent)
            assert inbox.batches[-1]["final"] is (delivery_status is None)

    try:
        asyncio.run(run())
        deployment_client.force_flush()
        assert not deployment_exporter.get_finished_spans()
    finally:
        asyncio.run(collector.aclose())
        deployment_client.shutdown()


@pytest.mark.parametrize("oversized", [False, True])
def test_batches_respect_utf8_byte_limit_and_oversized_spans_prevent_final(inbox, oversized):
    tracing = tracing_context()
    memory = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(memory))
    tracer = provider.get_tracer("test")
    attributes = {
        DIFY_TRACING_RUN_ID_ATTRIBUTE: str(tracing.run_id),
        DIFY_TRACING_INVOCATION_ID_ATTRIBUTE: str(tracing.invocation_id),
        "unicode-content": "汉" * (5000 if oversized else 600),
    }
    for index in range(3):
        with tracer.start_as_current_span(str(index), attributes=attributes):
            pass
    exporter = JSONSpanExporter(inner_api_url=inbox.url, inner_api_key="test-inner-key", max_batch_bytes=4096)
    try:
        result = exporter.export(memory.get_finished_spans())
        assert result == (SpanExportResult.FAILURE if oversized else SpanExportResult.SUCCESS)
        assert exporter.finish_invocation(tracing.run_id, tracing.invocation_id) is not oversized
        if oversized:
            assert not inbox.batches
        else:
            assert len([batch for batch in inbox.batches if batch["spans"]]) == 3
            assert all(
                len(json.dumps(batch, ensure_ascii=False, separators=(",", ":")).encode()) <= 4096
                for batch in inbox.batches
            )
    finally:
        provider.shutdown()
        exporter.shutdown()


@pytest.mark.parametrize("cancel", [False, True])
def test_runner_flushes_on_model_error_and_cancellation(inbox, monkeypatch, cancel):
    collector = configured_collector(inbox)
    tracing = tracing_context()

    async def run():
        entered = asyncio.Event()

        async def stream(_messages, _info):
            entered.set()
            if cancel:
                await asyncio.Event().wait()
            raise RuntimeError("test-only model failure")
            yield "unreachable"

        monkeypatch.setattr(
            llm_layer.Capability, "build_model", lambda self, deps: FunctionModel(stream_function=stream)
        )
        incoming = CreateRunRequest(
            composition=RunComposition(
                layers=[
                    RunLayerSpec(name="execution_context", config=execution_context(tracing).model_dump(mode="json")),
                    RunLayerSpec(name="llm", config={"plugin_id": "test", "model_provider": "test", "model": "test"}),
                    RunLayerSpec(name="prompt", config={"user": "hello"}),
                ]
            )
        )
        async with httpx.AsyncClient(trust_env=False) as client:
            runner = AgentRunRunner(
                sink=InMemoryRunEventSink(),
                request=incoming,
                run_id="backend-run",
                services=Services(client, client),
                application_observability=collector,
            )
            task = asyncio.create_task(runner.run())
            await entered.wait()
            if cancel:
                task.cancel()
            with pytest.raises(asyncio.CancelledError if cancel else RuntimeError):
                await task
            assert inbox.batches[-1]["final"] is True
            assert any(batch["spans"] for batch in inbox.batches)
            roots = [
                span
                for batch in inbox.batches
                for span in batch["spans"]
                if span["attributes"].get("gen_ai.operation.name") == "invoke_agent"
            ]
            assert len(roots) == 1
            assert "dify.agent.execution_state" not in roots[0]["attributes"]

    try:
        asyncio.run(run())
    finally:
        asyncio.run(collector.aclose())


@pytest.mark.parametrize("early_cancel", [False, True])
@pytest.mark.parametrize("sampled", [False, True])
def test_setup_failure_or_early_cancel_has_one_timed_fallback_only_when_sampled(
    inbox, monkeypatch, early_cancel, sampled
):
    collector = configured_collector(inbox)
    tracing = tracing_context(sampled=sampled, capture_content=True)

    def fail_model_setup(self, deps):
        raise ValueError("test-only invalid model configuration")

    monkeypatch.setattr(llm_layer.Capability, "build_model", fail_model_setup)
    incoming = CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(name="execution_context", config=execution_context(tracing).model_dump(mode="json")),
                RunLayerSpec(name="llm", config={"plugin_id": "test", "model_provider": "test", "model": "test"}),
                RunLayerSpec(name="prompt", config={"user": "hello"}),
            ]
        )
    )
    before = time.time_ns()

    async def run():
        async with httpx.AsyncClient(trust_env=False) as client:
            runner = AgentRunRunner(
                sink=InMemoryRunEventSink(),
                request=incoming,
                run_id="backend-run",
                services=Services(client, client),
                application_observability=collector,
                is_cancelled=lambda: early_cancel,
            )
            if early_cancel:
                await runner.run()
            else:
                with pytest.raises(ValueError, match="invalid model configuration"):
                    await runner.run()

    try:
        asyncio.run(run())
        after = time.time_ns()
        assert inbox.batches[-1]["final"] is True
        spans = [span for batch in inbox.batches for span in batch["spans"]]
        if not sampled:
            assert spans == []
            return
        assert len(spans) == 1
        span = spans[0]
        assert span["trace_id"] == tracing.trace_id
        assert span["parent_span_id"] == tracing.parent_span_id
        assert span["attributes"]["gen_ai.operation.name"] == "invoke_agent"
        assert span["attributes"]["dify.agent.execution_state"] == (
            "cancelled" if early_cancel else "initialization_failed"
        )
        assert span["status"] == "error"
        assert before <= span["start_time_ns"] <= span["end_time_ns"] <= after
        assert span["status_message"] == (
            "Agent cancelled before execution" if early_cancel else "test-only invalid model configuration"
        )
    finally:
        asyncio.run(collector.aclose())


@pytest.mark.parametrize("field,value", [("version", 2), ("trace_id", "0" * 32), ("parent_span_id", "x" * 16)])
def test_invalid_api_trace_context_is_rejected(field, value):
    payload = tracing_context().model_dump(mode="json")
    payload[field] = value
    with pytest.raises(ValidationError):
        ApplicationTracingContext.model_validate(payload)


def test_application_collection_is_disabled_by_default():
    assert ServerSettings().application_tracing_enabled is False
    assert configure_application_observability(ServerSettings()) is None
