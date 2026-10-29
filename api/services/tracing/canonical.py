"""Build provider-neutral traces from assembled records.

Identity is derived, never coordinated. A trace is named by the caller's trace
ID, else by its root record: the message for chats and chatflows, the workflow
run for workflow apps. Each span is named by the Dify record it represents.
Auxiliary operations (tool calls, retrieval, moderation, suggested questions,
conversation naming) join their message's trace as separate units under its
root span; a workflow run nested in another one is its own trace, linked
through attributes.
"""

import math
from collections.abc import Mapping
from decimal import Decimal
from typing import Any

from dify_trace_sdk.events import json_safe
from dify_trace_sdk.ids import span_id_for, trace_id_for
from dify_trace_sdk.model import Cost, Span, SpanKind, SpanRef, SpanStatus, TokenUsage, Trace
from pydantic import JsonValue

from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowNodeExecutionStatus
from services.tracing.hierarchy import build_workflow_hierarchy, execution_metadata, finished_at
from services.tracing.records import (
    BaseTraceInfo,
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)

_NODE_KIND: dict[str, SpanKind] = {
    "llm": SpanKind.LLM,
    "knowledge-retrieval": SpanKind.RETRIEVER,
    "tool": SpanKind.TOOL,
    "agent": SpanKind.AGENT,
}
_RETRY_SUMMARY_FIELDS = ("retry_index", "error", "elapsed_time", "created_at", "finished_at")


def message_trace_id(external_trace_id: str | None, message_id: str) -> str:
    return trace_id_for(external_trace_id or message_id)


def _status(error: str | None, status: object) -> SpanStatus:
    failed = str(status) in {WorkflowNodeExecutionStatus.FAILED.value, WorkflowNodeExecutionStatus.EXCEPTION.value}
    return SpanStatus.ERROR if error or failed else SpanStatus.OK


def _cost(amount: Decimal | float | None, currency: str | None) -> Cost | None:
    if amount is None or not currency:
        return None
    value = float(amount)
    if not math.isfinite(value) or value < 0:
        return None
    return Cost(amount=value, currency=currency)


def _usage(prompt: object, completion: object, total: object) -> TokenUsage | None:
    def count(value: object) -> int | None:
        return int(value) if isinstance(value, int | float) and not isinstance(value, bool) and value >= 0 else None

    prompt_tokens, completion_tokens = count(prompt), count(completion)
    if prompt_tokens is None and completion_tokens is None:
        return None
    total_tokens = count(total)
    return TokenUsage(
        prompt_tokens=prompt_tokens or 0,
        completion_tokens=completion_tokens or 0,
        total_tokens=total_tokens if total_tokens is not None else (prompt_tokens or 0) + (completion_tokens or 0),
    )


def _attributes(metadata: Mapping[str, Any]) -> dict[str, JsonValue]:
    result = json_safe({key: value for key, value in metadata.items() if value is not None})
    return result if isinstance(result, dict) else {}


def _retry_metadata(process_data: Mapping[str, Any]) -> dict[str, Any]:
    raw_history = process_data.get(RETRY_HISTORY_PROCESS_DATA_KEY)
    if not isinstance(raw_history, list):
        return {}
    attempts: list[dict[str, Any]] = []
    for raw_attempt in raw_history:
        if not isinstance(raw_attempt, Mapping):
            continue
        retry_index = raw_attempt.get("retry_index")
        if isinstance(retry_index, bool) or not isinstance(retry_index, int) or retry_index <= 0:
            continue
        attempts.append({field: raw_attempt.get(field) for field in _RETRY_SUMMARY_FIELDS})
    return {"retry_count": len(attempts), "retry_attempts": attempts} if attempts else {}


def _session_id(record: BaseTraceInfo, fallback: str | None) -> str | None:
    explicit = record.metadata.get("trace_session_id")
    return explicit if isinstance(explicit, str) and explicit else fallback


def _user_id(record: BaseTraceInfo) -> str | None:
    """The caller's own end-user identifier when there is one, else Dify's user ID."""
    value = record.metadata.get("end_user_session_id") or record.metadata.get("user_id")
    return str(value) if value else None


def _seconds(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) and value >= 0 else None


class CanonicalTraceBuilder:
    """Convert records into canonical trace units; ``None`` means nothing to send."""

    def build(self, record: BaseTraceInfo) -> Trace | None:
        match record:
            case WorkflowTraceInfo():
                return self._workflow(record)
            case MessageTraceInfo():
                return self._message(record)
            case ModerationTraceInfo():
                return self._auxiliary(
                    record,
                    name="moderation",
                    kind=SpanKind.TOOL,
                    inputs=record.inputs,
                    outputs={"action": record.action, "flagged": record.flagged},
                    error=None,
                )
            case SuggestedQuestionTraceInfo():
                return self._auxiliary(
                    record,
                    name="suggested_question",
                    kind=SpanKind.TOOL,
                    inputs=record.inputs,
                    outputs=record.suggested_question,
                    error=record.error,
                )
            case DatasetRetrievalTraceInfo():
                return self._auxiliary(
                    record,
                    name="dataset_retrieval",
                    kind=SpanKind.RETRIEVER,
                    inputs=record.inputs,
                    outputs={"documents": record.documents},
                    error=record.error,
                )
            case ToolTraceInfo():
                return self._auxiliary(
                    record,
                    name=record.tool_name,
                    kind=SpanKind.TOOL,
                    inputs=record.tool_inputs,
                    outputs=record.tool_outputs,
                    error=record.error or None,
                )
            case GenerateNameTraceInfo():
                return self._auxiliary(
                    record,
                    name="generate_name",
                    kind=SpanKind.TOOL,
                    inputs=record.inputs,
                    outputs=record.outputs,
                    error=None,
                )
            case _:
                return None

    def _message(self, record: MessageTraceInfo) -> Trace:
        message = record.message_data
        root_span_id = span_id_for(message.id)
        started_at = record.start_time or message.created_at
        ended_at = max(record.end_time or started_at, started_at)
        error = record.error or message.error or None
        status = _status(error, None)
        attributes = _attributes({**record.metadata, "trace_entity_type": "message"})
        return Trace(
            trace_id=message_trace_id(record.trace_id, message.id),
            external_trace_id=record.trace_id,
            session_id=_session_id(record, message.conversation_id),
            user_id=_user_id(record),
            parent=None,
            spans=(
                Span(
                    span_id=root_span_id,
                    parent_span_id=None,
                    name="message",
                    kind=SpanKind.CHAIN,
                    start_time=started_at,
                    end_time=ended_at,
                    status=status,
                    error=error,
                    inputs=json_safe(record.inputs),
                    outputs=json_safe(message.answer),
                    attributes=attributes,
                ),
                Span(
                    span_id=span_id_for(f"{message.id}:llm"),
                    parent_span_id=root_span_id,
                    name="llm",
                    kind=SpanKind.LLM,
                    start_time=started_at,
                    end_time=ended_at,
                    status=status,
                    error=error,
                    inputs=json_safe(record.inputs),
                    outputs=json_safe(record.outputs if record.outputs is not None else message.answer),
                    model_name=message.model_id,
                    model_provider=message.model_provider,
                    usage=_usage(record.message_tokens, record.answer_tokens, record.total_tokens),
                    cost=_cost(message.total_price, message.currency),
                    time_to_first_token=_seconds(record.gen_ai_server_time_to_first_token),
                    attributes=attributes,
                ),
            ),
        )

    def _workflow(self, record: WorkflowTraceInfo) -> Trace:
        executions = record.node_executions
        hierarchy = build_workflow_hierarchy(executions, record.workflow_tool_parents)
        workflow_start = record.start_time
        workflow_end = max(record.end_time, workflow_start)
        workflow_span_id = span_id_for(record.workflow_run_id)
        workflow_status = _status(record.error, record.workflow_run_status)
        spans: list[Span] = []
        span_id_by_execution: dict[str, str] = {}

        if record.message_id:
            # A chatflow run is shown under its message, which is the trace root.
            root_logical_id = record.message_id
            root_span_id = span_id_for(record.message_id)
            # Units attached to this message (tool calls, retrieval, ...) name its creation as the trace start.
            message_start = record.message_started_at or workflow_start
            spans.append(
                Span(
                    span_id=root_span_id,
                    parent_span_id=None,
                    name="message",
                    kind=SpanKind.CHAIN,
                    start_time=message_start,
                    end_time=max(record.end_time, message_start),
                    status=workflow_status,
                    error=record.error or None,
                    inputs=json_safe(record.query or dict(record.workflow_run_inputs)),
                    outputs=json_safe(dict(record.workflow_run_outputs)),
                    attributes=_attributes({**record.metadata, "trace_entity_type": "message"}),
                )
            )
            workflow_parent: str | None = root_span_id
        else:
            root_logical_id = record.workflow_run_id
            workflow_parent = None

        spans.append(
            Span(
                span_id=workflow_span_id,
                parent_span_id=workflow_parent,
                name="workflow",
                kind=SpanKind.CHAIN,
                start_time=workflow_start,
                end_time=workflow_end,
                status=workflow_status,
                error=record.error or None,
                inputs=json_safe(dict(record.workflow_run_inputs)),
                outputs=json_safe(dict(record.workflow_run_outputs)),
                attributes=_attributes(
                    {
                        **record.metadata,
                        "workflow_id": record.workflow_id,
                        "workflow_run_id": record.workflow_run_id,
                        "workflow_app_log_id": record.workflow_app_log_id,
                        "total_tokens": record.total_tokens,
                    }
                ),
            )
        )

        for execution in executions:
            span_id_by_execution[execution.id] = span_id_for(execution.id)
        for wrapper in hierarchy.wrappers:
            span_id_by_execution[wrapper.id] = span_id_for(wrapper.id)

        unordered: dict[str, Span] = {}
        for wrapper in hierarchy.wrappers:
            unordered[wrapper.id] = Span(
                span_id=span_id_by_execution[wrapper.id],
                parent_span_id=span_id_by_execution.get(wrapper.parent_execution_id, workflow_span_id),
                name=f"{wrapper.key.kind}[{wrapper.key.index}]",
                kind=SpanKind.CHAIN,
                start_time=wrapper.start_time,
                end_time=max(wrapper.end_time, wrapper.start_time),
                status=SpanStatus.ERROR if wrapper.has_error else SpanStatus.OK,
                error="wrapper child failed" if wrapper.has_error else None,
                attributes={
                    "wrapper_type": wrapper.key.kind,
                    "wrapper_index": wrapper.key.index,
                    "container_execution_id": wrapper.parent_execution_id,
                },
            )
        for execution in executions:
            parent_logical = hierarchy.parent_by_execution_id.get(execution.id)
            unordered[execution.id] = self._node_span(
                execution,
                parent_span_id=span_id_by_execution.get(parent_logical, workflow_span_id)
                if parent_logical
                else workflow_span_id,
            )

        spans.extend(self._parent_first(unordered, {span.span_id for span in spans}))
        parent_run_id, parent_node_id = record.resolved_parent_context
        if parent_run_id:
            spans[0] = spans[0].model_copy(
                update={
                    "attributes": {
                        **spans[0].attributes,
                        "parent_workflow_run_id": parent_run_id,
                        "parent_node_execution_id": parent_node_id,
                    }
                }
            )
        return Trace(
            trace_id=trace_id_for(record.trace_id or root_logical_id),
            external_trace_id=record.trace_id,
            session_id=_session_id(record, record.conversation_id or parent_run_id or record.workflow_run_id),
            user_id=_user_id(record),
            parent=None,
            spans=tuple(spans),
        )

    @staticmethod
    def _node_span(execution: WorkflowNodeExecution, *, parent_span_id: str) -> Span:
        process_data = dict(execution.process_data or {})
        outputs = dict(execution.outputs or {})
        node_type = str(execution.node_type)
        metadata = execution_metadata(execution)
        usage_source = process_data.get("usage") or outputs.get("usage") or {}
        usage = (
            _usage(
                usage_source.get("prompt_tokens"),
                usage_source.get("completion_tokens"),
                usage_source.get("total_tokens"),
            )
            if isinstance(usage_source, Mapping)
            else None
        )
        kind = _NODE_KIND.get(node_type, SpanKind.CHAIN)
        time_to_first_token = usage_source.get("time_to_first_token") if isinstance(usage_source, Mapping) else None
        return Span(
            span_id=span_id_for(execution.id),
            parent_span_id=parent_span_id,
            name=f"{node_type}_{execution.title}" if execution.title else node_type,
            kind=kind,
            start_time=execution.created_at,
            end_time=max(finished_at(execution), execution.created_at),
            status=_status(execution.error, execution.status),
            error=execution.error or None,
            inputs=json_safe(process_data.get("prompts", []) if kind is SpanKind.LLM else dict(execution.inputs or {})),
            outputs=json_safe(outputs),
            model_name=process_data.get("model_name") if kind is SpanKind.LLM else None,
            model_provider=process_data.get("model_provider") if kind is SpanKind.LLM else None,
            usage=usage if kind is SpanKind.LLM else None,
            cost=_cost(metadata.get("total_price"), metadata.get("currency")) if kind is SpanKind.LLM else None,
            time_to_first_token=_seconds(time_to_first_token) if kind is SpanKind.LLM else None,
            attributes=_attributes(
                {
                    **metadata,
                    "node_id": execution.node_id,
                    "node_execution_id": execution.id,
                    "node_type": node_type,
                    "status": str(execution.status),
                    **_retry_metadata(process_data),
                }
            ),
        )

    @staticmethod
    def _parent_first(spans: Mapping[str, Span], emitted_ids: set[str]) -> list[Span]:
        ordered: list[Span] = []
        pending = sorted(spans.values(), key=lambda span: (span.start_time, span.span_id))
        while pending:
            ready = [span for span in pending if span.parent_span_id in emitted_ids]
            if not ready:
                # The hierarchy only names existing executions or wrappers as parents.
                raise ValueError("workflow span hierarchy is not a tree")
            for span in ready:
                ordered.append(span)
                emitted_ids.add(span.span_id)
            pending = [span for span in pending if span.span_id not in emitted_ids]
        return ordered

    def _auxiliary(
        self,
        record: BaseTraceInfo,
        *,
        name: str,
        kind: SpanKind,
        inputs: object,
        outputs: object,
        error: str | None,
    ) -> Trace | None:
        message = record.message_data
        operation_id = record.metadata.get("trace_event_id")
        if not isinstance(operation_id, str):
            return None
        started_at = record.start_time or (message.created_at if message is not None else None)
        if started_at is None:
            return None
        ended_at = max(record.end_time or started_at, started_at)
        span_id = span_id_for(f"event:{operation_id}")
        if message is None:
            trace_id = trace_id_for(record.trace_id or f"event:{operation_id}")
            parent = None
            parent_span_id = None
        else:
            trace_id = message_trace_id(record.trace_id, message.id)
            parent = SpanRef(span_id=span_id_for(message.id), start_time=message.created_at)
            parent_span_id = parent.span_id
        return Trace(
            trace_id=trace_id,
            external_trace_id=record.trace_id,
            session_id=_session_id(record, message.conversation_id if message is not None else None),
            user_id=_user_id(record),
            parent=parent,
            spans=(
                Span(
                    span_id=span_id,
                    parent_span_id=parent_span_id,
                    name=name or kind.value,
                    kind=kind,
                    start_time=started_at,
                    end_time=ended_at,
                    status=SpanStatus.ERROR if error else SpanStatus.OK,
                    error=error,
                    inputs=json_safe(inputs),
                    outputs=json_safe(outputs),
                    attributes=_attributes(record.metadata),
                ),
            ),
        )
