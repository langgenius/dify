"""SQL comment scope through real Celery requests and OTel task instrumentation."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Event
from typing import Protocol, cast
from uuid import uuid4

import pytest
from celery import Celery, Task
from celery.app.task import Context
from celery.result import EagerResult
from celery.signals import task_postrun, task_prerun
from opentelemetry import context, trace
from opentelemetry.instrumentation.celery import CeleryInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.sampling import ALWAYS_OFF, ALWAYS_ON

from core.app.apps.exc import GenerateTaskStoppedError
from extensions.otel.celery_sqlcommenter import (
    _SQLCOMMENTER_CONTEXT_KEY,
    _TOKEN_ATTR,
    CelerySqlcommenterTagsDict,
    _build_celery_sqlcommenter_tags,
    _on_task_postrun,
    _on_task_prerun,
    setup_celery_sqlcommenter,
)


class _DisconnectableSignal(Protocol):
    """Celery's signal stubs omit the public disconnect method."""

    def disconnect(self, receiver: Callable[..., None]) -> bool: ...


@dataclass(frozen=True)
class _Invocation:
    task_object: int
    request: Context
    span_context: trace.SpanContext
    tags: CelerySqlcommenterTagsDict


@pytest.fixture
def celery_task() -> Iterator[Task[..., object]]:
    app = Celery("sqlcommenter-unit-test", broker="memory://", set_as_current=False)

    @app.task(name=f"sqlcommenter.{uuid4()}")
    def unused() -> None:
        pass

    task = app.tasks[unused.name]
    task.push_request(id=str(uuid4()), retries=0, delivery_info={})
    try:
        yield task
    finally:
        task.pop_request()
        app.close()


def test_build_tags_includes_celery_framework_and_task_name(celery_task: Task[..., object]) -> None:
    tags = _build_celery_sqlcommenter_tags(celery_task)

    assert tags["framework"].startswith("celery:")
    assert tags["task_name"] == celery_task.name


@pytest.mark.parametrize("retries", [0, 3])
def test_build_tags_includes_only_nonzero_retries(celery_task: Task[..., object], retries: int) -> None:
    celery_task.request.retries = retries

    tags = _build_celery_sqlcommenter_tags(celery_task)

    if retries:
        assert tags["celery_retries"] == retries
    else:
        assert "celery_retries" not in tags


def test_build_tags_includes_request_routing_key(celery_task: Task[..., object]) -> None:
    celery_task.request.delivery_info = {"routing_key": "workflow_based_app_execution"}

    assert _build_celery_sqlcommenter_tags(celery_task)["routing_key"] == "workflow_based_app_execution"


def test_build_tags_includes_current_traceparent(celery_task: Task[..., object]) -> None:
    span_context = trace.SpanContext(trace_id=0x123, span_id=0x456, is_remote=True, trace_flags=trace.TraceFlags(1))
    span = trace.NonRecordingSpan(span_context)

    with trace.use_span(span):
        tags = _build_celery_sqlcommenter_tags(celery_task)

    assert tags["traceparent"] == f"00-{span_context.trace_id:032x}-{span_context.span_id:016x}-01"


def test_handlers_restore_context_and_remove_request_token(celery_task: Task[..., object]) -> None:
    previous_context = context.get_current()

    _on_task_prerun(task=celery_task)
    assert hasattr(celery_task.request, _TOKEN_ATTR)
    assert not hasattr(celery_task, _TOKEN_ATTR)
    tags = context.get_value(_SQLCOMMENTER_CONTEXT_KEY)
    assert isinstance(tags, dict)
    assert tags["task_name"] == celery_task.name

    _on_task_postrun(task=celery_task)
    _on_task_postrun(task=celery_task)

    assert context.get_current() is previous_context
    assert not hasattr(celery_task.request, _TOKEN_ATTR)


def test_handlers_skip_missing_task_or_request_token(celery_task: Task[..., object]) -> None:
    previous_context = context.get_current()

    _on_task_prerun()
    _on_task_postrun()
    _on_task_postrun(task=celery_task)

    assert context.get_current() is previous_context


@pytest.mark.parametrize("sampled", [False, True])
@pytest.mark.parametrize("outcome", ["success", "failure", "retry", "cancel"])
@pytest.mark.parametrize("finish_order", [(0, 1), (1, 0)])
def test_overlapping_task_invocations_restore_otel_parent(
    sampled: bool,
    outcome: str,
    finish_order: tuple[int, int],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Real eager task tracing includes signals, exception and retry handling.

    Two threads execute the same registered Task singleton. Each Celery request
    has its own token and incoming parent. Cancellation models the Workflow's
    cooperative stop returning through Celery postrun, not killing a process.
    """
    provider = TracerProvider(sampler=ALWAYS_ON if sampled else ALWAYS_OFF)
    exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    meter_provider = MeterProvider()
    setup_celery_sqlcommenter(tracer_provider=provider, meter_provider=meter_provider)
    app = Celery("sqlcommenter-concurrency-test", broker="memory://", set_as_current=False)
    started = [Event(), Event()]
    release = [Event(), Event()]
    attempts: dict[int, list[_Invocation]] = {0: [], 1: []}
    restored: dict[int, bool] = {}
    parents: dict[int, trace.SpanContext] = {}
    name = f"sqlcommenter.concurrent.{uuid4()}"

    @app.task(bind=True, name=name, max_retries=1)
    def execute_task(task: Task[..., object], marker: int) -> dict[str, str]:
        span = trace.get_current_span()
        attempts[marker].append(
            _Invocation(
                task_object=id(task),
                request=task.request,
                span_context=span.get_span_context(),
                tags=cast(CelerySqlcommenterTagsDict, context.get_value(_SQLCOMMENTER_CONTEXT_KEY)),
            )
        )
        if task.request.retries == 0:
            started[marker].set()
            assert release[marker].wait(timeout=10), "concurrent invocation was never released"
        if outcome == "failure":
            raise ValueError(f"synthetic failure {marker}")
        if outcome == "retry" and task.request.retries == 0:
            raise task.retry(countdown=0)
        if outcome == "cancel":
            try:
                raise GenerateTaskStoppedError("synthetic cooperative stop")
            except GenerateTaskStoppedError:
                return {"status": "stopped"}
        return {"status": "succeeded"}

    task = app.tasks[name]

    def invoke(marker: int) -> EagerResult[object]:
        parent = provider.get_tracer(__name__).start_span(f"caller-{marker}")
        parents[marker] = parent.get_span_context()
        baseline = context.set_value(_SQLCOMMENTER_CONTEXT_KEY, {"caller": marker}, trace.set_span_in_context(parent))
        token = context.attach(baseline)
        try:
            result = task.apply(
                kwargs={"marker": marker}, task_id=str(uuid4()), throw=False, routing_key=f"route-{marker}"
            )
            restored[marker] = context.get_current() is baseline and trace.get_current_span() is parent
            assert context.get_value(_SQLCOMMENTER_CONTEXT_KEY) == {"caller": marker}
            return result
        finally:
            context.detach(token)
            parent.end()

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(invoke, 0)]
            try:
                assert started[0].wait(timeout=10)
                futures.append(executor.submit(invoke, 1))
                assert started[1].wait(timeout=10)
                for marker in finish_order:
                    release[marker].set()
                    result = futures[marker].result(timeout=10)
                    if outcome == "failure":
                        assert result.state == "FAILURE"
                        assert isinstance(result.result, ValueError)
                        assert str(result.result) == f"synthetic failure {marker}"
                    else:
                        assert result.state == "SUCCESS"
                        assert result.result == {"status": "stopped" if outcome == "cancel" else "succeeded"}
            finally:
                for event in release:
                    event.set()

        assert restored == {0: True, 1: True}
        assert not hasattr(task, _TOKEN_ATTR)
        assert parents[0].trace_id != parents[1].trace_id
        expected_attempts = 2 if outcome == "retry" else 1
        for marker, invocations in attempts.items():
            assert len(invocations) == expected_attempts
            for index, invocation in enumerate(invocations):
                span_context = invocation.span_context
                tags = invocation.tags
                assert invocation.task_object == id(task)
                assert not hasattr(invocation.request, _TOKEN_ATTR)
                assert span_context.trace_id == parents[marker].trace_id
                assert span_context.trace_flags.sampled is sampled
                assert tags["routing_key"] == f"route-{marker}"
                assert tags["traceparent"] == (
                    f"00-{span_context.trace_id:032x}-{span_context.span_id:016x}-{int(span_context.trace_flags):02x}"
                )
                if index:
                    assert tags["celery_retries"] == index
                else:
                    assert "celery_retries" not in tags
        task_spans = [
            span
            for span in exporter.get_finished_spans()
            if span.attributes is not None and span.attributes.get("celery.task_name") == name
        ]
        assert len(task_spans) == (2 * expected_attempts if sampled else 0)
        for span in task_spans:
            assert span.parent is not None
            assert span.context is not None
            parent = next(parent for parent in parents.values() if parent.trace_id == span.context.trace_id)
            assert span.parent.span_id == parent.span_id
        assert "Failed to detach context" not in caplog.text
    finally:
        cast(_DisconnectableSignal, task_prerun).disconnect(_on_task_prerun)
        cast(_DisconnectableSignal, task_postrun).disconnect(_on_task_postrun)
        CeleryInstrumentor().uninstrument()
        app.close()
        provider.shutdown()
        meter_provider.shutdown()


def test_external_instrumentation_keeps_its_provider_and_context(caplog: pytest.LogCaptureFixture) -> None:
    """An existing instrumentor has no public signal-ordering API to nest under."""
    external_provider = TracerProvider()
    external_exporter = InMemorySpanExporter()
    external_provider.add_span_processor(SimpleSpanProcessor(external_exporter))
    unused_provider = TracerProvider()
    unused_exporter = InMemorySpanExporter()
    unused_provider.add_span_processor(SimpleSpanProcessor(unused_exporter))
    meter_provider = MeterProvider()
    instrumentor = CeleryInstrumentor()
    instrumentor.instrument(tracer_provider=external_provider, meter_provider=meter_provider)
    setup_celery_sqlcommenter(tracer_provider=unused_provider, meter_provider=meter_provider)
    app = Celery("sqlcommenter-external-instrumentation", broker="memory://", set_as_current=False)
    baseline_tags = {"outer": "external-owner"}

    @app.task(name=f"sqlcommenter.external.{uuid4()}")
    def execute_task() -> None:
        assert context.get_value(_SQLCOMMENTER_CONTEXT_KEY) == baseline_tags
        assert not hasattr(app.tasks[execute_task.name].request, _TOKEN_ATTR)

    parent = external_provider.get_tracer(__name__).start_span("external-parent")
    baseline = context.set_value(_SQLCOMMENTER_CONTEXT_KEY, baseline_tags, trace.set_span_in_context(parent))
    token = context.attach(baseline)
    try:
        result = execute_task.apply(throw=True)

        assert result.state == "SUCCESS"
        assert context.get_current() is baseline
        assert trace.get_current_span() is parent
        spans = external_exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].parent is not None
        assert spans[0].parent.span_id == parent.get_span_context().span_id
        assert not unused_exporter.get_finished_spans()
        assert "skipping SQL commenter signal registration" in caplog.text
        assert "Failed to detach context" not in caplog.text
    finally:
        context.detach(token)
        parent.end()
        instrumentor.uninstrument()
        app.close()
        external_provider.shutdown()
        unused_provider.shutdown()
        meter_provider.shutdown()
