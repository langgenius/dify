import json
import logging
import os
import re
import traceback
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from typing import Any, Protocol, Union, cast
from urllib.parse import urlparse

from openinference.semconv.trace import (
    MessageAttributes,
    OpenInferenceMimeTypeValues,
    OpenInferenceSpanKindValues,
    SpanAttributes,
    ToolCallAttributes,
)
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter as GrpcOTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter as HttpOTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.semconv.attributes import exception_attributes
from opentelemetry.trace import Span, Status, StatusCode, get_current_span, set_span_in_context, use_span
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.util.types import AttributeValue
from sqlalchemy.orm import sessionmaker

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.trace_entity import (
    BaseTraceInfo,
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    TraceTaskName,
    WorkflowTraceInfo,
)
from core.ops.exceptions import PendingTraceParentContextError
from core.ops.utils import JSON_DICT_ADAPTER
from core.repositories import DifyCoreRepositoryFactory
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from graphon.enums import WorkflowNodeExecutionStatus
from models.model import EndUser, MessageFile
from models.workflow import WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)

# This parent-span carrier store is intentionally Phoenix-local for the current
# nested workflow tracing feature. If other trace providers need the same
# cross-task parent restoration behavior, move the storage and retry signaling
# behind a core trace coordination interface instead of duplicating it here.
_PHOENIX_PARENT_SPAN_CONTEXT_TTL_SECONDS = 300
_TRACEPARENT_PATTERN = re.compile(
    r"^(?P<version>[0-9a-f]{2})-(?P<trace_id>[0-9a-f]{32})-(?P<span_id>[0-9a-f]{16})-(?P<flags>[0-9a-f]{2})$"
)


def _phoenix_parent_span_redis_key(parent_node_execution_id: str) -> str:
    """Build the Redis key that stores a restorable Phoenix parent span carrier."""
    return f"trace:phoenix:parent_span:{parent_node_execution_id}"


def _publish_parent_span_context(parent_node_execution_id: str, carrier: Mapping[str, str]) -> None:
    """Persist a tracecontext carrier so nested workflow spans can restore the tool span parent."""
    redis_client.setex(
        _phoenix_parent_span_redis_key(parent_node_execution_id),
        _PHOENIX_PARENT_SPAN_CONTEXT_TTL_SECONDS,
        safe_json_dumps(dict(carrier)),
    )


def _resolve_published_parent_span_context(parent_node_execution_id: str) -> dict[str, str]:
    """Load a previously published tool-span carrier for nested workflow parenting."""
    raw_carrier = redis_client.get(_phoenix_parent_span_redis_key(parent_node_execution_id))
    if raw_carrier is None:
        raise PendingTraceParentContextError(parent_node_execution_id)

    if isinstance(raw_carrier, bytes):
        raw_carrier = raw_carrier.decode("utf-8")

    carrier = json.loads(raw_carrier)
    if not isinstance(carrier, dict):
        raise ValueError(
            "Phoenix parent span context must be stored as a JSON object: "
            f"parent_node_execution_id={parent_node_execution_id}"
        )

    normalized_carrier = {str(key): str(value) for key, value in carrier.items()}
    if not normalized_carrier:
        raise ValueError(
            f"Phoenix parent span context payload is empty: parent_node_execution_id={parent_node_execution_id}"
        )

    traceparent = normalized_carrier.get("traceparent")
    if not isinstance(traceparent, str):
        raise ValueError(
            "Phoenix parent span context payload is missing traceparent: "
            f"parent_node_execution_id={parent_node_execution_id}"
        )

    traceparent_match = _TRACEPARENT_PATTERN.fullmatch(traceparent)
    if traceparent_match is None:
        raise ValueError(
            "Phoenix parent span context payload has invalid traceparent format: "
            f"parent_node_execution_id={parent_node_execution_id}"
        )

    if traceparent_match.group("version") == "ff":
        raise ValueError(
            "Phoenix parent span context payload has unsupported traceparent version: "
            f"parent_node_execution_id={parent_node_execution_id}"
        )

    if traceparent_match.group("trace_id") == "0" * 32:
        raise ValueError(
            "Phoenix parent span context payload has zero trace_id in traceparent: "
            f"parent_node_execution_id={parent_node_execution_id}"
        )

    if traceparent_match.group("span_id") == "0" * 16:
        raise ValueError(
            "Phoenix parent span context payload has zero span_id in traceparent: "
            f"parent_node_execution_id={parent_node_execution_id}"
        )

    extracted_context = TraceContextTextMapPropagator().extract(carrier=normalized_carrier)
    extracted_span_context = get_current_span(extracted_context).get_span_context()
    if not extracted_span_context.is_valid or not extracted_span_context.is_remote:
        raise ValueError(
            "Phoenix parent span context payload could not be restored into a valid parent span: "
            f"parent_node_execution_id={parent_node_execution_id}"
        )

    return normalized_carrier


def setup_tracer(arize_phoenix_config: ArizeConfig | PhoenixConfig) -> tuple[trace_sdk.Tracer, SimpleSpanProcessor]:
    """Configure OpenTelemetry tracer with OTLP exporter for Arize/Phoenix."""
    try:
        # Choose the appropriate exporter based on config type
        exporter: Union[GrpcOTLPSpanExporter, HttpOTLPSpanExporter]

        # Inspect the provided endpoint to determine its structure
        parsed = urlparse(arize_phoenix_config.endpoint)
        base_endpoint = f"{parsed.scheme}://{parsed.netloc}"
        path = parsed.path.rstrip("/")

        if isinstance(arize_phoenix_config, ArizeConfig):
            arize_endpoint = f"{base_endpoint}/v1"
            arize_headers = {
                "api_key": arize_phoenix_config.api_key or "",
                "space_id": arize_phoenix_config.space_id or "",
                "authorization": f"Bearer {arize_phoenix_config.api_key or ''}",
            }
            exporter = GrpcOTLPSpanExporter(
                endpoint=arize_endpoint,
                headers=arize_headers,
                timeout=30,
            )
        else:
            phoenix_endpoint = f"{base_endpoint}{path}/v1/traces"
            phoenix_headers = {
                "api_key": arize_phoenix_config.api_key or "",
                "authorization": f"Bearer {arize_phoenix_config.api_key or ''}",
            }
            exporter = HttpOTLPSpanExporter(
                endpoint=phoenix_endpoint,
                headers=phoenix_headers,
                timeout=30,
            )

        attributes = {
            "openinference.project.name": arize_phoenix_config.project or "",
            "model_id": arize_phoenix_config.project or "",
        }
        resource = Resource(attributes=attributes)
        provider = trace_sdk.TracerProvider(resource=resource)
        processor = SimpleSpanProcessor(
            exporter,
        )
        provider.add_span_processor(processor)

        # Create a named tracer instead of setting the global provider
        tracer_name = f"arize_phoenix_tracer_{arize_phoenix_config.project}"
        logger.info("[Arize/Phoenix] Created tracer with name: %s", tracer_name)
        return cast(trace_sdk.Tracer, provider.get_tracer(tracer_name)), processor
    except Exception as e:
        logger.error("[Arize/Phoenix] Failed to setup the tracer: %s", str(e), exc_info=True)
        raise


def datetime_to_nanos(dt: datetime | None) -> int:
    """Convert datetime to nanoseconds since epoch for Arize/Phoenix."""
    if dt is None:
        dt = datetime.now()
    return int(dt.timestamp() * 1_000_000_000)


def error_to_string(error: Exception | str | None) -> str:
    """Convert an error to a string with traceback information for Arize/Phoenix."""
    error_message = "Empty Stack Trace"
    if error:
        if isinstance(error, Exception):
            string_stacktrace = "".join(traceback.format_exception(error))
            error_message = f"{error.__class__.__name__}: {error}\n\n{string_stacktrace}"
        else:
            error_message = str(error)
    return error_message


def set_span_status(current_span: Span, error: Exception | str | None = None):
    """Set the status of the current span based on the presence of an error for Arize/Phoenix."""
    if error:
        error_string = error_to_string(error)
        current_span.set_status(Status(StatusCode.ERROR, error_string))

        if isinstance(error, Exception):
            current_span.record_exception(error)
        else:
            exception_type = error.__class__.__name__
            exception_message = str(error)
            if not exception_message:
                exception_message = repr(error)
            attributes: dict[str, AttributeValue] = {
                exception_attributes.EXCEPTION_TYPE: exception_type,
                exception_attributes.EXCEPTION_MESSAGE: exception_message,
                exception_attributes.EXCEPTION_ESCAPED: False,
                exception_attributes.EXCEPTION_STACKTRACE: error_string,
            }
            current_span.add_event(name="exception", attributes=attributes)
    else:
        current_span.set_status(Status(StatusCode.OK))


def safe_json_dumps(obj: Any) -> str:
    """A convenience wrapper to ensure that any object can be safely encoded for Arize/Phoenix."""
    return json.dumps(obj, default=str, ensure_ascii=False)


def wrap_span_metadata(metadata, **kwargs):
    """Add common metatada to all trace entity types for Arize/Phoenix."""
    metadata["created_from"] = "Dify"
    metadata.update(kwargs)
    return metadata


# Mapping from built-in node type strings to OpenInference span kinds.
# Node types not listed here default to CHAIN.
_NODE_TYPE_TO_SPAN_KIND: dict[str, OpenInferenceSpanKindValues] = {
    "llm": OpenInferenceSpanKindValues.LLM,
    "knowledge-retrieval": OpenInferenceSpanKindValues.RETRIEVER,
    "tool": OpenInferenceSpanKindValues.TOOL,
    "agent": OpenInferenceSpanKindValues.AGENT,
}


def _get_node_span_kind(node_type: str) -> OpenInferenceSpanKindValues:
    """Return the OpenInference span kind for a given workflow node type.

    Covers every built-in node type string. Nodes that do not have a
    specialised span kind (e.g. ``start``, ``end``, ``if-else``,
    ``code``, ``loop``, ``iteration``, etc.) are mapped to ``CHAIN``.
    """
    return _NODE_TYPE_TO_SPAN_KIND.get(node_type, OpenInferenceSpanKindValues.CHAIN)


def _resolve_workflow_session_id(trace_info: WorkflowTraceInfo) -> str:
    """Resolve the workflow session ID for Phoenix workflow spans."""
    if trace_info.conversation_id:
        return trace_info.conversation_id

    parent_workflow_run_id, _ = _resolve_workflow_parent_context(trace_info)
    if parent_workflow_run_id:
        return parent_workflow_run_id

    return trace_info.workflow_run_id


def _resolve_workflow_parent_context(trace_info: BaseTraceInfo) -> tuple[str | None, str | None]:
    """Expose the typed parent context already resolved on the trace info."""
    return trace_info.resolved_parent_context


def _resolve_workflow_root_trace_id(trace_info: WorkflowTraceInfo) -> str:
    """Resolve the canonical root trace ID for Phoenix workflow spans."""
    trace_correlation_override, _ = _resolve_workflow_parent_context(trace_info)
    return trace_correlation_override or trace_info.resolved_trace_id or trace_info.workflow_run_id


class _NodeExecutionIdentityLike(Protocol):
    @property
    def node_execution_id(self) -> str | None: ...

    @property
    def node_id(self) -> str: ...

    @property
    def predecessor_node_id(self) -> str | None: ...


class _NodeExecutionLike(_NodeExecutionIdentityLike, Protocol):
    @property
    def id(self) -> str: ...

    @property
    def node_type(self) -> str: ...

    @property
    def title(self) -> str | None: ...

    @property
    def inputs(self) -> Mapping[str, Any] | None: ...

    @property
    def process_data(self) -> Mapping[str, Any] | None: ...

    @property
    def outputs(self) -> Mapping[str, Any] | None: ...

    @property
    def status(self) -> WorkflowNodeExecutionStatus: ...

    @property
    def error(self) -> str | None: ...

    @property
    def elapsed_time(self) -> float | None: ...

    @property
    def metadata(self) -> Mapping[Any, Any] | None: ...

    @property
    def created_at(self) -> datetime | None: ...


_PHOENIX_STRUCTURED_NODE_TYPES = frozenset({"start", "end", "loop", "iteration"})


def _resolve_workflow_span_name(trace_info: WorkflowTraceInfo) -> str:
    """Resolve the Phoenix workflow span display name."""
    workflow_run_id = trace_info.workflow_run_id.strip() if trace_info.workflow_run_id else ""
    if workflow_run_id:
        return f"{TraceTaskName.WORKFLOW_TRACE.value}_{workflow_run_id}"
    return TraceTaskName.WORKFLOW_TRACE.value


def _build_node_title_by_id(trace_info: WorkflowTraceInfo) -> dict[str, str]:
    """Build an authoritative node-title index from the persisted workflow graph."""
    workflow_data = trace_info.workflow_data
    workflow_graph = getattr(workflow_data, "graph_dict", None)
    if not isinstance(workflow_graph, Mapping):
        workflow_graph = workflow_data.get("graph") if isinstance(workflow_data, Mapping) else None
    if not isinstance(workflow_graph, Mapping):
        return {}

    graph_nodes = workflow_graph.get("nodes")
    if not isinstance(graph_nodes, Sequence):
        return {}

    node_title_by_id: dict[str, str] = {}
    for graph_node in graph_nodes:
        if not isinstance(graph_node, Mapping):
            continue
        node_id = graph_node.get("id")
        node_data = graph_node.get("data")
        if not isinstance(node_id, str) or not isinstance(node_data, Mapping):
            continue
        node_title = node_data.get("title")
        if isinstance(node_title, str) and node_title.strip():
            node_title_by_id[node_id] = node_title.strip()

    return node_title_by_id


def _resolve_workflow_node_span_name(
    node_execution: _NodeExecutionLike,
    node_title_by_id: Mapping[str, str] | None = None,
) -> str:
    """Resolve the Phoenix workflow node span display name."""
    node_type = str(node_execution.node_type or "")
    graph_node_title = None
    if node_title_by_id is not None and isinstance(node_execution.node_id, str):
        graph_node_title = node_title_by_id.get(node_execution.node_id)

    node_title = graph_node_title or (node_execution.title.strip() if isinstance(node_execution.title, str) else "")
    if node_title:
        return f"{node_type}_{node_title}"
    return node_type


def _get_node_execution_id(node_execution: _NodeExecutionIdentityLike) -> str:
    """Return the stable execution identifier for a workflow node execution."""
    return str(getattr(node_execution, "id", None) or node_execution.node_execution_id)


def _build_execution_id_by_node_id(node_executions: Sequence[_NodeExecutionIdentityLike]) -> dict[str, str]:
    """Index unique workflow graph node ids by execution id.

    This Phoenix-local hierarchy reconstruction intentionally drops ambiguous
    node ids instead of guessing based on repository order. That keeps parent
    selection deterministic until upstream tracing exposes explicit parent span
    data for repeated executions.
    """
    execution_id_by_node_id: dict[str, str] = {}
    ambiguous_node_ids: set[str] = set()

    for node_execution in node_executions:
        node_id = node_execution.node_id
        if not isinstance(node_id, str):
            continue
        execution_id = _get_node_execution_id(node_execution)

        if node_id in ambiguous_node_ids:
            continue

        existing_execution_id = execution_id_by_node_id.get(node_id)
        if existing_execution_id is None:
            execution_id_by_node_id[node_id] = execution_id
            continue

        if existing_execution_id != execution_id:
            ambiguous_node_ids.add(node_id)
            execution_id_by_node_id.pop(node_id, None)

    return execution_id_by_node_id


def _build_graph_parent_index(node_executions: Sequence[_NodeExecutionIdentityLike]) -> dict[str, str]:
    """Build an execution-id parent index from predecessor node ids."""
    execution_id_by_node_id = _build_execution_id_by_node_id(node_executions)
    graph_parent_index: dict[str, str] = {}

    for node_execution in node_executions:
        predecessor_node_id = node_execution.predecessor_node_id
        if not isinstance(predecessor_node_id, str):
            continue

        predecessor_execution_id = execution_id_by_node_id.get(predecessor_node_id)
        if predecessor_execution_id is not None:
            execution_id = _get_node_execution_id(node_execution)
            graph_parent_index[execution_id] = predecessor_execution_id

    return graph_parent_index


def _resolve_structured_parent_execution_id(
    node_execution: object, execution_id_by_node_id: Mapping[str, str]
) -> str | None:
    """Resolve Phoenix-local structured parents from loop/iteration node ids.

    Any execution carrying ``iteration_id`` or ``loop_id`` belongs to an
    enclosing structured node. When predecessor node ids are ambiguous because
    the graph node repeats inside that structure, Phoenix can still keep the
    child span under the enclosing loop/iteration span without relying on
    execution-order heuristics.
    """
    execution_metadata = getattr(node_execution, "execution_metadata_dict", None)
    if not isinstance(execution_metadata, Mapping):
        execution_metadata = getattr(node_execution, "metadata", None)
    if not isinstance(execution_metadata, Mapping):
        execution_metadata = {}

    for enclosing_node_id in (
        getattr(node_execution, "iteration_id", None),
        getattr(node_execution, "loop_id", None),
        execution_metadata.get("iteration_id"),
        execution_metadata.get("loop_id"),
    ):
        if not isinstance(enclosing_node_id, str):
            continue

        enclosing_execution_id = execution_id_by_node_id.get(enclosing_node_id)
        if enclosing_execution_id is not None:
            return enclosing_execution_id

    return None


def _resolve_node_parent(
    execution_id: str,
    predecessor_execution_id: str | None,
    structured_parent_execution_id: str | None,
    span_by_execution_id: Mapping[str, Span],
    graph_parent_index: Mapping[str, str],
    workflow_span: Span,
) -> Span:
    """Resolve the parent span for a workflow node execution."""
    if predecessor_execution_id is not None:
        predecessor_span = span_by_execution_id.get(predecessor_execution_id)
        if predecessor_span is not None:
            return predecessor_span

    graph_parent_execution_id = graph_parent_index.get(execution_id)
    if graph_parent_execution_id is not None:
        graph_parent_span = span_by_execution_id.get(graph_parent_execution_id)
        if graph_parent_span is not None:
            return graph_parent_span

    if structured_parent_execution_id is not None:
        structured_parent_span = span_by_execution_id.get(structured_parent_execution_id)
        if structured_parent_span is not None:
            return structured_parent_span

    return workflow_span


class ArizePhoenixDataTrace(BaseTraceInstance):
    def __init__(
        self,
        arize_phoenix_config: ArizeConfig | PhoenixConfig,
    ):
        super().__init__(arize_phoenix_config)
        self.arize_phoenix_config = arize_phoenix_config
        self.tracer, self.processor = setup_tracer(arize_phoenix_config)
        self.project = arize_phoenix_config.project
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")
        self.propagator = TraceContextTextMapPropagator()
        self.dify_trace_ids: set[str] = set()
        self.root_span_carriers: dict[str, dict[str, str]] = {}
        self.carrier: dict[str, str] = {}

    def trace(self, trace_info: BaseTraceInfo):
        logger.info("[Arize/Phoenix] Trace Entity Info: %s", trace_info)
        logger.info("[Arize/Phoenix] Trace Entity Type: %s", type(trace_info))
        try:
            if isinstance(trace_info, WorkflowTraceInfo):
                self.workflow_trace(trace_info)
            if isinstance(trace_info, MessageTraceInfo):
                self.message_trace(trace_info)
            if isinstance(trace_info, ModerationTraceInfo):
                self.moderation_trace(trace_info)
            if isinstance(trace_info, SuggestedQuestionTraceInfo):
                self.suggested_question_trace(trace_info)
            if isinstance(trace_info, DatasetRetrievalTraceInfo):
                self.dataset_retrieval_trace(trace_info)
            if isinstance(trace_info, ToolTraceInfo):
                self.tool_trace(trace_info)
            if isinstance(trace_info, GenerateNameTraceInfo):
                self.generate_name_trace(trace_info)

        except Exception as e:
            logger.error("[Arize/Phoenix] Trace Entity Error: %s", str(e), exc_info=True)
            raise

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        file_list = trace_info.file_list if isinstance(trace_info.file_list, list) else []

        metadata = wrap_span_metadata(
            trace_info.metadata,
            trace_id=trace_info.trace_id or "",
            message_id=trace_info.message_id or "",
            status=trace_info.workflow_run_status or "",
            status_message=trace_info.error or "",
            level="ERROR" if trace_info.error else "DEFAULT",
            trace_entity_type="workflow",
            conversation_id=trace_info.conversation_id or "",
            workflow_app_log_id=trace_info.workflow_app_log_id or "",
            workflow_id=trace_info.workflow_id or "",
            tenant_id=trace_info.tenant_id or "",
            workflow_run_id=trace_info.workflow_run_id or "",
            workflow_run_elapsed_time=trace_info.workflow_run_elapsed_time or 0,
            workflow_run_version=trace_info.workflow_run_version or "",
            total_tokens=trace_info.total_tokens or 0,
            file_list=safe_json_dumps(file_list),
            query=trace_info.query or "",
        )
        workflow_session_id = _resolve_workflow_session_id(trace_info)
        parent_workflow_run_id, parent_node_execution_id = _resolve_workflow_parent_context(trace_info)
        logger.info(
            "[Arize/Phoenix] Workflow session resolution: workflow_run_id=%s conversation_id=%s "
            "parent_workflow_run_id=%s parent_node_execution_id=%s resolved_session_id=%s",
            trace_info.workflow_run_id,
            trace_info.conversation_id,
            parent_workflow_run_id,
            parent_node_execution_id,
            workflow_session_id,
        )

        if parent_node_execution_id:
            workflow_parent_carrier = _resolve_published_parent_span_context(parent_node_execution_id)
        else:
            root_trace_id = _resolve_workflow_root_trace_id(trace_info)
            workflow_root_span_name: str | None = trace_info.workflow_run_id
            if not isinstance(workflow_root_span_name, str) or not workflow_root_span_name.strip():
                workflow_root_span_name = None

            workflow_parent_carrier = self.ensure_root_span(
                root_trace_id,
                root_span_name=workflow_root_span_name,
                root_span_attributes={
                    SpanAttributes.INPUT_VALUE: safe_json_dumps(trace_info.workflow_run_inputs),
                    SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                    SpanAttributes.OUTPUT_VALUE: safe_json_dumps(trace_info.workflow_run_outputs),
                    SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                },
            )

        workflow_span_context = self.propagator.extract(carrier=workflow_parent_carrier)

        workflow_span = self.tracer.start_span(
            name=_resolve_workflow_span_name(trace_info),
            attributes={
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                SpanAttributes.INPUT_VALUE: safe_json_dumps(trace_info.workflow_run_inputs),
                SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.OUTPUT_VALUE: safe_json_dumps(trace_info.workflow_run_outputs),
                SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.METADATA: safe_json_dumps(metadata),
                SpanAttributes.SESSION_ID: workflow_session_id or "",
            },
            start_time=datetime_to_nanos(trace_info.start_time),
            context=workflow_span_context,
        )

        # Through workflow_run_id, get all_nodes_execution using repository
        session_factory = sessionmaker(bind=db.engine)

        # Find the app's creator account
        app_id = trace_info.metadata.get("app_id")
        if not app_id:
            raise ValueError("No app_id found in trace_info metadata")

        service_account = self.get_service_account_with_tenant(app_id)

        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=session_factory,
            user=service_account,
            app_id=app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        # Get all executions for this workflow run
        workflow_node_executions = workflow_node_execution_repository.get_by_workflow_execution(
            workflow_execution_id=trace_info.workflow_run_id
        )
        node_title_by_id = _build_node_title_by_id(trace_info)
        execution_id_by_node_id = _build_execution_id_by_node_id(workflow_node_executions)
        graph_parent_index = _build_graph_parent_index(workflow_node_executions)
        node_execution_by_execution_id = {
            _get_node_execution_id(node_execution): node_execution for node_execution in workflow_node_executions
        }
        span_by_execution_id: dict[str, Span] = {}
        emitting_execution_ids: set[str] = set()

        workflow_span_error: Exception | str | None = trace_info.error
        try:

            def emit_node_span(node_execution: _NodeExecutionLike) -> Span:
                execution_id = _get_node_execution_id(node_execution)
                existing_span = span_by_execution_id.get(execution_id)
                if existing_span is not None:
                    return existing_span

                graph_parent_execution_id = graph_parent_index.get(execution_id)
                structured_parent_execution_id = _resolve_structured_parent_execution_id(
                    node_execution, execution_id_by_node_id
                )

                if execution_id not in emitting_execution_ids:
                    emitting_execution_ids.add(execution_id)
                    try:
                        for parent_execution_id in (graph_parent_execution_id, structured_parent_execution_id):
                            if parent_execution_id is None or parent_execution_id == execution_id:
                                continue
                            if parent_execution_id in span_by_execution_id:
                                continue
                            parent_node_execution = node_execution_by_execution_id.get(parent_execution_id)
                            if parent_node_execution is not None:
                                emit_node_span(parent_node_execution)
                    finally:
                        emitting_execution_ids.discard(execution_id)

                tenant_id = trace_info.tenant_id  # Use from trace_info instead
                app_id = trace_info.metadata.get("app_id")  # Use from trace_info instead
                inputs_value = node_execution.inputs or {}
                outputs_value = node_execution.outputs or {}

                created_at = node_execution.created_at or datetime.now()
                elapsed_time = node_execution.elapsed_time or 0
                finished_at = created_at + timedelta(seconds=elapsed_time)

                process_data = node_execution.process_data or {}
                execution_metadata = node_execution.metadata or {}
                node_metadata = {str(k): v for k, v in execution_metadata.items()}

                node_metadata.update(
                    {
                        "node_id": node_execution.id,
                        "node_type": node_execution.node_type,
                        "node_status": node_execution.status,
                        "tenant_id": tenant_id,
                        "app_id": app_id,
                        "app_name": node_execution.title,
                        "status": node_execution.status,
                        "status_message": node_execution.error or "",
                        "level": "ERROR" if node_execution.status == WorkflowNodeExecutionStatus.FAILED else "DEFAULT",
                    }
                )

                # Determine the correct span kind based on node type
                span_kind = _get_node_span_kind(node_execution.node_type)
                if node_execution.node_type == "llm":
                    provider = process_data.get("model_provider")
                    model = process_data.get("model_name")
                    if provider:
                        node_metadata["ls_provider"] = provider
                    if model:
                        node_metadata["ls_model_name"] = model

                    usage_data = (
                        process_data.get("usage", {}) if "usage" in process_data else outputs_value.get("usage", {})
                    )
                    if usage_data:
                        node_metadata["total_tokens"] = usage_data.get("total_tokens", 0)
                        node_metadata["prompt_tokens"] = usage_data.get("prompt_tokens", 0)
                        node_metadata["completion_tokens"] = usage_data.get("completion_tokens", 0)

                parent_span = _resolve_node_parent(
                    execution_id=execution_id,
                    predecessor_execution_id=None,
                    structured_parent_execution_id=structured_parent_execution_id,
                    span_by_execution_id=span_by_execution_id,
                    graph_parent_index=graph_parent_index,
                    workflow_span=workflow_span,
                )
                workflow_span_context = set_span_in_context(parent_span)
                node_span = self.tracer.start_span(
                    name=_resolve_workflow_node_span_name(node_execution, node_title_by_id),
                    attributes={
                        SpanAttributes.OPENINFERENCE_SPAN_KIND: span_kind.value,
                        SpanAttributes.INPUT_VALUE: safe_json_dumps(inputs_value),
                        SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                        SpanAttributes.OUTPUT_VALUE: safe_json_dumps(outputs_value),
                        SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                        SpanAttributes.METADATA: safe_json_dumps(node_metadata),
                        SpanAttributes.SESSION_ID: workflow_session_id or "",
                    },
                    start_time=datetime_to_nanos(created_at),
                    context=workflow_span_context,
                )
                span_by_execution_id[execution_id] = node_span
                node_span_error: Exception | str | None = None
                try:
                    if node_execution.node_type == "tool":
                        parent_span_carrier: dict[str, str] = {}
                        with use_span(node_span, end_on_exit=False):
                            self.propagator.inject(carrier=parent_span_carrier)
                        _publish_parent_span_context(execution_id, parent_span_carrier)

                    if node_execution.node_type == "llm":
                        llm_attributes: dict[str, Any] = {
                            SpanAttributes.INPUT_VALUE: json.dumps(process_data.get("prompts", []), ensure_ascii=False),
                        }
                        provider = process_data.get("model_provider")
                        model = process_data.get("model_name")
                        if provider:
                            llm_attributes[SpanAttributes.LLM_PROVIDER] = provider
                        if model:
                            llm_attributes[SpanAttributes.LLM_MODEL_NAME] = model
                        usage_data = (
                            process_data.get("usage", {}) if "usage" in process_data else outputs_value.get("usage", {})
                        )
                        if usage_data:
                            llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_TOTAL] = usage_data.get("total_tokens", 0)
                            llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_PROMPT] = usage_data.get("prompt_tokens", 0)
                            llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_COMPLETION] = usage_data.get(
                                "completion_tokens", 0
                            )
                        llm_attributes.update(self._construct_llm_attributes(process_data.get("prompts", [])))
                        node_span.set_attributes(llm_attributes)
                except Exception as e:
                    node_span_error = e
                    raise
                finally:
                    if node_span_error is not None:
                        set_span_status(node_span, node_span_error)
                    elif node_execution.status == WorkflowNodeExecutionStatus.FAILED:
                        set_span_status(node_span, node_execution.error)
                    else:
                        set_span_status(node_span)
                    node_span.end(end_time=datetime_to_nanos(finished_at))
                return node_span

            for node_execution in workflow_node_executions:
                emit_node_span(node_execution)
        except Exception as e:
            workflow_span_error = e
            raise
        finally:
            set_span_status(workflow_span, workflow_span_error)
            workflow_span.end(end_time=datetime_to_nanos(trace_info.end_time))

    def message_trace(self, trace_info: MessageTraceInfo):
        if trace_info.message_data is None:
            logger.warning("[Arize/Phoenix] Message data is None, skipping message trace.")
            return

        file_list = trace_info.file_list if isinstance(trace_info.file_list, list) else []
        message_file_data: MessageFile | None = trace_info.message_file_data

        if message_file_data is not None:
            file_url = f"{self.file_base_url}/{message_file_data.url}" if message_file_data else ""
            file_list.append(file_url)

        metadata = wrap_span_metadata(
            trace_info.metadata,
            trace_id=trace_info.trace_id or "",
            message_id=trace_info.message_id or "",
            status=trace_info.message_data.status or "",
            status_message=trace_info.error or "",
            level="ERROR" if trace_info.error else "DEFAULT",
            trace_entity_type="message",
            conversation_model=trace_info.conversation_model or "",
            message_tokens=trace_info.message_tokens or 0,
            answer_tokens=trace_info.answer_tokens or 0,
            total_tokens=trace_info.total_tokens or 0,
            conversation_mode=trace_info.conversation_mode or "",
            gen_ai_server_time_to_first_token=trace_info.gen_ai_server_time_to_first_token or 0,
            llm_streaming_time_to_generate=trace_info.llm_streaming_time_to_generate or 0,
            is_streaming_request=trace_info.is_streaming_request or False,
            user_id=trace_info.message_data.from_account_id or "",
            file_list=safe_json_dumps(file_list),
            model_provider=trace_info.message_data.model_provider or "",
            model_id=trace_info.message_data.model_id or "",
        )

        # Add end user data if available
        if trace_info.message_data.from_end_user_id:
            end_user_data: EndUser | None = db.session.get(EndUser, trace_info.message_data.from_end_user_id)
            if end_user_data is not None:
                metadata["end_user_id"] = end_user_data.session_id

        attributes = {
            SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
            SpanAttributes.INPUT_VALUE: trace_info.message_data.query,
            SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.TEXT.value,
            SpanAttributes.OUTPUT_VALUE: trace_info.message_data.answer,
            SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.TEXT.value,
            SpanAttributes.METADATA: safe_json_dumps(metadata),
            SpanAttributes.SESSION_ID: trace_info.message_data.conversation_id or "",
        }

        dify_trace_id = trace_info.trace_id or trace_info.message_id
        self.ensure_root_span(dify_trace_id)
        root_span_context = self.propagator.extract(carrier=self.carrier)

        message_span = self.tracer.start_span(
            name=TraceTaskName.MESSAGE_TRACE.value,
            attributes=attributes,
            start_time=datetime_to_nanos(trace_info.start_time),
            context=root_span_context,
        )

        try:
            # Convert outputs to string based on type
            outputs_mime_type = OpenInferenceMimeTypeValues.TEXT.value
            if isinstance(trace_info.outputs, dict | list):
                outputs_str = safe_json_dumps(trace_info.outputs)
                outputs_mime_type = OpenInferenceMimeTypeValues.JSON.value
            elif isinstance(trace_info.outputs, str):
                outputs_str = trace_info.outputs
            else:
                outputs_str = str(trace_info.outputs)

            llm_attributes = {
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.LLM.value,
                SpanAttributes.INPUT_VALUE: safe_json_dumps(trace_info.inputs),
                SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.OUTPUT_VALUE: outputs_str,
                SpanAttributes.OUTPUT_MIME_TYPE: outputs_mime_type,
                SpanAttributes.METADATA: safe_json_dumps(metadata),
                SpanAttributes.SESSION_ID: trace_info.message_data.conversation_id or "",
            }
            llm_attributes.update(self._construct_llm_attributes(trace_info.inputs))
            if trace_info.total_tokens is not None and trace_info.total_tokens > 0:
                llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_TOTAL] = trace_info.total_tokens
            if trace_info.message_tokens is not None and trace_info.message_tokens > 0:
                llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_PROMPT] = trace_info.message_tokens
            if trace_info.answer_tokens is not None and trace_info.answer_tokens > 0:
                llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_COMPLETION] = trace_info.answer_tokens

            if trace_info.message_data.model_id is not None:
                llm_attributes[SpanAttributes.LLM_MODEL_NAME] = trace_info.message_data.model_id
            if trace_info.message_data.model_provider is not None:
                llm_attributes[SpanAttributes.LLM_PROVIDER] = trace_info.message_data.model_provider

            if trace_info.message_data and trace_info.message_data.message_metadata:
                metadata_dict = JSON_DICT_ADAPTER.validate_json(trace_info.message_data.message_metadata)
                if model_params := metadata_dict.get("model_parameters"):
                    llm_attributes[SpanAttributes.LLM_INVOCATION_PARAMETERS] = json.dumps(model_params)

            message_span_context = set_span_in_context(message_span)
            llm_span = self.tracer.start_span(
                name="llm",
                attributes=llm_attributes,
                start_time=datetime_to_nanos(trace_info.start_time),
                context=message_span_context,
            )

            try:
                if trace_info.message_data.error:
                    set_span_status(llm_span, trace_info.message_data.error)
                else:
                    set_span_status(llm_span)
            finally:
                llm_span.end(end_time=datetime_to_nanos(trace_info.end_time))
        finally:
            if trace_info.error:
                set_span_status(message_span, trace_info.error)
            else:
                set_span_status(message_span)
            message_span.end(end_time=datetime_to_nanos(trace_info.end_time))

    def moderation_trace(self, trace_info: ModerationTraceInfo):
        if trace_info.message_data is None:
            logger.warning("[Arize/Phoenix] Message data is None, skipping moderation trace.")
            return

        metadata = wrap_span_metadata(
            trace_info.metadata,
            trace_id=trace_info.trace_id or "",
            message_id=trace_info.message_id or "",
            status=trace_info.message_data.status or "",
            status_message=trace_info.message_data.error or "",
            level="ERROR" if trace_info.message_data.error else "DEFAULT",
            trace_entity_type="moderation",
            model_provider=trace_info.message_data.model_provider or "",
            model_id=trace_info.message_data.model_id or "",
        )

        dify_trace_id = trace_info.trace_id or trace_info.message_id
        self.ensure_root_span(dify_trace_id)
        root_span_context = self.propagator.extract(carrier=self.carrier)

        span = self.tracer.start_span(
            name=TraceTaskName.MODERATION_TRACE.value,
            attributes={
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.TOOL.value,
                SpanAttributes.INPUT_VALUE: safe_json_dumps(trace_info.inputs),
                SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.OUTPUT_VALUE: safe_json_dumps(
                    {
                        "flagged": trace_info.flagged,
                        "action": trace_info.action,
                        "preset_response": trace_info.preset_response,
                        "query": trace_info.query,
                    }
                ),
                SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.METADATA: safe_json_dumps(metadata),
            },
            start_time=datetime_to_nanos(trace_info.start_time),
            context=root_span_context,
        )

        try:
            if trace_info.message_data.error:
                set_span_status(span, trace_info.message_data.error)
            else:
                set_span_status(span)
        finally:
            span.end(end_time=datetime_to_nanos(trace_info.end_time))

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        if trace_info.message_data is None:
            logger.warning("[Arize/Phoenix] Message data is None, skipping suggested question trace.")
            return

        start_time = trace_info.start_time or trace_info.message_data.created_at
        end_time = trace_info.end_time or trace_info.message_data.updated_at

        metadata = wrap_span_metadata(
            trace_info.metadata,
            trace_id=trace_info.trace_id or "",
            message_id=trace_info.message_id or "",
            status=trace_info.status or "",
            status_message=trace_info.status_message or "",
            level=trace_info.level or "",
            trace_entity_type="suggested_question",
            total_tokens=trace_info.total_tokens or 0,
            from_account_id=trace_info.from_account_id or "",
            agent_based=trace_info.agent_based or False,
            from_source=trace_info.from_source or "",
            model_provider=trace_info.model_provider or "",
            model_id=trace_info.model_id or "",
            workflow_run_id=trace_info.workflow_run_id or "",
        )

        dify_trace_id = trace_info.trace_id or trace_info.message_id
        self.ensure_root_span(dify_trace_id)
        root_span_context = self.propagator.extract(carrier=self.carrier)

        span = self.tracer.start_span(
            name=TraceTaskName.SUGGESTED_QUESTION_TRACE.value,
            attributes={
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.TOOL.value,
                SpanAttributes.INPUT_VALUE: safe_json_dumps(trace_info.inputs),
                SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.OUTPUT_VALUE: safe_json_dumps(trace_info.suggested_question),
                SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.METADATA: safe_json_dumps(metadata),
            },
            start_time=datetime_to_nanos(start_time),
            context=root_span_context,
        )

        try:
            if trace_info.error:
                set_span_status(span, trace_info.error)
            else:
                set_span_status(span)
        finally:
            span.end(end_time=datetime_to_nanos(end_time))

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            logger.warning("[Arize/Phoenix] Message data is None, skipping dataset retrieval trace.")
            return

        start_time = trace_info.start_time or trace_info.message_data.created_at
        end_time = trace_info.end_time or trace_info.message_data.updated_at

        metadata = wrap_span_metadata(
            trace_info.metadata,
            trace_id=trace_info.trace_id or "",
            message_id=trace_info.message_id or "",
            status=trace_info.message_data.status or "",
            status_message=trace_info.error or "",
            level="ERROR" if trace_info.error else "DEFAULT",
            trace_entity_type="dataset_retrieval",
            model_provider=trace_info.message_data.model_provider or "",
            model_id=trace_info.message_data.model_id or "",
        )

        dify_trace_id = trace_info.trace_id or trace_info.message_id
        self.ensure_root_span(dify_trace_id)
        root_span_context = self.propagator.extract(carrier=self.carrier)

        span = self.tracer.start_span(
            name=TraceTaskName.DATASET_RETRIEVAL_TRACE.value,
            attributes={
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.RETRIEVER.value,
                SpanAttributes.INPUT_VALUE: safe_json_dumps(trace_info.inputs),
                SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.OUTPUT_VALUE: safe_json_dumps({"documents": trace_info.documents}),
                SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.METADATA: safe_json_dumps(metadata),
            },
            start_time=datetime_to_nanos(start_time),
            context=root_span_context,
        )

        try:
            if trace_info.error:
                set_span_status(span, trace_info.error)
            else:
                set_span_status(span)
        finally:
            span.end(end_time=datetime_to_nanos(end_time))

    def tool_trace(self, trace_info: ToolTraceInfo):
        if trace_info.message_data is None:
            logger.warning("[Arize/Phoenix] Message data is None, skipping tool trace.")
            return

        metadata = wrap_span_metadata(
            trace_info.metadata,
            trace_id=trace_info.trace_id or "",
            message_id=trace_info.message_id or "",
            status=trace_info.message_data.status or "",
            status_message=trace_info.error or "",
            level="ERROR" if trace_info.error else "DEFAULT",
            trace_entity_type="tool",
            tool_config=safe_json_dumps(trace_info.tool_config),
            time_cost=trace_info.time_cost or 0,
            file_url=trace_info.file_url or "",
        )

        dify_trace_id = trace_info.trace_id or trace_info.message_id
        self.ensure_root_span(dify_trace_id)
        root_span_context = self.propagator.extract(carrier=self.carrier)

        span = self.tracer.start_span(
            name=trace_info.tool_name,
            attributes={
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.TOOL.value,
                SpanAttributes.INPUT_VALUE: safe_json_dumps(trace_info.tool_inputs),
                SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.OUTPUT_VALUE: trace_info.tool_outputs,
                SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.TEXT.value,
                SpanAttributes.METADATA: safe_json_dumps(metadata),
                SpanAttributes.TOOL_NAME: trace_info.tool_name,
                SpanAttributes.TOOL_PARAMETERS: safe_json_dumps(trace_info.tool_parameters),
            },
            start_time=datetime_to_nanos(trace_info.start_time),
            context=root_span_context,
        )

        try:
            if trace_info.error:
                set_span_status(span, trace_info.error)
            else:
                set_span_status(span)
        finally:
            span.end(end_time=datetime_to_nanos(trace_info.end_time))

    def generate_name_trace(self, trace_info: GenerateNameTraceInfo):
        if trace_info.message_data is None:
            logger.warning("[Arize/Phoenix] Message data is None, skipping generate name trace.")
            return

        metadata = wrap_span_metadata(
            trace_info.metadata,
            trace_id=trace_info.trace_id or "",
            message_id=trace_info.message_id or "",
            status=trace_info.message_data.status or "",
            status_message=trace_info.message_data.error or "",
            level="ERROR" if trace_info.message_data.error else "DEFAULT",
            trace_entity_type="generate_name",
            model_provider=trace_info.message_data.model_provider or "",
            model_id=trace_info.message_data.model_id or "",
            conversation_id=trace_info.conversation_id or "",
            tenant_id=trace_info.tenant_id,
        )

        dify_trace_id = trace_info.trace_id or trace_info.message_id or trace_info.conversation_id
        self.ensure_root_span(dify_trace_id)
        root_span_context = self.propagator.extract(carrier=self.carrier)

        span = self.tracer.start_span(
            name=TraceTaskName.GENERATE_NAME_TRACE.value,
            attributes={
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                SpanAttributes.INPUT_VALUE: safe_json_dumps(trace_info.inputs),
                SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.OUTPUT_VALUE: safe_json_dumps(trace_info.outputs),
                SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.METADATA: safe_json_dumps(metadata),
                SpanAttributes.SESSION_ID: trace_info.conversation_id or "",
            },
            start_time=datetime_to_nanos(trace_info.start_time),
            context=root_span_context,
        )

        try:
            if trace_info.message_data.error:
                set_span_status(span, trace_info.message_data.error)
            else:
                set_span_status(span)
        finally:
            span.end(end_time=datetime_to_nanos(trace_info.end_time))

    def ensure_root_span(
        self,
        dify_trace_id: str | None,
        *,
        root_span_name: str | None = None,
        root_span_attributes: Mapping[str, AttributeValue] | None = None,
    ):
        """Ensure a unique root span exists for the given Dify trace ID."""
        trace_key = str(dify_trace_id)
        if trace_key not in self.dify_trace_ids:
            carrier: dict[str, str] = {}

            span_name = root_span_name.strip() if isinstance(root_span_name, str) and root_span_name.strip() else "Dify"
            root_span_attributes_dict: dict[str, AttributeValue] = {
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                "dify_project_name": str(self.project),
                "dify_trace_id": trace_key,
            }
            if root_span_attributes:
                root_span_attributes_dict.update(root_span_attributes)

            root_span = self.tracer.start_span(name=span_name, attributes=root_span_attributes_dict)

            with use_span(root_span, end_on_exit=False):
                self.propagator.inject(carrier=carrier)

            set_span_status(root_span)
            root_span.end()
            self.dify_trace_ids.add(trace_key)
            self.root_span_carriers[trace_key] = carrier

        self.carrier = self.root_span_carriers[trace_key]
        return self.carrier

    def api_check(self):
        try:
            with self.tracer.start_span("api_check") as span:
                span.set_attribute("test", "true")
            return True
        except Exception as e:
            logger.info("[Arize/Phoenix] API check failed: %s", str(e), exc_info=True)
            raise ValueError(f"[Arize/Phoenix] API check failed: {str(e)}")

    def get_project_url(self):
        """Build a redirect URL that forwards the user to the correct project for Arize/Phoenix."""
        try:
            project_name = self.arize_phoenix_config.project
            endpoint = self.arize_phoenix_config.endpoint.rstrip("/")

            # Arize
            if isinstance(self.arize_phoenix_config, ArizeConfig):
                return f"https://app.arize.com/?redirect_project_name={project_name}"

            # Phoenix
            return f"{endpoint}/projects/?redirect_project_name={project_name}"

        except Exception as e:
            logger.info("[Arize/Phoenix] Failed to construct project URL: %s", str(e), exc_info=True)
            raise ValueError(f"[Arize/Phoenix] Failed to construct project URL: {str(e)}")

    def _construct_llm_attributes(self, prompts: dict[str, Any] | list[Any] | str | None) -> dict[str, str]:
        """Construct LLM attributes with passed prompts for Arize/Phoenix."""
        attributes: dict[str, str] = {}

        def set_attribute(path: str, value: object) -> None:
            """Store an attribute safely as a string."""
            if value is None:
                return
            try:
                if isinstance(value, (dict, list)):
                    value = safe_json_dumps(value)
                attributes[path] = str(value)
            except Exception:
                attributes[path] = str(value)

        def set_message_attribute(message_index: int, key: str, value: object) -> None:
            path = f"{SpanAttributes.LLM_INPUT_MESSAGES}.{message_index}.{key}"
            set_attribute(path, value)

        def set_tool_call_attributes(
            message_index: int, tool_index: int, tool_call: dict[str, Any] | object | None
        ) -> None:
            """Extract and assign tool call details safely."""
            if not tool_call:
                return

            def safe_get(obj, key, default=None):
                if isinstance(obj, dict):
                    return obj.get(key, default)
                return getattr(obj, key, default)

            function_obj = safe_get(tool_call, "function", {})
            function_name = safe_get(function_obj, "name", "")
            function_args = safe_get(function_obj, "arguments", {})
            call_id = safe_get(tool_call, "id", "")

            base_path = (
                f"{SpanAttributes.LLM_INPUT_MESSAGES}."
                f"{message_index}.{MessageAttributes.MESSAGE_TOOL_CALLS}.{tool_index}"
            )

            set_attribute(f"{base_path}.{ToolCallAttributes.TOOL_CALL_FUNCTION_NAME}", function_name)
            set_attribute(f"{base_path}.{ToolCallAttributes.TOOL_CALL_FUNCTION_ARGUMENTS_JSON}", function_args)
            set_attribute(f"{base_path}.{ToolCallAttributes.TOOL_CALL_ID}", call_id)

        # Handle list of messages
        if isinstance(prompts, list):
            for message_index, message in enumerate(prompts):
                if not isinstance(message, dict):
                    continue

                role = message.get("role", "user")
                content = message.get("text") or message.get("content") or ""

                set_message_attribute(message_index, MessageAttributes.MESSAGE_ROLE, role)
                set_message_attribute(message_index, MessageAttributes.MESSAGE_CONTENT, content)

                tool_calls = message.get("tool_calls") or []
                if isinstance(tool_calls, list):
                    for tool_index, tool_call in enumerate(tool_calls):
                        set_tool_call_attributes(message_index, tool_index, tool_call)

        # Handle single dict or plain string prompt
        elif isinstance(prompts, (dict, str)):
            set_message_attribute(0, MessageAttributes.MESSAGE_CONTENT, prompts)
            set_message_attribute(0, MessageAttributes.MESSAGE_ROLE, "user")

        return attributes
