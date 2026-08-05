"""Build provider-neutral traces from core ops trace entities.

Workflow persistence is accessed through an injected loader. Provider adapters
therefore receive a complete parent-first tree and never query Dify models.
"""

from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy.orm import sessionmaker

from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY
from core.helper.trace_id_helper import ParentTraceContext
from core.ops.entities.trace_entity import (
    BaseTraceInfo,
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.unified_trace.agent_events import AgentRunTraceFragment
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from core.ops.unified_trace.hierarchy import (
    WorkflowExecutionLike,
    build_workflow_hierarchy,
    execution_id,
    execution_metadata,
)
from core.ops.unified_trace.human_wait import HumanWaitRecord
from core.repositories import DifyCoreRepositoryFactory
from extensions.ext_database import db
from models import Account
from models.workflow import WorkflowNodeExecutionTriggeredFrom

WorkflowExecutionLoader = Callable[[WorkflowTraceInfo], Sequence[WorkflowExecutionLike]]
ServiceAccountResolver = Callable[[str], Account]


class RepositoryWorkflowExecutionLoader:
    """Load one workflow's executions through the tenant-scoped core repository."""

    def __init__(self, get_service_account: ServiceAccountResolver) -> None:
        self._get_service_account = get_service_account

    def __call__(self, trace_info: WorkflowTraceInfo) -> Sequence[WorkflowExecutionLike]:
        app_id = trace_info.metadata.get("app_id")
        if not isinstance(app_id, str) or not app_id:
            raise ValueError("No app_id found in workflow trace metadata")
        repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=sessionmaker(bind=db.engine),
            tenant_id=trace_info.tenant_id,
            user=self._get_service_account(app_id),
            app_id=app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        return repository.get_by_workflow_execution(workflow_execution_id=trace_info.workflow_run_id)


_NODE_KIND: dict[str, CanonicalSpanKind] = {
    "llm": CanonicalSpanKind.LLM,
    "knowledge-retrieval": CanonicalSpanKind.RETRIEVER,
    "tool": CanonicalSpanKind.TOOL,
    "agent": CanonicalSpanKind.AGENT,
}
_RETRY_SUMMARY_FIELDS = ("retry_index", "error", "elapsed_time", "created_at", "finished_at")


def _read_attribute(value: object, name: str, default: Any = None) -> Any:
    """Read fields shared by persisted trace models and legacy trace objects."""
    return getattr(value, name, default)  # guard-ignore: no-new-getattr -- supports legacy trace objects


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


def resolve_session_id(trace_info: WorkflowTraceInfo | MessageTraceInfo) -> str:
    """Resolve an explicit trace session before stable Dify fallbacks."""
    custom_session_id = trace_info.metadata.get("trace_session_id")
    if isinstance(custom_session_id, str) and custom_session_id:
        return custom_session_id

    if isinstance(trace_info, WorkflowTraceInfo):
        if trace_info.conversation_id:
            return trace_info.conversation_id
        parent_workflow_run_id, _ = trace_info.resolved_parent_context
        return parent_workflow_run_id or trace_info.workflow_run_id

    if trace_info.message_data is None:
        return ""
    conversation_id = _read_attribute(trace_info.message_data, "conversation_id")
    return conversation_id if isinstance(conversation_id, str) else ""


def _status(error: str | None, status: Any = None) -> CanonicalSpanStatus:
    status_value = _read_attribute(status, "value", status)
    return CanonicalSpanStatus.ERROR if error or status_value in {"failed", "exception"} else CanonicalSpanStatus.OK


def _external_parent(trace_info: WorkflowTraceInfo) -> ParentTraceContext | None:
    value = trace_info.metadata.get("parent_trace_context")
    if isinstance(value, ParentTraceContext):
        return value
    if isinstance(value, Mapping):
        try:
            return ParentTraceContext.model_validate(value)
        except ValidationError:
            return None
    return None


def _started_at(value: datetime | None) -> datetime:
    return value or datetime.now()


def _human_waits(metadata: Mapping[str, Any]) -> list[HumanWaitRecord]:
    raw_waits = metadata.get("human_waits")
    if not isinstance(raw_waits, list):
        return []
    waits: list[HumanWaitRecord] = []
    for raw_wait in raw_waits:
        try:
            waits.append(HumanWaitRecord.model_validate(raw_wait))
        except ValidationError:
            continue
    return waits


def _agent_fragments_by_parent(metadata: Mapping[str, Any]) -> dict[str, list[AgentRunTraceFragment]]:
    raw_fragments = metadata.get("agent_fragments")
    if not isinstance(raw_fragments, Mapping):
        return {}
    fragments_by_parent: dict[str, list[AgentRunTraceFragment]] = {}
    for parent_id, raw_fragments_for_parent in raw_fragments.items():
        if not isinstance(parent_id, str) or not isinstance(raw_fragments_for_parent, list):
            continue
        fragments = _agent_fragments(raw_fragments_for_parent)
        if fragments:
            fragments_by_parent[parent_id] = fragments
    return fragments_by_parent


def _agent_fragments(raw_fragments: list[Any]) -> list[AgentRunTraceFragment]:
    fragments: list[AgentRunTraceFragment] = []
    for raw_fragment in raw_fragments:
        try:
            fragments.append(AgentRunTraceFragment.model_validate(raw_fragment))
        except ValidationError:
            continue
    return fragments


def _single_session_id(trace_info: BaseTraceInfo) -> str:
    value = trace_info.metadata.get("trace_session_id")
    return value if isinstance(value, str) else ""


class CanonicalTraceBuilder:
    """Convert supported ops trace entities into canonical parent-first trees."""

    def __init__(self, load_workflow_executions: WorkflowExecutionLoader) -> None:
        self._load_workflow_executions = load_workflow_executions

    def build(self, trace_info: BaseTraceInfo) -> CanonicalTrace | None:
        match trace_info:
            case WorkflowTraceInfo():
                return self._build_workflow(trace_info)
            case MessageTraceInfo():
                return self._build_message(trace_info)
            case ModerationTraceInfo():
                return self._build_moderation(trace_info)
            case SuggestedQuestionTraceInfo():
                return self._build_suggested_question(trace_info)
            case DatasetRetrievalTraceInfo():
                return self._build_dataset_retrieval(trace_info)
            case ToolTraceInfo():
                return self._build_tool(trace_info)
            case GenerateNameTraceInfo():
                return self._build_generate_name(trace_info)
            case _:
                return None

    def _build_workflow(self, trace_info: WorkflowTraceInfo) -> CanonicalTrace:
        executions = self._load_workflow_executions(trace_info)
        hierarchy = build_workflow_hierarchy(executions)
        workflow_data = trace_info.workflow_data
        workflow_start = _started_at(_read_attribute(workflow_data, "created_at") or trace_info.start_time)
        workflow_end = _read_attribute(workflow_data, "finished_at") or trace_info.end_time
        root_id = trace_info.message_id or trace_info.workflow_run_id
        spans: dict[str, CanonicalSpan] = {}

        if trace_info.message_id:
            spans[root_id] = CanonicalSpan(
                id=root_id,
                parent_id=None,
                name=f"chatflow_{trace_info.workflow_run_id}",
                kind=CanonicalSpanKind.CHAIN,
                start_time=_started_at(trace_info.start_time or workflow_start),
                end_time=trace_info.end_time or workflow_end,
                inputs=trace_info.query or dict(trace_info.workflow_run_inputs),
                outputs=dict(trace_info.workflow_run_outputs),
                status=_status(trace_info.error),
                error=trace_info.error or None,
                metadata={**trace_info.metadata, "trace_entity_type": "message"},
                publishes_parent_context=True,
            )
            workflow_parent_id: str | None = root_id
        else:
            workflow_parent_id = None

        workflow_id = trace_info.workflow_run_id
        spans[workflow_id] = CanonicalSpan(
            id=workflow_id,
            parent_id=workflow_parent_id,
            name=f"workflow_{workflow_id}",
            kind=CanonicalSpanKind.CHAIN,
            start_time=workflow_start,
            end_time=workflow_end,
            inputs=dict(trace_info.workflow_run_inputs),
            outputs=dict(trace_info.workflow_run_outputs),
            status=_status(trace_info.error, trace_info.workflow_run_status),
            error=trace_info.error or None,
            metadata={
                **trace_info.metadata,
                "workflow_id": trace_info.workflow_id,
                "workflow_run_id": workflow_id,
                "workflow_app_log_id": trace_info.workflow_app_log_id,
                "total_tokens": trace_info.total_tokens,
            },
        )

        execution_by_id = {execution_id(item): item for item in executions}
        agent_fragments_by_parent = _agent_fragments_by_parent(trace_info.metadata)
        for item_execution_id, item in execution_by_id.items():
            node_metadata = execution_metadata(item)
            raw_fragments = node_metadata.get("agent_fragments")
            if not isinstance(raw_fragments, list):
                agent_log = node_metadata.get("agent_log")
                raw_fragments = agent_log.get("agent_fragments") if isinstance(agent_log, Mapping) else None
            if not isinstance(raw_fragments, list):
                continue
            fragments = _agent_fragments(raw_fragments)
            if fragments:
                agent_fragments_by_parent[item_execution_id] = fragments

        for wrapper in hierarchy.wrappers:
            spans[wrapper.id] = CanonicalSpan(
                id=wrapper.id,
                parent_id=wrapper.parent_execution_id,
                name=f"{wrapper.key.kind}[{wrapper.key.index}]",
                kind=CanonicalSpanKind.CHAIN,
                start_time=wrapper.start_time,
                end_time=wrapper.end_time,
                status=CanonicalSpanStatus.ERROR if wrapper.has_error else CanonicalSpanStatus.OK,
                error="wrapper child failed" if wrapper.has_error else None,
                metadata={
                    "wrapper_type": wrapper.key.kind,
                    "wrapper_index": wrapper.key.index,
                    "container_execution_id": wrapper.parent_execution_id,
                },
                synthetic=True,
            )

        for item_execution_id, item in execution_by_id.items():
            process_data = _read_attribute(item, "process_data") or {}
            outputs = _read_attribute(item, "outputs") or {}
            node_type = str(_read_attribute(item, "node_type", ""))
            error = _read_attribute(item, "error")
            started_at = _started_at(_read_attribute(item, "created_at"))
            elapsed_time = _read_attribute(item, "elapsed_time") or 0
            metadata = dict(execution_metadata(item))
            metadata.update(
                {
                    "node_id": _read_attribute(item, "node_id", ""),
                    "node_execution_id": item_execution_id,
                    "node_type": node_type,
                    "status": _read_attribute(item, "status", ""),
                    "model_provider": process_data.get("model_provider"),
                    "model_name": process_data.get("model_name"),
                }
            )
            usage = process_data.get("usage") or (outputs.get("usage") if isinstance(outputs, Mapping) else None) or {}
            if isinstance(usage, Mapping):
                metadata.update(
                    {
                        "prompt_tokens": usage.get("prompt_tokens", 0),
                        "completion_tokens": usage.get("completion_tokens", 0),
                        "total_tokens": usage.get("total_tokens", 0),
                    }
                )
            metadata.update(_retry_metadata(process_data))
            title = _read_attribute(item, "title")
            name = f"{node_type}_{title}" if isinstance(title, str) and title else node_type
            spans[item_execution_id] = CanonicalSpan(
                id=item_execution_id,
                parent_id=hierarchy.parent_by_execution_id.get(item_execution_id, workflow_id),
                name=name,
                kind=_NODE_KIND.get(node_type, CanonicalSpanKind.CHAIN),
                start_time=started_at,
                end_time=started_at + timedelta(seconds=elapsed_time),
                inputs=process_data.get("prompts", []) if node_type == "llm" else _read_attribute(item, "inputs") or {},
                outputs=outputs,
                status=_status(error, _read_attribute(item, "status")),
                error=error,
                metadata=metadata,
                can_parent_workflow=node_type == "tool",
            )

        for wait in _human_waits(trace_info.metadata):
            owner_id = wait.wait_id if wait.owner_kind == "workflow_node" and wait.wait_id in spans else wait.owner_id
            if owner_id not in spans:
                candidates = [
                    span
                    for span in spans.values()
                    if span.metadata.get("node_id") == wait.owner_id and span.start_time is not None
                ]
                if candidates:
                    owner_id = min(
                        candidates,
                        key=lambda span: abs(span.start_time.timestamp() - wait.start_time.timestamp()),
                    ).id
            if owner_id not in spans:
                continue
            owner_span = spans[owner_id]
            owner_kind = "agent_node" if owner_span.kind is CanonicalSpanKind.AGENT else wait.owner_kind
            spans[f"human_wait:{wait.wait_id}"] = CanonicalSpan(
                id=f"human_wait:{wait.wait_id}",
                parent_id=owner_id,
                name="human_wait",
                kind=CanonicalSpanKind.HUMAN_WAIT,
                start_time=wait.start_time,
                end_time=wait.end_time,
                inputs=wait.input,
                outputs=wait.output,
                status=CanonicalSpanStatus.OK,
                metadata={
                    "wait_id": wait.wait_id,
                    "owner_kind": owner_kind,
                    "outcome": wait.outcome,
                    "tool_call_id": wait.tool_call_id,
                },
            )

        for parent_id, fragments in agent_fragments_by_parent.items():
            if parent_id not in spans:
                continue
            for fragment in fragments:
                spans[fragment.run_id] = CanonicalSpan(
                    id=fragment.run_id,
                    parent_id=parent_id,
                    name="agent_run",
                    kind=CanonicalSpanKind.AGENT,
                    start_time=fragment.start_time,
                    end_time=fragment.end_time,
                    outputs=fragment.output,
                    status=CanonicalSpanStatus.ERROR if fragment.error else CanonicalSpanStatus.OK,
                    error=fragment.error,
                    metadata={
                        "role": fragment.role,
                        "complete": fragment.complete,
                        "warning_codes": list(fragment.warning_codes),
                        "dropped_event_count": fragment.dropped_event_count,
                    },
                )
                for operation in fragment.operations:
                    spans[operation.id] = CanonicalSpan(
                        id=operation.id,
                        parent_id=fragment.run_id,
                        name=operation.name,
                        kind=CanonicalSpanKind.LLM if operation.kind == "llm" else CanonicalSpanKind.TOOL,
                        start_time=operation.start_time,
                        end_time=operation.end_time,
                        inputs=operation.inputs,
                        outputs=operation.outputs,
                        status=CanonicalSpanStatus.ERROR if operation.error else CanonicalSpanStatus.OK,
                        error=operation.error,
                        metadata=dict(operation.metadata),
                        publishes_parent_context=operation.metadata.get("provider_type") == "workflow",
                    )

        ordered: list[CanonicalSpan] = []
        emitted: set[str] = set()

        def emit(span_id: str) -> None:
            if span_id in emitted:
                return
            span = spans[span_id]
            if span.parent_id in spans:
                emit(span.parent_id)
            emitted.add(span_id)
            ordered.append(span)

        for span_id in sorted(spans):
            emit(span_id)

        return CanonicalTrace(
            trace_id=trace_info.resolved_trace_id or root_id,
            session_id=resolve_session_id(trace_info),
            root_span_id=root_id,
            spans=tuple(ordered),
            external_parent=_external_parent(trace_info),
        )

    def _single_trace(
        self,
        trace_info: BaseTraceInfo,
        *,
        name: str,
        kind: CanonicalSpanKind,
        inputs: Any,
        outputs: Any,
        error: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        parent_id: str | None = None,
        span_id: str | None = None,
        session_id: str | None = None,
        required_parent_context_id: str | None = None,
    ) -> CanonicalTrace:
        operation_id = span_id or trace_info.operation_id or str(uuid4())
        trace_id = trace_info.resolved_trace_id or parent_id or operation_id
        span = CanonicalSpan(
            id=operation_id,
            parent_id=parent_id,
            name=name,
            kind=kind,
            start_time=_started_at(start_time or trace_info.start_time),
            end_time=end_time or trace_info.end_time,
            inputs=inputs,
            outputs=outputs,
            status=_status(error),
            error=error,
            metadata=dict(trace_info.metadata),
        )
        return CanonicalTrace(
            trace_id=trace_id,
            session_id=session_id if session_id is not None else _single_session_id(trace_info),
            root_span_id=operation_id,
            spans=(span,),
            required_parent_context_id=required_parent_context_id,
        )

    def _build_message(self, trace_info: MessageTraceInfo) -> CanonicalTrace | None:
        message = trace_info.message_data
        if message is None:
            return None
        message_id = trace_info.message_id or str(_read_attribute(message, "id", "")) or str(uuid4())
        started_at = _started_at(trace_info.start_time or _read_attribute(message, "created_at"))
        ended_at = trace_info.end_time or _read_attribute(message, "updated_at")
        answer = _read_attribute(message, "answer", trace_info.outputs)
        message_error = trace_info.error or _read_attribute(message, "error")
        metadata = {
            **trace_info.metadata,
            "trace_entity_type": "message",
            "model_provider": _read_attribute(message, "model_provider"),
            "model_name": _read_attribute(message, "model_id"),
            "prompt_tokens": trace_info.message_tokens,
            "completion_tokens": trace_info.answer_tokens,
            "total_tokens": trace_info.total_tokens,
        }
        spans: list[CanonicalSpan] = [
            CanonicalSpan(
                id=message_id,
                parent_id=None,
                name="message",
                kind=CanonicalSpanKind.CHAIN,
                start_time=started_at,
                end_time=ended_at,
                inputs=trace_info.inputs,
                outputs=answer,
                status=_status(message_error),
                error=message_error,
                metadata=metadata,
                publishes_parent_context=True,
            ),
            CanonicalSpan(
                id=f"{message_id}:llm",
                parent_id=message_id,
                name="llm",
                kind=CanonicalSpanKind.LLM,
                start_time=started_at,
                end_time=ended_at,
                inputs=trace_info.inputs,
                outputs=trace_info.outputs if trace_info.outputs is not None else answer,
                status=_status(message_error),
                error=message_error,
                metadata=metadata,
                synthetic=True,
            ),
        ]
        for fragment in _agent_fragments(trace_info.metadata.get("agent_fragments", [])):
            spans.append(
                CanonicalSpan(
                    id=fragment.run_id,
                    parent_id=message_id,
                    name="agent_run",
                    kind=CanonicalSpanKind.AGENT,
                    start_time=fragment.start_time,
                    end_time=fragment.end_time,
                    inputs=trace_info.inputs,
                    outputs=fragment.output,
                    status=CanonicalSpanStatus.ERROR if fragment.error else CanonicalSpanStatus.OK,
                    error=fragment.error,
                    metadata={"role": fragment.role, "complete": fragment.complete},
                )
            )
            spans.extend(
                CanonicalSpan(
                    id=operation.id,
                    parent_id=fragment.run_id,
                    name=operation.name,
                    kind=CanonicalSpanKind.LLM if operation.kind == "llm" else CanonicalSpanKind.TOOL,
                    start_time=operation.start_time,
                    end_time=operation.end_time,
                    inputs=operation.inputs,
                    outputs=operation.outputs,
                    status=CanonicalSpanStatus.ERROR if operation.error else CanonicalSpanStatus.OK,
                    error=operation.error,
                    metadata=dict(operation.metadata),
                )
                for operation in fragment.operations
            )
        for wait in _human_waits(trace_info.metadata):
            phase = wait.phase or "requested"
            spans.append(
                CanonicalSpan(
                    id=f"human_wait:{wait.wait_id}:{phase}",
                    parent_id=message_id,
                    name="human_wait",
                    kind=CanonicalSpanKind.HUMAN_WAIT,
                    start_time=wait.start_time,
                    end_time=wait.end_time,
                    inputs=wait.input,
                    outputs=wait.output,
                    status=CanonicalSpanStatus.OK,
                    metadata={
                        "wait_id": wait.wait_id,
                        "owner_kind": wait.owner_kind,
                        "outcome": wait.outcome,
                        "tool_call_id": wait.tool_call_id,
                        "phase": phase,
                        "wait_duration_ms": wait.wait_duration_ms,
                    },
                    links=(wait.linked_message_id,) if wait.linked_message_id else (),
                )
            )
        return CanonicalTrace(
            trace_id=trace_info.resolved_trace_id or message_id,
            session_id=resolve_session_id(trace_info),
            root_span_id=message_id,
            spans=tuple(spans),
        )

    def _build_moderation(self, trace_info: ModerationTraceInfo) -> CanonicalTrace | None:
        if trace_info.message_data is None:
            return None
        return self._single_trace(
            trace_info,
            name="moderation",
            kind=CanonicalSpanKind.TOOL,
            inputs=trace_info.inputs,
            outputs={"action": trace_info.action, "flagged": trace_info.flagged},
            parent_id=trace_info.message_id,
        )

    def _build_suggested_question(self, trace_info: SuggestedQuestionTraceInfo) -> CanonicalTrace | None:
        if trace_info.message_data is None:
            return None
        return self._single_trace(
            trace_info,
            name="suggested_question",
            kind=CanonicalSpanKind.TOOL,
            inputs=trace_info.inputs,
            outputs=trace_info.suggested_question,
            error=trace_info.error,
            parent_id=trace_info.message_id,
        )

    def _build_dataset_retrieval(self, trace_info: DatasetRetrievalTraceInfo) -> CanonicalTrace | None:
        if trace_info.message_data is None:
            return None
        return self._single_trace(
            trace_info,
            name="dataset_retrieval",
            kind=CanonicalSpanKind.RETRIEVER,
            inputs=trace_info.inputs,
            outputs={"documents": trace_info.documents},
            error=trace_info.error,
            parent_id=trace_info.message_id,
        )

    def _build_tool(self, trace_info: ToolTraceInfo) -> CanonicalTrace:
        return self._single_trace(
            trace_info,
            name=trace_info.tool_name,
            kind=CanonicalSpanKind.TOOL,
            inputs=trace_info.tool_inputs,
            outputs=trace_info.tool_outputs,
            error=trace_info.error,
            parent_id=trace_info.message_id,
        )

    def _build_generate_name(self, trace_info: GenerateNameTraceInfo) -> CanonicalTrace:
        return self._single_trace(
            trace_info,
            name="generate_name",
            kind=CanonicalSpanKind.TOOL,
            inputs=trace_info.inputs,
            outputs=trace_info.outputs,
            parent_id=trace_info.message_id,
            session_id=_single_session_id(trace_info) or trace_info.conversation_id or "",
            required_parent_context_id=trace_info.message_id,
        )
