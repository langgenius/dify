"""Collect one workflow's normalized engine events, including container descendants.

The recorder belongs to one logical run. Its lock protects short in-memory
updates only; queue submission and checkpoint storage happen outside that lock.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from threading import Lock
from typing import Any, override

from pydantic import BaseModel, Field

from core.ops.trace_data import (
    CompletedTrace,
    TraceProviderSettings,
    TraceSource,
    TraceSpan,
    copy_trace_value,
    make_span_id,
    make_trace_id,
)
from graphon.engine.layer import Layer
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.nodes.base.node import Node


class ChildWorkflowTrace(BaseModel):
    source: TraceSource
    workflow_id: str
    workflow_version: str
    root_span_id: str
    provider_settings: list[TraceProviderSettings]
    node_span_ids: list[str] = Field(default_factory=list)
    submitted: bool = False


class WorkflowTraceState(BaseModel):
    """Checkpointed values only: no engine, locks, callbacks, or credentials."""

    version: int = 1
    source: TraceSource
    provider_settings: list[TraceProviderSettings] = Field(default_factory=list)
    workflow_id: str
    workflow_version: str
    spans: list[TraceSpan]
    execution_span_ids: dict[str, str] = Field(default_factory=dict)
    attempts: dict[str, int] = Field(default_factory=dict)
    open_span_ids: list[str] = Field(default_factory=list)
    incomplete_reasons: list[str] = Field(default_factory=list)
    omitted_spans: int = 0
    child_workflows: dict[str, ChildWorkflowTrace] = Field(default_factory=dict)
    captured_bytes: int = 0
    ownership_rejected: bool = False


class WorkflowTraceRecorder(Layer):
    def __init__(
        self,
        *,
        source: TraceSource,
        workflow_id: str,
        workflow_version: str,
        inputs: Mapping[str, Any],
        submit_completed_trace: Callable[..., bool],
        load_provider_settings: Callable[[str, str], Sequence[TraceProviderSettings]] | None = None,
        provider_settings: Sequence[TraceProviderSettings] = (),
        pause_state: Mapping[str, Any] | None = None,
        resumed_without_state: bool = False,
        max_spans: int = 10_000,
        reserve_recording_bytes: Callable[[str, int], bool] | None = None,
        release_recording_bytes: Callable[[str, int], None] | None = None,
    ) -> None:
        super().__init__()
        self.source = source.model_copy(deep=True)
        self.workflow_id = workflow_id
        self.workflow_version = workflow_version
        self.provider_settings = tuple(settings.model_copy(deep=True) for settings in provider_settings)
        self._validate_provider_settings(self.provider_settings)
        self._submit_completed_trace = submit_completed_trace
        self._load_provider_settings = load_provider_settings
        self._child_workflows: dict[str, ChildWorkflowTrace] = {}
        self._pending_child_traces: list[tuple[CompletedTrace, list[TraceProviderSettings]]] = []
        self._lock = Lock()
        self._closed = False
        self._paused = False
        self._ownership_rejected = False
        self._max_spans = max_spans
        self._reserve_bytes = reserve_recording_bytes
        self._release_bytes = release_recording_bytes
        self._reserved_bytes = 0
        self._omitted_spans = 0
        self._captured_bytes = 0
        self._incomplete_reasons: list[str] = []
        self._execution_span_ids: dict[str, str] = {}
        self._attempts: dict[str, int] = {}
        self._trace_id = make_trace_id(source.tenant_id, source.operation_id)
        self._root_span_id = self._span_id("root")
        self._spans: dict[str, TraceSpan] = {}
        self._open_span_ids = {self._root_span_id}
        if pause_state is not None:
            self._restore_pause_state(pause_state)
            if not self._reserve_recording_budget(self._captured_bytes + 1024 * len(self._spans)):
                self._ownership_rejected = True
        else:
            self._reserve_recording_budget(4096)
            self._spans[self._root_span_id] = TraceSpan(
                span_id=self._root_span_id,
                span_name="Workflow",
                span_type="workflow",
                source_app_id=source.app_id,
                source_pipeline_id=source.pipeline_id,
                source_workflow_id=workflow_id,
                source_workflow_version=workflow_version,
                started_at=datetime.now(UTC),
                status="incomplete",
                inputs=self._copy_value(inputs),
            )
            if resumed_without_state:
                self._incomplete_reasons.append("pre_upgrade_checkpoint")

    def _validate_provider_settings(self, provider_settings: Sequence[TraceProviderSettings]) -> None:
        if any(
            settings.tenant_id != self.source.tenant_id
            or (settings.destination_type == "app_provider" and settings.app_id != self.source.app_id)
            for settings in provider_settings
        ):
            raise ValueError("Workflow trace destination owner mismatch")

    def _span_id(self, identity: str) -> str:
        return make_span_id(self.source.tenant_id, self.source.operation_id, identity)

    @override
    @contextmanager
    def node_run_context(self, node: Node, *, parent_execution_id: str | None = None) -> Generator[None, None, None]:
        # Local import avoids the app entity -> recorder -> runtime import cycle.
        from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext

        execution_id = node.execution_id
        raw_run_context = node.run_context.get(DIFY_RUN_CONTEXT_KEY)
        run_context = (
            raw_run_context
            if isinstance(raw_run_context, DifyRunContext)
            else DifyRunContext.model_validate(raw_run_context)
        )
        with self._lock:
            if not self._closed:
                if run_context.tenant_id != str(self.source.tenant_id) or (
                    run_context.app_id not in (self.source.app_id, self.source.pipeline_id)
                    and not any(
                        child.source.app_id == run_context.app_id and child.workflow_id == node.workflow_id
                        for child in self._child_workflows.values()
                    )
                ):
                    self._ownership_rejected = True
                elif execution_id and execution_id not in self._execution_span_ids:
                    parent_span_id = (
                        self._execution_span_ids.get(parent_execution_id) if parent_execution_id else self._root_span_id
                    )
                    if parent_span_id is None:
                        self._mark_incomplete("missing_execution_parent")
                    elif len(self._spans) >= self._max_spans or not self._reserve_recording_budget(1024):
                        self._omitted_spans += 1
                        self._mark_incomplete("span_limit")
                    else:
                        span_id = self._span_id(execution_id)
                        self._execution_span_ids[execution_id] = span_id
                        self._attempts[execution_id] = 0
                        self._open_span_ids.add(span_id)
                        self._spans[span_id] = TraceSpan(
                            span_id=span_id,
                            parent_span_id=parent_span_id,
                            source_app_id=None if run_context.app_id == self.source.pipeline_id else run_context.app_id,
                            source_pipeline_id=self.source.pipeline_id
                            if run_context.app_id == self.source.pipeline_id
                            else None,
                            source_workflow_id=node.workflow_id,
                            source_workflow_version=self.workflow_version
                            if node.workflow_id == self.workflow_id
                            else next(
                                (
                                    child.workflow_version
                                    for child in self._child_workflows.values()
                                    if child.workflow_id == node.workflow_id
                                ),
                                None,
                            ),
                            node_execution_id=execution_id,
                            node_id=node.id[:512],
                            span_name=node.title[:512],
                            span_type=self._node_span_type(str(node.node_type)),
                            status="incomplete",
                            attributes={"node_type": str(node.node_type), "node_version": node.version()},
                        )
                        child = self._child_workflows.get(run_context.workflow_tool_invocation_id or "")
                        if child is not None:
                            child.node_span_ids.append(span_id)
        yield

    def register_workflow_source(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        workflow_version: str,
        invocation_id: str,
        parent_execution_id: str,
    ) -> None:
        """Resolve a child's independent destination at its authorized invocation boundary."""
        if tenant_id != self.source.tenant_id:
            with self._lock:
                self._ownership_rejected = True
            return
        with self._lock:
            if self._closed or invocation_id in self._child_workflows:
                return
        try:
            settings = self._load_provider_settings(tenant_id, app_id) if self._load_provider_settings else ()
        except Exception:
            logging.getLogger(__name__).warning(
                "Cannot read child workflow trace settings: tenant_id=%s app_id=%s", tenant_id, app_id
            )
            settings = ()
        if any(setting.tenant_id != tenant_id or setting.app_id not in (app_id, None) for setting in settings):
            raise ValueError("Child workflow tracing destination owner mismatch")
        with self._lock:
            if not self._closed:
                self._child_workflows[invocation_id] = ChildWorkflowTrace(
                    source=TraceSource(
                        tenant_id=tenant_id,
                        app_id=app_id,
                        operation_id=self._span_id(f"child:{invocation_id}"),
                        actor_id=self.source.actor_id,
                        session_id=self.source.session_id,
                    ),
                    workflow_id=workflow_id,
                    workflow_version=workflow_version,
                    root_span_id=self._execution_span_ids.get(parent_execution_id, ""),
                    provider_settings=list(settings),
                )

    def record_workflow_event(self, event: EngineEvent) -> None:
        """Copy normalized events before Dify's persistence and response mutation."""
        try:
            with self._lock:
                self._record_workflow_event(event)
                pending = self._pending_child_traces
                self._pending_child_traces = []
            for trace, settings in pending:
                self._submit_completed_trace(trace, settings)
        except Exception:
            with self._lock:
                self._mark_incomplete("capture_error")
            logging.getLogger(__name__).warning(
                "Cannot record workflow trace event: tenant_id=%s workflow_id=%s",
                self.source.tenant_id,
                self.workflow_id,
            )

    def _record_workflow_event(self, event: EngineEvent) -> None:
        if self._closed or self._ownership_rejected:
            return
        if isinstance(event, NodeEvent):
            self._record_node_event(event)
            return
        root = self._spans[self._root_span_id]
        if isinstance(event, GraphRunStartedEvent):
            self._paused = False
            return
        if isinstance(event, GraphRunPausedEvent):
            self._paused = True
            self._spans[root.span_id] = root.model_copy(
                update={"events": (*root.events[-63:], {"name": "pause", "observed_at": datetime.now(UTC).isoformat()})}
            )
            return
        match event:
            case GraphRunSucceededEvent():
                status, error = "ok", None
            case GraphRunPartialSucceededEvent():
                status, error = "handled_error", None
            case GraphRunAbortedEvent():
                status, error = "cancelled", event.reason
            case GraphRunFailedEvent():
                status, error = "error", event.error
            case _:
                return
        self._paused = False
        self._open_span_ids.discard(root.span_id)
        self._spans[root.span_id] = root.model_copy(
            update={
                "status": status,
                "error": self._copy_value(error),
                "ended_at": datetime.now(UTC),
                "outputs": self._copy_value(getattr(event, "outputs", {})),
            }
        )

    @override
    def on_event(self, event: EngineEvent) -> None:
        """Observe public events; hidden callbacks call the same reduction method."""
        self.record_workflow_event(event)

    def _record_node_event(self, event: NodeEvent) -> None:
        span_id = self._execution_span_ids.get(event.id)
        if span_id is None:
            self._mark_incomplete("missing_execution_identity")
            return
        span = self._spans[span_id]
        if isinstance(event, NodeRunRetryEvent):
            attempt = self._attempts[event.id]
            attempt_span_id = self._span_id(f"{event.id}:attempt:{attempt}")
            if len(self._spans) < self._max_spans and self._reserve_recording_budget(1024):
                self._spans[attempt_span_id] = span.model_copy(
                    update={
                        "span_id": attempt_span_id,
                        "parent_span_id": span_id,
                        "attempt": attempt,
                        "span_name": f"{span.span_name} attempt {attempt + 1}",
                        "status": "error",
                        "error": self._copy_value(event.error),
                        "started_at": self._utc(event.start_at),
                        "ended_at": None,
                        "inputs": self._copy_value(event.node_run_result.inputs),
                        "outputs": self._copy_value(event.node_run_result.outputs),
                        "usage": self._usage(event.node_run_result.llm_usage),
                        "attributes": {**span.attributes, "metrics_from_parent": True},
                        "events": (),
                    }
                )
            else:
                self._omitted_spans += 1
                self._mark_incomplete("span_limit")
            failed_attempt = self._spans.get(attempt_span_id)
            for child in self._child_workflows.values():
                if child.root_span_id == span_id and not child.submitted:
                    self._finish_child_trace(child, root_span=failed_attempt)
            self._attempts[event.id] = event.retry_index
            return
        if isinstance(event, NodeRunStartedEvent):
            self._spans[span_id] = span.model_copy(
                update={
                    "started_at": self._utc(event.start_at),
                    "inputs": self._copy_value(event.node_run_result.inputs),
                }
            )
            return
        if not isinstance(event, (NodeRunSucceededEvent, NodeRunExceptionEvent, NodeRunFailedEvent)):
            return
        status = (
            "ok"
            if isinstance(event, NodeRunSucceededEvent)
            else "handled_error"
            if isinstance(event, NodeRunExceptionEvent)
            else "error"
        )
        self._open_span_ids.discard(span_id)
        is_container = str(event.node_type) in ("iteration", "loop", "agent") or any(
            child.root_span_id == span_id for child in self._child_workflows.values()
        )
        self._spans[span_id] = span.model_copy(
            update={
                "started_at": span.started_at or self._utc(event.start_at),
                "ended_at": self._utc(event.finished_at),
                "status": status,
                "error": self._copy_value(getattr(event, "error", None)),
                "attempt": self._attempts[event.id],
                "inputs": self._copy_value(event.node_run_result.inputs),
                "outputs": self._copy_value(event.node_run_result.outputs),
                "attributes": {
                    **span.attributes,
                    "metadata": self._copy_value(event.node_run_result.metadata),
                    "process_data": self._copy_value(event.node_run_result.process_data),
                    **({"aggregate_usage": self._usage(event.node_run_result.llm_usage)} if is_container else {}),
                },
                "usage": {} if is_container else self._usage(event.node_run_result.llm_usage),
            }
        )
        child_root = self._spans[span_id]
        if self._attempts[event.id] > 0 and len(self._spans) < self._max_spans:
            final_attempt = self._spans[span_id].model_copy(
                update={
                    "span_id": self._span_id(f"{event.id}:attempt:{self._attempts[event.id]}"),
                    "parent_span_id": span_id,
                    "span_name": f"{span.span_name} attempt {self._attempts[event.id] + 1}",
                    "started_at": self._utc(event.start_at),
                    "attributes": {**self._spans[span_id].attributes, "metrics_from_parent": True},
                }
            )
            if self._reserve_recording_budget(1024):
                self._spans[final_attempt.span_id] = final_attempt
                child_root = final_attempt
                self._spans[span_id] = self._spans[span_id].model_copy(
                    update={
                        "span_type": "node",
                        "inputs": None,
                        "outputs": None,
                        "usage": {},
                        "attributes": {
                            **self._spans[span_id].attributes,
                            "node_type": str(event.node_type),
                            "attempt_count": self._attempts[event.id] + 1,
                            "aggregate_usage": self._usage(event.node_run_result.llm_usage),
                        },
                    }
                )
        if str(event.node_type) == "agent":
            self._record_agent_results(self._spans[span_id], event.node_run_result.outputs)
        for child in self._child_workflows.values():
            if child.root_span_id == span_id and not child.submitted:
                self._finish_child_trace(child, root_span=child_root)

    def finish_workflow_trace(self, error: str | None = None) -> bool:
        """Seal after engine closure, then submit outside the recorder lock."""
        with self._lock:
            if self._closed:
                return False
            self._closed = True
            self._release_recording_budget()
            if self._paused and error is None:
                return False
            if self._ownership_rejected:
                return False
            root = self._spans[self._root_span_id]
            if error is not None or root.span_id in self._open_span_ids:
                self._mark_incomplete("host_execution_failed" if error else "engine_closed_without_outcome")
                root = root.model_copy(
                    update={
                        "status": "error" if error else "incomplete",
                        "error": copy_trace_value(error),
                        "ended_at": datetime.now(UTC),
                    }
                )
            if self._runtime_state is not None:
                root = root.model_copy(update={"usage": self._usage(self.runtime_state.llm_usage)})
            self._spans[root.span_id] = root
            self._open_span_ids.discard(root.span_id)
            for span_id, span in self._spans.items():
                if span_id in self._open_span_ids:
                    self._mark_incomplete("unfinished_execution")
                    self._spans[span_id] = span.model_copy(
                        update={
                            "status": "cancelled" if root.status == "cancelled" else "incomplete",
                            "error": root.error,
                        }
                    )
            for child in self._child_workflows.values():
                if not child.submitted:
                    self._finish_child_trace(child)
            completed_trace = CompletedTrace(
                source=self.source,
                trace_id=self._trace_id,
                root_span_id=self._root_span_id,
                spans=tuple(self._parent_first_spans()),
                complete=not self._incomplete_reasons,
                truncation={"reasons": self._incomplete_reasons, "omitted_spans": self._omitted_spans},
            )
            pending = self._pending_child_traces
            self._pending_child_traces = []
        for trace, settings in pending:
            self._submit_completed_trace(trace, settings)
        return self._submit_completed_trace(completed_trace)

    def save_pause_state(self) -> dict[str, Any]:
        """Freeze this execution attempt before writing its owning pause checkpoint."""
        with self._lock:
            self._closed = True
            self._release_recording_budget()
            return WorkflowTraceState(
                source=self.source,
                provider_settings=list(self.provider_settings),
                workflow_id=self.workflow_id,
                workflow_version=self.workflow_version,
                spans=self._parent_first_spans(),
                execution_span_ids=self._execution_span_ids,
                attempts=self._attempts,
                open_span_ids=list(self._open_span_ids),
                incomplete_reasons=self._incomplete_reasons,
                omitted_spans=self._omitted_spans,
                child_workflows=self._child_workflows,
                captured_bytes=self._captured_bytes,
                ownership_rejected=self._ownership_rejected,
            ).model_dump(mode="json")

    def _restore_pause_state(self, pause_state: Mapping[str, Any]) -> None:
        state = WorkflowTraceState.model_validate(pause_state)
        if state.version != 1 or (
            state.source.tenant_id,
            state.source.app_id,
            state.source.pipeline_id,
            state.source.operation_id,
            state.source.workflow_run_id,
            state.workflow_id,
        ) != (
            self.source.tenant_id,
            self.source.app_id,
            self.source.pipeline_id,
            self.source.operation_id,
            self.source.workflow_run_id,
            self.workflow_id,
        ):
            raise ValueError("Workflow trace checkpoint owner mismatch")
        self.source = state.source.model_copy(deep=True)
        self.workflow_version = state.workflow_version
        self._validate_provider_settings(state.provider_settings)
        self.provider_settings = tuple(state.provider_settings)
        self._spans = {span.span_id: span for span in state.spans}
        if self._root_span_id not in self._spans or len(self._spans) != len(state.spans):
            raise ValueError("Invalid workflow trace checkpoint spans")
        self._execution_span_ids = state.execution_span_ids
        self._attempts = state.attempts
        self._open_span_ids = set(state.open_span_ids)
        self._incomplete_reasons = state.incomplete_reasons
        self._omitted_spans = state.omitted_spans
        self._child_workflows = state.child_workflows
        self._captured_bytes = state.captured_bytes
        self._ownership_rejected = state.ownership_rejected
        for child in self._child_workflows.values():
            if not set(child.node_span_ids) <= self._spans.keys():
                raise ValueError("Invalid child workflow trace checkpoint spans")
            if child.source.tenant_id != self.source.tenant_id or any(
                settings.tenant_id != self.source.tenant_id or settings.app_id not in (child.source.app_id, None)
                for settings in child.provider_settings
            ):
                raise ValueError("Child workflow trace checkpoint owner mismatch")
        allowed_apps = {self.source.app_id, *(child.source.app_id for child in self._child_workflows.values())}
        if any(
            span.source_app_id not in allowed_apps or span.source_pipeline_id not in (None, self.source.pipeline_id)
            for span in self._spans.values()
        ):
            raise ValueError("Workflow trace checkpoint span owner mismatch")
        if not self._open_span_ids <= self._spans.keys() or any(
            span_id not in self._spans for span_id in self._execution_span_ids.values()
        ):
            raise ValueError("Invalid workflow trace checkpoint execution identities")
        self._parent_first_spans()
        root = self._spans[self._root_span_id]
        self._spans[root.span_id] = root.model_copy(
            update={"events": (*root.events[-63:], {"name": "resume", "observed_at": datetime.now(UTC).isoformat()})}
        )

    def _parent_first_spans(self) -> list[TraceSpan]:
        children: dict[str | None, list[TraceSpan]] = {}
        for span in self._spans.values():
            children.setdefault(span.parent_span_id, []).append(span)
        ordered: list[TraceSpan] = []
        pending = [self._spans[self._root_span_id]]
        seen: set[str] = set()
        while pending:
            span = pending.pop()
            if span.span_id in seen:
                self._mark_incomplete("invalid_span_parent")
                continue
            seen.add(span.span_id)
            ordered.append(span)
            pending.extend(reversed(children.get(span.span_id, [])))
        if len(ordered) != len(self._spans):
            self._mark_incomplete("invalid_span_parent")
            self._omitted_spans += len(self._spans) - len(ordered)
            self._spans = {span.span_id: span for span in ordered}
            self._execution_span_ids = {
                execution_id: span_id for execution_id, span_id in self._execution_span_ids.items() if span_id in seen
            }
            self._open_span_ids.intersection_update(seen)
        return ordered

    def _finish_child_trace(self, child: ChildWorkflowTrace, *, root_span: TraceSpan | None = None) -> None:
        if not child.provider_settings or child.root_span_id not in self._spans:
            child.submitted = True
            return
        # ponytail: scan the bounded retained tree per child export; index descendants if this becomes costly.
        included = {child.root_span_id}
        child_node_span_ids = set(child.node_span_ids)
        spans: list[TraceSpan] = []
        for span in self._parent_first_spans():
            if span.span_id == child.root_span_id:
                span = root_span or span
                spans.append(
                    span.model_copy(
                        update={
                            "span_id": child.root_span_id,
                            "parent_span_id": None,
                            "span_type": "workflow",
                            "source_app_id": child.source.app_id,
                            "source_pipeline_id": None,
                            "source_workflow_id": child.workflow_id,
                            "source_workflow_version": child.workflow_version,
                            "usage": span.attributes.get("aggregate_usage", span.usage),
                            "attributes": {
                                key: value for key, value in span.attributes.items() if key != "metrics_from_parent"
                            },
                        }
                    )
                )
            elif span.parent_span_id in included and (
                span.parent_span_id != child.root_span_id or span.span_id in child_node_span_ids
            ):
                included.add(span.span_id)
                spans.append(span)
        complete = not self._incomplete_reasons and all(span.status != "incomplete" for span in spans)
        trace = CompletedTrace(
            source=child.source,
            trace_id=make_trace_id(child.source.tenant_id, child.source.operation_id),
            root_span_id=child.root_span_id,
            spans=tuple(spans),
            links=(self._trace_id,),
            complete=complete,
            truncation={} if complete else {"reasons": self._incomplete_reasons or ["unfinished_execution"]},
        )
        child.submitted = True
        self._pending_child_traces.append((trace, child.provider_settings))

    def _record_agent_results(self, parent_span: TraceSpan, outputs: Mapping[str, Any]) -> None:
        entries = outputs.get("json")
        if not isinstance(entries, list):
            return
        for entry in entries[: self._max_spans]:
            if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
                continue
            if len(self._spans) >= self._max_spans or not self._reserve_recording_budget(1024):
                self._omitted_spans += 1
                self._mark_incomplete("span_limit")
                return
            label = str(entry.get("label") or "Agent step")[:512]
            metadata = entry.get("metadata") if isinstance(entry.get("metadata"), dict) else {}
            entry_parent_id = entry.get("parent_id")
            span_id = self._span_id(f"{parent_span.node_execution_id}:agent:{entry['id']}")
            self._spans[span_id] = TraceSpan(
                span_id=span_id,
                parent_span_id=self._span_id(f"{parent_span.node_execution_id}:agent:{entry_parent_id}")
                if entry_parent_id
                else parent_span.span_id,
                source_app_id=parent_span.source_app_id,
                source_pipeline_id=parent_span.source_pipeline_id,
                source_workflow_id=parent_span.source_workflow_id,
                source_workflow_version=parent_span.source_workflow_version,
                span_name=label,
                span_type="tool" if label.startswith("CALL ") else "llm" if label.endswith(" Thought") else "agent",
                status="error" if entry.get("error") or entry.get("status") == "error" else "ok",
                error=self._copy_value(entry.get("error")),
                # Agent timestamps are monotonic. Keep the original values as
                # metadata instead of inventing wall-clock times.
                outputs=self._copy_value(entry.get("data")),
                attributes={**self._copy_value(metadata), "metrics_from_parent": True},
                usage=self._copy_value(
                    {
                        key: metadata[key]
                        for key in ("prompt_tokens", "completion_tokens", "total_tokens", "total_price", "currency")
                        if key in metadata
                    }
                ),
            )

    def _mark_incomplete(self, reason: str) -> None:
        if reason not in self._incomplete_reasons:
            self._incomplete_reasons.append(reason)

    def _copy_value(self, value: Any) -> Any:
        if self._captured_bytes >= 7 * 1024 * 1024:
            self._mark_incomplete("trace_size_limit")
            return "[trace size limit]"
        copied = copy_trace_value(value)
        serialized = json.dumps(copied, ensure_ascii=False)
        copied_bytes = len(serialized.encode())
        if not self._reserve_recording_budget(copied_bytes):
            self._mark_incomplete("recording_byte_limit")
            return "[recording byte limit]"
        self._captured_bytes += copied_bytes
        if "[truncated]" in serialized or "[trace " in serialized or '"_trace_truncated": true' in serialized:
            self._mark_incomplete("value_size_limit")
        return copied

    def _reserve_recording_budget(self, byte_count: int) -> bool:
        # Reserve 1 MiB for root fields and serialization overhead at the queue boundary.
        if self._reserved_bytes + byte_count > 7 * 1024 * 1024:
            self._mark_incomplete("trace_size_limit")
            return False
        if self._reserve_bytes is not None and not self._reserve_bytes(self.source.tenant_id, byte_count):
            return False
        self._reserved_bytes += byte_count
        return True

    def _release_recording_budget(self) -> None:
        if self._release_bytes is not None and self._reserved_bytes:
            self._release_bytes(self.source.tenant_id, self._reserved_bytes)
        self._reserved_bytes = 0

    @staticmethod
    def _usage(usage: LLMUsage | None) -> dict[str, Any]:
        return usage.model_dump(mode="json") if usage is not None else {}

    @staticmethod
    def _utc(timestamp: datetime | None) -> datetime | None:
        return timestamp.replace(tzinfo=UTC) if timestamp is not None and timestamp.tzinfo is None else timestamp

    @staticmethod
    def _node_span_type(node_type: str) -> str:
        return {"llm": "llm", "tool": "tool", "knowledge-retrieval": "retrieval", "agent": "agent"}.get(
            node_type, "node"
        )
