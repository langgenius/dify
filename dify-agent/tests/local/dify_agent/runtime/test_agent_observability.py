"""Real Logfire/OTel SDK tests for the opt-in Agent observability instance."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator
from typing import Literal, cast

import httpx
import logfire
import pytest
from opentelemetry import context as otel_context
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags, get_current_span, set_span_in_context
from pydantic_ai import Agent, Tool
from pydantic_ai.models.instrumented import InstrumentationSettings
from pydantic_ai.models.test import TestModel

import dify_agent.server.observability as server_observability
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.runtime.agent_factory import DIFY_AGENT_RUN_NAME, create_agent
from dify_agent.runtime.observability import (
    DIFY_TENANT_ID_ATTRIBUTE,
    GEN_AI_USER_ID_ATTRIBUTE,
    AgentObservability,
    IsolatedTracerProvider,
    dify_run_attributes,
)
from dify_agent.server.settings import ServerSettings

_AGENT_RUN_SPAN_NAME = f"invoke_agent {DIFY_AGENT_RUN_NAME}"


@pytest.fixture(autouse=True)
def isolate_environment(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(os, "environ", dict(os.environ))
    for key in tuple(os.environ):
        if key.startswith(("OTEL_", "LOGFIRE_")):
            monkeypatch.delenv(key)


@pytest.fixture(autouse=True)
def restore_agent_instrumentation(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(Agent, "_instrument_default", False)
    yield


def _local_client(exporter: InMemorySpanExporter) -> logfire.Logfire:
    return logfire.configure(
        local=True,
        send_to_logfire=False,
        console=False,
        metrics=False,
        inspect_arguments=False,
        additional_span_processors=[SimpleSpanProcessor(exporter)],
    )


def _platform_provider(exporter: InMemorySpanExporter) -> TracerProvider:
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider


def _static_tool() -> str:
    return "tool-sentinel-output"


def _serialized_attributes(exporter: InMemorySpanExporter) -> str:
    return repr([dict(span.attributes or {}) for span in exporter.get_finished_spans()])


def test_create_agent_instrument_disabled_survives_global_instrument_all() -> None:
    platform_exporter = InMemorySpanExporter()
    platform_provider = _platform_provider(platform_exporter)
    try:
        Agent.instrument_all(InstrumentationSettings(tracer_provider=platform_provider))

        agent = create_agent(TestModel(custom_output_text="done"), tools=[])
        assert agent.instrument is False

        _ = agent.run_sync("test-only input")
        platform_provider.force_flush()

        assert not platform_exporter.get_finished_spans()
    finally:
        platform_provider.shutdown()


def test_agent_observability_runs_agent_spans_to_business_exporter_only() -> None:
    platform_exporter = InMemorySpanExporter()
    platform_provider = _platform_provider(platform_exporter)
    business_exporter = InMemorySpanExporter()
    client = _local_client(business_exporter)
    try:
        Agent.instrument_all(InstrumentationSettings(tracer_provider=platform_provider))
        observability = AgentObservability(client=client)
        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(_static_tool)])
        observability.instrument(agent)

        _ = agent.run_sync("test-only input")
        assert client.force_flush(timeout_millis=10000)
        platform_provider.force_flush()

        business_spans = business_exporter.get_finished_spans()
        assert business_spans
        assert any(
            span.instrumentation_scope is not None and "pydantic" in span.instrumentation_scope.name
            for span in business_spans
        )
        span_names = [span.name for span in business_spans]
        assert any("_static_tool" in name or "execute_tool" in name for name in span_names), span_names
        assert not platform_exporter.get_finished_spans()
    finally:
        client.shutdown(timeout_millis=5000)
        platform_provider.shutdown()


def test_agent_observability_excludes_content_by_default() -> None:
    exporter = InMemorySpanExporter()
    client = _local_client(exporter)
    try:
        observability = AgentObservability(client=client, include_content=False)
        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(_static_tool)])
        observability.instrument(agent)

        _ = agent.run_sync("content-sentinel-input-1")
        assert client.force_flush(timeout_millis=10000)

        spans = exporter.get_finished_spans()
        assert spans
        serialized = _serialized_attributes(exporter)
        assert "content-sentinel-input-1" not in serialized
        assert "tool-sentinel-output" not in serialized
    finally:
        client.shutdown(timeout_millis=5000)


def test_agent_observability_includes_content_when_opted_in() -> None:
    exporter = InMemorySpanExporter()
    client = _local_client(exporter)
    try:
        observability = AgentObservability(client=client, include_content=True)
        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(_static_tool)])
        observability.instrument(agent)

        _ = agent.run_sync("content-sentinel-input-2")
        assert client.force_flush(timeout_millis=10000)

        spans = exporter.get_finished_spans()
        assert spans
        serialized = _serialized_attributes(exporter)
        assert "content-sentinel-input-2" in serialized
    finally:
        client.shutdown(timeout_millis=5000)


def test_business_agent_root_detaches_from_platform_parent_span() -> None:
    platform_exporter = InMemorySpanExporter()
    platform_client = _local_client(platform_exporter)
    business_exporter = InMemorySpanExporter()
    business_client = _local_client(business_exporter)
    try:
        observability = AgentObservability(client=business_client)
        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(_static_tool)])
        observability.instrument(agent)

        with platform_client.span("platform-incoming-request"):
            _ = agent.run_sync("test-only input")
        assert platform_client.force_flush(timeout_millis=10000)
        assert business_client.force_flush(timeout_millis=10000)

        platform_root = next(
            span for span in platform_exporter.get_finished_spans() if span.name == "platform-incoming-request"
        )
        agent_root = next(span for span in business_exporter.get_finished_spans() if span.name == _AGENT_RUN_SPAN_NAME)
        assert agent_root.parent is None
        assert agent_root.context is not None
        assert agent_root.context.trace_id != platform_root.context.trace_id
    finally:
        business_client.shutdown(timeout_millis=5000)
        platform_client.shutdown(timeout_millis=5000)


def test_agent_shutdown_does_not_stop_platform_pipeline() -> None:
    platform_exporter = InMemorySpanExporter()
    platform_client = _local_client(platform_exporter)
    business_exporter = InMemorySpanExporter()
    business_client = _local_client(business_exporter)
    try:
        Agent.instrument_all(InstrumentationSettings(tracer_provider=platform_client.config.get_tracer_provider()))
        observability = AgentObservability(client=business_client)
        agent = create_agent(TestModel(custom_output_text="done"), tools=[])
        observability.instrument(agent)
        _ = agent.run_sync("test-only input")
        assert business_client.force_flush(timeout_millis=10000)
        assert business_exporter.get_finished_spans()

        business_client.shutdown(timeout_millis=5000)
        business_client = None

        with platform_client.span("platform-marker-after-agent-shutdown"):
            pass
        assert platform_client.force_flush(timeout_millis=10000)
        assert any(
            span.name == "platform-marker-after-agent-shutdown" for span in platform_exporter.get_finished_spans()
        )
    finally:
        if business_client is not None:
            business_client.shutdown(timeout_millis=5000)
        platform_client.shutdown(timeout_millis=5000)


def _spans_by_name(exporter: InMemorySpanExporter, name: str) -> list:
    return [span for span in exporter.get_finished_spans() if span.name == name]


def _assert_parents_resolve_within(exporter: InMemorySpanExporter) -> None:
    spans = exporter.get_finished_spans()
    local_ids = {span.context.span_id for span in spans}
    for span in spans:
        if span.parent is not None:
            assert span.parent.span_id in local_ids, span.name


def test_business_descendants_stay_in_business_trace_and_caller_context_restored() -> None:
    platform_exporter = InMemorySpanExporter()
    platform_client = _local_client(platform_exporter)
    business_exporter = InMemorySpanExporter()
    business_client = _local_client(business_exporter)
    try:
        observability = AgentObservability(client=business_client)
        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(_static_tool)])
        observability.instrument(agent)

        with platform_client.span("platform-incoming-request") as platform_span:
            _ = agent.run_sync("test-only input")
            assert get_current_span().get_span_context() == platform_span.get_span_context()
        assert platform_client.force_flush(timeout_millis=10000)
        assert business_client.force_flush(timeout_millis=10000)

        platform_trace_ids = {span.context.trace_id for span in platform_exporter.get_finished_spans()}
        business_spans = business_exporter.get_finished_spans()
        roots = _spans_by_name(business_exporter, _AGENT_RUN_SPAN_NAME)
        assert len(roots) == 1
        root = roots[0]
        assert root.parent is None
        descendants = [span for span in business_spans if span is not root]
        assert descendants
        for span in descendants:
            assert span.parent is not None
            assert span.context.trace_id == root.context.trace_id
        _assert_parents_resolve_within(business_exporter)
        assert root.context.trace_id not in platform_trace_ids
    finally:
        business_client.shutdown(timeout_millis=5000)
        platform_client.shutdown(timeout_millis=5000)


def test_platform_httpx_client_span_detaches_from_business_parent() -> None:
    platform_exporter = InMemorySpanExporter()
    platform_client = _local_client(platform_exporter)
    business_exporter = InMemorySpanExporter()
    business_client = _local_client(business_exporter)
    http = httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"ok": True})))
    try:
        platform_client.instrument_httpx(
            http,
            capture_all=False,
            tracer_provider=IsolatedTracerProvider(platform_client, preserve_external_parent=True),
        )

        def net_tool() -> str:
            return http.get("http://test-only.local/ping").text

        observability = AgentObservability(client=business_client)
        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(net_tool)])
        observability.instrument(agent)

        with platform_client.span("platform-incoming-request"):
            _ = agent.run_sync("test-only input")
        http.close()
        assert platform_client.force_flush(timeout_millis=10000)
        assert business_client.force_flush(timeout_millis=10000)

        platform_spans = platform_exporter.get_finished_spans()
        http_spans = [span for span in platform_spans if span.name.startswith("GET")]
        assert http_spans
        business_spans = business_exporter.get_finished_spans()
        business_trace_ids = {span.context.trace_id for span in business_spans}
        business_span_ids = {span.context.span_id for span in business_spans}
        for span in http_spans:
            assert span.parent is None or span.parent.span_id not in business_span_ids
            assert span.context.trace_id not in business_trace_ids
        _assert_parents_resolve_within(platform_exporter)
        _assert_parents_resolve_within(business_exporter)
        assert _spans_by_name(business_exporter, _AGENT_RUN_SPAN_NAME)
    finally:
        http.close()
        business_client.shutdown(timeout_millis=5000)
        platform_client.shutdown(timeout_millis=5000)


def test_isolated_tracer_preserves_same_instance_and_external_parents() -> None:
    exporter = InMemorySpanExporter()
    client = _local_client(exporter)
    try:
        tracer = IsolatedTracerProvider(client, preserve_external_parent=True).get_tracer("test-scope")
        with client.span("platform-outer"):
            with tracer.start_as_current_span("platform-inner"):
                pass
            remote_ctx = set_span_in_context(
                NonRecordingSpan(
                    SpanContext(
                        trace_id=0x1111,
                        span_id=0x2222,
                        is_remote=True,
                        trace_flags=TraceFlags(TraceFlags.SAMPLED),
                    )
                )
            )
            with tracer.start_as_current_span("from-remote", context=remote_ctx):
                pass
        assert client.force_flush(timeout_millis=10000)

        spans = {span.name: span for span in exporter.get_finished_spans()}
        inner = spans["platform-inner"]
        outer = spans["platform-outer"]
        remote = spans["from-remote"]
        assert inner.parent is not None
        assert inner.parent.span_id == outer.context.span_id
        assert inner.context.trace_id == outer.context.trace_id
        assert remote.parent is not None
        assert remote.parent.span_id == 0x2222
        assert remote.context.trace_id == 0x1111
    finally:
        client.shutdown(timeout_millis=5000)


@pytest.mark.parametrize("method", ["start_span", "start_as_current_span"])
@pytest.mark.parametrize("sampled", [True, False])
def test_isolated_tracer_remote_and_same_instance_parent_policy(method: str, sampled: bool) -> None:
    platform_exporter = InMemorySpanExporter()
    platform_client = _local_client(platform_exporter)
    business_exporter = InMemorySpanExporter()
    business_client = _local_client(business_exporter)
    try:
        platform_tracer = IsolatedTracerProvider(platform_client, preserve_external_parent=True).get_tracer("platform")
        business_tracer = IsolatedTracerProvider(business_client).get_tracer("business")
        remote = NonRecordingSpan(
            SpanContext(
                trace_id=0xABCD,
                span_id=0x1234,
                is_remote=True,
                trace_flags=TraceFlags(TraceFlags.SAMPLED if sampled else 0),
            )
        )
        remote_ctx = otel_context.set_value("preserved-key", "preserved-value", set_span_in_context(remote))

        def invoke(tracer, name, ctx) -> None:
            if method == "start_span":
                span = tracer.start_span(name, context=ctx)
                span.end()
            else:
                with tracer.start_as_current_span(name, context=ctx):
                    pass

        invoke(platform_tracer, "platform-remote-child", remote_ctx)
        invoke(business_tracer, "business-remote-child", remote_ctx)
        with business_client.span("business-outer"):
            invoke(business_tracer, "business-same-child", set_span_in_context(get_current_span()))
        assert platform_client.force_flush(timeout_millis=10000)
        assert business_client.force_flush(timeout_millis=10000)

        platform_remotes = _spans_by_name(platform_exporter, "platform-remote-child")
        if sampled:
            platform_remote = platform_remotes[0]
            assert platform_remote.parent is not None
            assert platform_remote.parent.span_id == 0x1234
            assert platform_remote.context.trace_id == 0xABCD
        else:
            assert platform_remotes == []
        business_remote = _spans_by_name(business_exporter, "business-remote-child")[0]
        assert business_remote.parent is None
        assert business_remote.context.trace_id != 0xABCD
        business_same = _spans_by_name(business_exporter, "business-same-child")[0]
        business_outer_span = _spans_by_name(business_exporter, "business-outer")[0]
        assert business_same.parent is not None
        assert business_same.parent.span_id == business_outer_span.context.span_id
        assert business_same.context.trace_id == business_outer_span.context.trace_id
    finally:
        business_client.shutdown(timeout_millis=5000)
        platform_client.shutdown(timeout_millis=5000)


def test_concurrent_agent_runs_have_independent_business_roots() -> None:
    platform_exporter = InMemorySpanExporter()
    platform_client = _local_client(platform_exporter)
    business_exporter = InMemorySpanExporter()
    business_client = _local_client(business_exporter)
    try:
        observability = AgentObservability(client=business_client)
        agents = []
        for index in range(2):
            agent = create_agent(TestModel(custom_output_text=f"done-{index}"), tools=[Tool(_static_tool)])
            observability.instrument(agent)
            agents.append(agent)

        async def scenario() -> None:
            with platform_client.span("platform-shared-parent") as platform_span:
                await asyncio.gather(*(agent.run("test-only input") for agent in agents))
                assert get_current_span().get_span_context() == platform_span.get_span_context()

        asyncio.run(scenario())
        assert platform_client.force_flush(timeout_millis=10000)
        assert business_client.force_flush(timeout_millis=10000)

        roots = _spans_by_name(business_exporter, _AGENT_RUN_SPAN_NAME)
        assert len(roots) == 2
        assert all(root.parent is None for root in roots)
        assert roots[0].context.trace_id != roots[1].context.trace_id
        for span in business_exporter.get_finished_spans():
            if span in roots:
                continue
            assert span.parent is not None
            assert span.context.trace_id in {root.context.trace_id for root in roots}
        _assert_parents_resolve_within(business_exporter)
    finally:
        business_client.shutdown(timeout_millis=5000)
        platform_client.shutdown(timeout_millis=5000)


def test_isolated_tracer_restores_context_on_exception() -> None:
    exporter = InMemorySpanExporter()
    client = _local_client(exporter)
    try:
        tracer = IsolatedTracerProvider(client).get_tracer("test-scope")
        with client.span("outer") as outer:
            with pytest.raises(RuntimeError, match="boom"):
                with tracer.start_as_current_span("failing-span"):
                    raise RuntimeError("boom")
            assert get_current_span().get_span_context() == outer.get_span_context()
        assert client.force_flush(timeout_millis=10000)
        assert _spans_by_name(exporter, "failing-span")
    finally:
        client.shutdown(timeout_millis=5000)


def test_isolated_tracer_restores_context_on_task_cancellation() -> None:
    exporter = InMemorySpanExporter()
    client = _local_client(exporter)
    try:
        tracer = IsolatedTracerProvider(client).get_tracer("test-scope")

        async def scenario() -> None:
            with client.span("outer") as outer:
                started = asyncio.Event()

                async def body() -> None:
                    with tracer.start_as_current_span("cancelled-span"):
                        started.set()
                        await asyncio.Event().wait()

                task = asyncio.create_task(body())
                await asyncio.wait_for(started.wait(), timeout=1)
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
                assert get_current_span().get_span_context() == outer.get_span_context()

        asyncio.run(scenario())
    finally:
        client.shutdown(timeout_millis=5000)


def test_shared_trace_context_mode_links_business_run_to_platform_parent() -> None:
    platform_exporter = InMemorySpanExporter()
    platform_client = _local_client(platform_exporter)
    business_exporter = InMemorySpanExporter()
    business_client = _local_client(business_exporter)
    http = httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={"ok": True})))
    try:
        platform_client.instrument_httpx(
            http,
            capture_all=False,
            tracer_provider=platform_client.config.get_tracer_provider(),
        )

        def net_tool() -> str:
            return http.get("http://test-only.local/ping").text

        observability = AgentObservability(client=business_client, trace_context_mode="shared")
        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(net_tool)])
        observability.instrument(agent)

        with platform_client.span("shared-platform-root"):
            platform_context = get_current_span().get_span_context()
            _ = agent.run_sync("test-only input")
        http.close()
        assert platform_client.force_flush(timeout_millis=10000)
        assert business_client.force_flush(timeout_millis=10000)

        platform_spans = platform_exporter.get_finished_spans()
        business_spans = business_exporter.get_finished_spans()
        all_spans = [*platform_spans, *business_spans]
        assert len({span.context.trace_id for span in all_spans}) == 1
        assert all(span.context.trace_id == platform_context.trace_id for span in all_spans)
        root = _spans_by_name(business_exporter, _AGENT_RUN_SPAN_NAME)[0]
        assert root.parent is not None
        assert root.parent.span_id == platform_context.span_id
        http_spans = [span for span in platform_spans if span.name.startswith("GET")]
        assert http_spans
        business_ids = {span.context.span_id for span in business_spans}
        for span in http_spans:
            assert span.parent is not None
            assert span.parent.span_id in business_ids
        all_ids = {(span.context.trace_id, span.context.span_id) for span in all_spans}
        for span in all_spans:
            if span.parent is not None:
                assert (span.context.trace_id, span.parent.span_id) in all_ids
        assert not any(
            span.instrumentation_scope is not None and "pydantic" in span.instrumentation_scope.name
            for span in platform_spans
        )
        assert not _spans_by_name(business_exporter, "shared-platform-root")
    finally:
        http.close()
        business_client.shutdown(timeout_millis=5000)
        platform_client.shutdown(timeout_millis=5000)


def test_shared_mode_agent_pipeline_respects_remote_parent_sampling(monkeypatch: pytest.MonkeyPatch) -> None:
    business_exporter = InMemorySpanExporter()
    monkeypatch.setattr(server_observability, "OTLPSpanExporter", lambda **_kwargs: business_exporter)
    settings = ServerSettings(
        _env_file=None,
        trajectory_enabled=True,
        trajectory_otlp_traces_endpoint="http://127.0.0.1:1/v1/traces",
        trajectory_service_name="dify-agent-trajectory",
        trajectory_trace_context_mode="shared",
    )
    observability_instance = server_observability.configure_agent_observability(settings)
    assert observability_instance is not None
    try:
        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(_static_tool)])
        observability_instance.instrument(agent)

        unsampled = set_span_in_context(
            NonRecordingSpan(SpanContext(trace_id=0x9999, span_id=0x1111, is_remote=True, trace_flags=TraceFlags(0)))
        )
        token = otel_context.attach(unsampled)
        try:
            _ = agent.run_sync("unsampled-parent input")
        finally:
            otel_context.detach(token)
        assert observability_instance.client.force_flush(timeout_millis=10000)
        assert not business_exporter.get_finished_spans()

        sampled = set_span_in_context(
            NonRecordingSpan(
                SpanContext(
                    trace_id=0x8888,
                    span_id=0x2222,
                    is_remote=True,
                    trace_flags=TraceFlags(TraceFlags.SAMPLED),
                )
            )
        )
        token = otel_context.attach(sampled)
        try:
            _ = agent.run_sync("sampled-parent input")
        finally:
            otel_context.detach(token)
        assert observability_instance.client.force_flush(timeout_millis=10000)
        spans = business_exporter.get_finished_spans()
        assert spans
        assert all(span.context.trace_id == 0x8888 for span in spans)
        root = _spans_by_name(business_exporter, _AGENT_RUN_SPAN_NAME)[0]
        assert root.parent is not None
        assert root.parent.span_id == 0x2222
    finally:
        observability_instance.client.shutdown(timeout_millis=5000)


def _workflow_execution_context() -> DifyExecutionContextLayerConfig:
    return DifyExecutionContextLayerConfig(
        tenant_id="tenant-1",
        app_id="app-1",
        agent_id="agent-1",
        user_id="user-1",
        user_from="account",
        workflow_id="workflow-1",
        workflow_run_id="workflow-run-1",
        node_id="node-1",
        node_execution_id="node-execution-1",
        agent_mode="workflow_run",
        invoke_from="service-api",
    )


def test_dify_run_attributes_use_data_push_names_and_drop_absent_fields() -> None:
    workflow_attributes = dict(dify_run_attributes(_workflow_execution_context()))

    assert workflow_attributes == {
        "dify.tenant_id": "tenant-1",
        "dify.app_id": "app-1",
        "dify.agent_id": "agent-1",
        "gen_ai.user.id": "user-1",
        "dify.invoke_from": "service-api",
        "dify.workflow.id": "workflow-1",
        "dify.workflow.run_id": "workflow-run-1",
        "dify.node.id": "node-1",
        "dify.node.execution_id": "node-execution-1",
    }

    agent_app_attributes = dict(
        dify_run_attributes(
            DifyExecutionContextLayerConfig(
                tenant_id="tenant-1",
                app_id="app-1",
                agent_id="agent-1",
                conversation_id="conversation-1",
                trace_id="trace-1",
                user_from="end-user",
                agent_mode="agent_app",
                invoke_from="web-app",
            )
        )
    )

    # An Agent App turn has no workflow graph, so those keys stay absent instead of
    # being exported empty; the conversation and business trace ids take their place.
    assert agent_app_attributes == {
        "dify.trace_id": "trace-1",
        "dify.tenant_id": "tenant-1",
        "dify.app_id": "app-1",
        "dify.agent_id": "agent-1",
        "dify.invoke_from": "web-app",
        "dify.conversation.id": "conversation-1",
    }


@pytest.mark.parametrize("trace_context_mode", ["isolated", "shared"])
def test_agent_observability_stamps_dify_context_on_every_run_span(trace_context_mode: str) -> None:
    exporter = InMemorySpanExporter()
    client = _local_client(exporter)
    expected = dict(dify_run_attributes(_workflow_execution_context()))
    try:
        observability = AgentObservability(
            client=client,
            trace_context_mode=cast(Literal["isolated", "shared"], trace_context_mode),
        )
        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(_static_tool)])
        observability.instrument(agent, execution_context=_workflow_execution_context())

        _ = agent.run_sync("test-only input")
        assert client.force_flush(timeout_millis=10000)

        spans = exporter.get_finished_spans()
        assert spans
        for span in spans:
            attributes = dict(span.attributes or {})
            assert {key: attributes.get(key) for key in expected} == expected, span.name
        run_span = _spans_by_name(exporter, _AGENT_RUN_SPAN_NAME)[0]
        assert run_span.attributes is not None
        assert run_span.attributes["gen_ai.operation.name"] == "invoke_agent"
    finally:
        client.shutdown(timeout_millis=5000)


def test_agent_observability_omits_dify_attributes_without_an_execution_context() -> None:
    exporter = InMemorySpanExporter()
    client = _local_client(exporter)
    try:
        observability = AgentObservability(client=client)
        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(_static_tool)])
        observability.instrument(agent)

        _ = agent.run_sync("test-only input")
        assert client.force_flush(timeout_millis=10000)

        spans = exporter.get_finished_spans()
        assert spans
        for span in spans:
            attributes = dict(span.attributes or {})
            assert not [key for key in attributes if key.startswith("dify.")], span.name
            assert GEN_AI_USER_ID_ATTRIBUTE not in attributes
    finally:
        client.shutdown(timeout_millis=5000)


def test_dify_attributes_do_not_break_isolated_parent_policy() -> None:
    platform_exporter = InMemorySpanExporter()
    platform_client = _local_client(platform_exporter)
    business_exporter = InMemorySpanExporter()
    business_client = _local_client(business_exporter)
    try:
        observability = AgentObservability(client=business_client)
        agent = create_agent(TestModel(custom_output_text="done"), tools=[Tool(_static_tool)])
        observability.instrument(agent, execution_context=_workflow_execution_context())

        with platform_client.span("platform-incoming-request"):
            _ = agent.run_sync("test-only input")
        assert platform_client.force_flush(timeout_millis=10000)
        assert business_client.force_flush(timeout_millis=10000)

        platform_root = next(
            span for span in platform_exporter.get_finished_spans() if span.name == "platform-incoming-request"
        )
        root = _spans_by_name(business_exporter, _AGENT_RUN_SPAN_NAME)[0]
        assert root.parent is None
        assert root.context is not None
        assert root.context.trace_id != platform_root.context.trace_id
        _assert_parents_resolve_within(business_exporter)
        for span in platform_exporter.get_finished_spans():
            assert DIFY_TENANT_ID_ATTRIBUTE not in dict(span.attributes or {})
    finally:
        business_client.shutdown(timeout_millis=5000)
        platform_client.shutdown(timeout_millis=5000)
