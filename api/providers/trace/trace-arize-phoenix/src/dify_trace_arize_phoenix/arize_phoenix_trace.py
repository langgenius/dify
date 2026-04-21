import hashlib
import json
import logging
import operator
import os
import traceback
from datetime import datetime, timedelta
from typing import Any, Union, cast
from urllib.parse import urlparse

from openinference.semconv.trace import (
    OpenInferenceSpanKindValues,
    SpanAttributes,
)
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter as GrpcOTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter as HttpOTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.semconv.attributes import exception_attributes
from opentelemetry.trace import Span, SpanContext, Status, StatusCode, TraceFlags, TraceState, use_span
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.util.types import AttributeValue
from sqlalchemy import select, text

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
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from extensions.ext_database import db
from graphon.enums import WorkflowNodeExecutionStatus
from models.model import EndUser, MessageFile
from models.workflow import WorkflowNodeExecutionModel

logger = logging.getLogger(__name__)


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
    """Convert datetime to nanoseconds since epoch. If None, use current time."""
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


def string_to_trace_id128(string: str | None) -> int:
    """
    Convert any input string into a stable 128-bit integer trace ID.

    This uses SHA-256 hashing and takes the first 16 bytes (128 bits) of the digest.
    It's suitable for generating consistent, unique identifiers from strings.
    """
    if string is None:
        string = ""
    hash_object = hashlib.sha256(string.encode())

    # Take the first 16 bytes (128 bits) of the hash digest
    digest = hash_object.digest()[:16]

    # Convert to a 128-bit integer
    return int.from_bytes(digest, byteorder="big")


def string_to_span_id64(string: str | None) -> int:
    """
    Convert any input string into a stable 64-bit integer span ID.

    This uses SHA-256 hashing and takes the first 8 bytes (64 bits) of the digest.
    Generates consistent span IDs from workflow_run_id or node identifiers.
    """
    if string is None:
        string = ""
    hash_object = hashlib.sha256(string.encode())

    # Take the first 8 bytes (64 bits) of the hash digest
    digest = hash_object.digest()[:8]

    # Convert to a 64-bit integer
    return int.from_bytes(digest, byteorder="big")


_NODE_TYPE_TO_SPAN_KIND: dict[str, OpenInferenceSpanKindValues] = {
    "llm": OpenInferenceSpanKindValues.LLM,
    "knowledge-retrieval": OpenInferenceSpanKindValues.RETRIEVER,
    "tool": OpenInferenceSpanKindValues.TOOL,
    "agent": OpenInferenceSpanKindValues.AGENT,
}


def _get_node_span_kind(node_type: str) -> OpenInferenceSpanKindValues:
    """Return the OpenInference span kind for a given workflow node type."""
    return _NODE_TYPE_TO_SPAN_KIND.get(node_type, OpenInferenceSpanKindValues.CHAIN)


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
        self.child_workflow_parent_contexts: dict[str, dict[str, Any]] = {}

    def trace(self, trace_info: BaseTraceInfo):
        logger.info("[Arize/Phoenix] Trace: %s", trace_info)
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
            # Check if it's a connectivity issue
            if "ConnectTimeout" in str(e) or "Connection" in str(e) or "timeout" in str(e).lower():
                logger.warning("[Arize/Phoenix] Phoenix server connectivity issue, skipping trace: %s", str(e))
                return  # Skip the trace instead of raising
            else:
                logger.error("[Arize/Phoenix] Error in the trace: %s", str(e), exc_info=True)
                raise

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        # Get app info for enhanced metadata
        app_info = self._get_app_info_from_workflow_run_id(trace_info.workflow_run_id or "")

        workflow_metadata = {
            "workflow_run_id": trace_info.workflow_run_id or "",
            "message_id": trace_info.message_id or "",
            "workflow_app_log_id": trace_info.workflow_app_log_id or "",
            "app_id": app_info["app_id"],
            "app_name": app_info["app_name"],
            "status": trace_info.workflow_run_status or "",
            "status_message": trace_info.error or "",
            "level": "ERROR" if trace_info.error else "DEFAULT",
            "total_tokens": trace_info.total_tokens or 0,
        }
        workflow_metadata.update(trace_info.metadata)

        # Check if this is a child workflow called as a tool
        parent_trace_context = self._get_parent_workflow_context(trace_info)

        parent_span_context: SpanContext | None = None
        if parent_trace_context:
            parent_span_context = cast(SpanContext, parent_trace_context["parent_span_context"])

            workflow_metadata["nested_workflow"] = "true"
            workflow_metadata["parent_trace_id"] = hex(parent_span_context.trace_id)
            workflow_metadata["parent_tool_span_id"] = hex(parent_span_context.span_id)

            logger.info("[Arize/Phoenix] Child workflow nesting under parent tool in single execution flow")
        else:
            workflow_metadata["nested_workflow"] = "false"

        # Create descriptive workflow span name based on execution flow
        app_name_clean = app_info["app_name"].replace(" ", "_").replace("-", "_")[:20]
        workflow_id_short = trace_info.workflow_run_id[:8] if trace_info.workflow_run_id else "unknown"

        if parent_trace_context:
            # Child workflow nested under parent tool - use descriptive nested name
            parent_tool_name = str(parent_trace_context.get("workflow_tool_name", "UnknownTool"))
            if parent_tool_name and parent_tool_name not in ["workflow", "unknown", "UnknownTool", ""]:
                parent_tool_clean = parent_tool_name.replace(" ", "_").replace("-", "_")[:15]
                workflow_span_name = "nested_{}_{}_{}".format(app_name_clean, parent_tool_clean, workflow_id_short)
            else:
                workflow_span_name = "nested_{}_{}".format(app_name_clean, workflow_id_short)
        else:
            # Root workflow - this is the main execution flow
            workflow_span_name = "{}_{}".format(app_name_clean, workflow_id_short)

        logger.info(
            "[Arize/Phoenix] Creating workflow span: %s (%sworkflow)",
            workflow_span_name,
            "nested " if parent_trace_context else "main ",
        )

        # Create workflow span attributes with nested context
        import json as json_module  # Avoid any local variable conflicts

        workflow_attributes = {
            SpanAttributes.INPUT_VALUE: json_module.dumps(trace_info.workflow_run_inputs, ensure_ascii=False),
            SpanAttributes.OUTPUT_VALUE: json_module.dumps(trace_info.workflow_run_outputs, ensure_ascii=False),
            SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
            SpanAttributes.METADATA: json_module.dumps(workflow_metadata, ensure_ascii=False),
            SpanAttributes.SESSION_ID: trace_info.conversation_id or trace_info.workflow_id or "",
        }

        # Set up proper parent context for nesting child workflows under parent tools
        if parent_trace_context:
            assert parent_span_context is not None
            workflow_context_parent = trace.set_span_in_context(trace.NonRecordingSpan(parent_span_context))

            logger.info(
                "[Arize/Phoenix] Child workflow will nest under parent tool span: %s", hex(parent_span_context.span_id)
            )
        else:
            workflow_context_parent = None

        # Use with statement to properly set span context hierarchy
        workflow_span = self.tracer.start_span(
            name=workflow_span_name,
            attributes=workflow_attributes,
            start_time=datetime_to_nanos(trace_info.start_time),
            context=workflow_context_parent,
        )

        # Set workflow span as current context for child spans
        workflow_context = trace.set_span_in_context(workflow_span)

        try:
            # Process workflow nodes
            nodes = self._get_workflow_nodes(trace_info.workflow_run_id)
            logger.info("[Arize/Phoenix] Processing %s workflow nodes", len(nodes))

            # Get the original workflow graph to understand proper relationships
            workflow_graph = self._get_workflow_graph(trace_info.workflow_run_id)

            # Build comprehensive hierarchy using both graph and execution data
            if workflow_graph:
                hierarchy_map, _, execution_context = self._build_comprehensive_hierarchy(workflow_graph, nodes)
            else:
                hierarchy_map, _, execution_context = {}, {}, {}

            # Store created spans by node_id for hierarchy building
            node_spans: dict[str, Span] = {}

            # Enhanced node sorting: First by status (succeeded/failed first), then by index, then by created_at
            # This ensures completed nodes are processed before failed/pending ones
            def sort_nodes_key(node):
                # Priority: succeeded > running > failed > other
                status_priority = {"succeeded": 0, "running": 1, "failed": 2, "stopped": 3}
                status_val = status_priority.get(getattr(node, "status", "other"), 4)
                index_val = getattr(node, "index", 999)  # Large number for nodes without index
                created_time = getattr(node, "created_at", datetime.now())

                return (status_val, index_val, created_time)

            sorted_nodes = sorted(nodes, key=sort_nodes_key)

            # Debug: Log node processing order
            logger.info("[Arize/Phoenix] Node processing order:")
            for i, node in enumerate(sorted_nodes[:10]):  # Log first 10
                logger.info(
                    "  %s: %s (type=%s, status=%s, index=%s)",
                    i + 1,
                    node.id[:8],
                    node.node_type,
                    getattr(node, "status", "unknown"),
                    getattr(node, "index", "none"),
                )

            for node_execution in sorted_nodes:
                try:
                    logger.debug(
                        "[Arize/Phoenix] Processing node %s of type %s", node_execution.id, node_execution.node_type
                    )
                    created_at = node_execution.created_at or datetime.now()
                    elapsed_time = node_execution.elapsed_time or 0.0
                    finished_at = created_at + timedelta(seconds=elapsed_time)
                    child_workflow_id = None

                    try:
                        process_data = json.loads(node_execution.process_data) if node_execution.process_data else {}
                    except (json.JSONDecodeError, TypeError):
                        process_data = {}
                        logger.warning("[Arize/Phoenix] Invalid process_data JSON for node %s", node_execution.id)

                    # Enhanced metadata with execution context and decision paths
                    node_metadata = {
                        "node_id": node_execution.id,
                        "graph_node_id": getattr(node_execution, "node_id", node_execution.id),
                        "node_type": node_execution.node_type,
                        "node_status": node_execution.status,
                        "tenant_id": node_execution.tenant_id,
                        "app_id": node_execution.app_id,
                        "app_name": node_execution.title,
                        "status": node_execution.status,
                        "level": "ERROR" if node_execution.status != "succeeded" else "DEFAULT",
                        "node_index": getattr(node_execution, "index", 0),
                        "predecessor_node_id": getattr(node_execution, "predecessor_node_id", None),
                        "execution_order": getattr(node_execution, "index", 0),
                    }

                    # Add decision path information for classifiers and if/else nodes
                    if node_execution.node_type in ["question-classifier", "if-else"]:
                        decision_output = self._extract_decision_output(node_execution)
                        if decision_output:
                            if node_execution.node_type == "question-classifier":
                                node_metadata["decision_class_id"] = decision_output.get("class_id", "")
                                node_metadata["decision_class_name"] = decision_output.get("class_name", "")
                                node_metadata["decision_usage"] = decision_output.get("usage", {})
                            node_metadata["decision_output"] = decision_output

                    # Add loop context
                    if node_execution.node_type == "loop":
                        node_metadata["loop_type"] = "main_loop"
                        node_metadata["contains_children"] = "true"

                    # Add tool context with child workflow detection
                    if node_execution.node_type == "tool":
                        # Check if this tool triggers a child workflow
                        child_workflow_id = self._find_child_workflow_by_timing(node_execution)
                        if child_workflow_id:
                            node_metadata["child_workflow_run_id"] = child_workflow_id
                            node_metadata["nested_workflow"] = "true"
                            node_metadata["tool_triggers_workflow"] = "true"

                            # Add input context for workflow tools
                            if node_execution.inputs:
                                try:
                                    inputs = (
                                        json.loads(node_execution.inputs)
                                        if isinstance(node_execution.inputs, str)
                                        else node_execution.inputs
                                    )
                                    if isinstance(inputs, dict) and "topic" in inputs:
                                        node_metadata["workflow_input_topic"] = inputs["topic"]
                                except (json.JSONDecodeError, TypeError):
                                    logger.debug(
                                        "[Arize/Phoenix] Could not extract workflow topic for node %s",
                                        node_execution.id,
                                    )

                    if node_execution.execution_metadata:
                        try:
                            node_metadata.update(json.loads(node_execution.execution_metadata))
                        except (json.JSONDecodeError, TypeError):
                            logger.warning(
                                "[Arize/Phoenix] Invalid execution_metadata JSON for node %s", node_execution.id
                            )

                    # Determine the correct span kind based on node type
                    span_kind = _get_node_span_kind(node_execution.node_type).value
                    if node_execution.node_type == "llm":
                        provider = process_data.get("model_provider")
                        model = process_data.get("model_name")
                        if provider:
                            node_metadata["ls_provider"] = provider
                        if model:
                            node_metadata["ls_model_name"] = model

                        try:
                            outputs = json.loads(node_execution.outputs) if node_execution.outputs else {}
                            outputs_usage = outputs.get("usage", {})
                        except (json.JSONDecodeError, TypeError):
                            outputs_usage = {}
                            logger.warning("[Arize/Phoenix] Invalid outputs JSON for node %s", node_execution.id)

                        usage_data = process_data.get("usage", {}) if "usage" in process_data else outputs_usage
                        if usage_data:
                            node_metadata["total_tokens"] = usage_data.get("total_tokens", 0)
                            node_metadata["prompt_tokens"] = usage_data.get("prompt_tokens", 0)
                            node_metadata["completion_tokens"] = usage_data.get("completion_tokens", 0)
                    # Use workflow graph to determine proper hierarchy
                    node_id = getattr(node_execution, "node_id", node_execution.id)
                    node_type = node_execution.node_type
                    index_val = getattr(node_execution, "index", 0)

                    logger.info(
                        "[Arize/Phoenix] Node debug - id: %s, node_id: %s, type: %s, index: %s",
                        node_execution.id,
                        node_id,
                        node_type,
                        index_val,
                    )

                    # Enhanced parent context determination with multi-pass processing
                    parent_context = workflow_context  # Default to workflow as parent
                    parent_node_id = hierarchy_map.get(node_id)

                    # Special handling for different node types
                    if node_execution.node_type == "start":
                        # Start nodes are always direct children of workflow
                        parent_context = workflow_context
                        logger.info("[Arize/Phoenix] Node %s (start) is direct child of workflow", node_id)

                    elif node_execution.node_type == "end":
                        # End nodes should be children of the last executed non-end node or workflow
                        last_non_end_span = None
                        for existing_node_id, span in node_spans.items():
                            if existing_node_id != node_id:  # Not self
                                last_non_end_span = span

                        if last_non_end_span:
                            parent_context = trace.set_span_in_context(last_non_end_span)
                            logger.info("[Arize/Phoenix] Node %s (end) parented to last executed node", node_id)
                        else:
                            parent_context = workflow_context
                            logger.info("[Arize/Phoenix] Node %s (end) is direct child of workflow", node_id)

                    elif parent_node_id and parent_node_id in node_spans:
                        # This node has a parent in the workflow graph that's already processed
                        parent_span = node_spans[parent_node_id]
                        parent_context = trace.set_span_in_context(parent_span)
                        logger.info(
                            "[Arize/Phoenix] Node %s (%s) is child of %s (from graph)",
                            node_id,
                            node_type,
                            parent_node_id,
                        )

                    elif node_execution.node_type in ["tool", "llm", "http-request"]:
                        # For execution nodes, try to find logical parent from execution context
                        logical_parent = self._find_logical_parent_span(node_execution, node_spans, execution_context)
                        if logical_parent:
                            parent_context = trace.set_span_in_context(logical_parent)
                            logger.info("[Arize/Phoenix] Node %s (%s) found logical parent", node_id, node_type)
                        else:
                            parent_context = workflow_context
                            logger.info(
                                "[Arize/Phoenix] Node %s (%s) using workflow as parent (no logical parent)",
                                node_id,
                                node_type,
                            )

                    else:
                        # Default: use workflow as parent
                        parent_context = workflow_context
                        if parent_node_id:
                            logger.debug(
                                "[Arize/Phoenix] Node %s (%s) parent %s not yet processed, using workflow",
                                node_id,
                                node_type,
                                parent_node_id,
                            )
                        else:
                            logger.debug(
                                "[Arize/Phoenix] Node %s (%s) is direct child of workflow (no parent in graph)",
                                node_id,
                                node_type,
                            )

                    # Create descriptive span name using node_type and human-readable title
                    node_title_clean = getattr(node_execution, "title", "").replace(" ", "_").replace("-", "_")[:20]

                    # Smart naming: avoid repetition when title equals type
                    if node_title_clean:
                        # Check if title is just the node_type (case-insensitive)
                        if node_title_clean.lower() == node_execution.node_type.lower():
                            # Use just the node_type when title is redundant
                            base_name = node_execution.node_type
                        else:
                            # Use type_title when they're different
                            base_name = "{}_{}".format(node_execution.node_type, node_title_clean)
                    else:
                        # Fallback to ID if no title
                        base_name = "{}_{}".format(node_execution.node_type, node_execution.id[:8])

                    logger.debug(
                        "[Arize/Phoenix] Node naming: type='%s', title='%s' -> span='%s'",
                        node_execution.node_type,
                        getattr(node_execution, "title", ""),
                        base_name,
                    )

                    # Add decision context to span name
                    if node_execution.node_type == "question-classifier":
                        decision_output = self._extract_decision_output(node_execution)
                        if decision_output and decision_output.get("class_name"):
                            # Truncate class name for readability
                            class_name = decision_output["class_name"][:30].replace("\n", " ")
                            span_name = "{}_classifier_[{}]".format(base_name, class_name)
                        else:
                            span_name = "{}_classifier".format(base_name)
                    elif node_execution.node_type == "if-else":
                        span_name = "{}_condition".format(base_name)
                    elif node_execution.node_type == "loop":
                        span_name = "{}_main_loop".format(base_name)
                    elif node_execution.node_type == "llm":
                        # Add model info to LLM spans
                        model_name = process_data.get("model_name", "").replace("claude-3-", "c3-")
                        span_name = "{}_{}".format(base_name, model_name)
                    elif node_execution.node_type == "workflow":
                        # Enhanced naming for workflow tool calls
                        workflow_tool_name = self._get_workflow_tool_name(node_execution)
                        if workflow_tool_name:
                            span_name = "{}_tool_[{}]".format(base_name, workflow_tool_name[:20])
                        else:
                            span_name = "{}_workflow_tool".format(base_name)
                    elif node_execution.node_type == "tool":
                        # Check if this tool triggers a child workflow (via timing)
                        if child_workflow_id:
                            # ENHANCED NAMING SCHEME: Flexible based on tool name availability
                            tool_name = self._get_tool_name(node_execution)  # Don't default to "UnknownTool"

                            # Get child workflow app name for better linking
                            child_app_info = self._get_app_info_from_workflow_run_id(child_workflow_id)
                            child_workflow_name = (
                                child_app_info.get("app_name", "UnknownWorkflow")
                                .replace(" ", "_")
                                .replace("-", "_")[:15]
                            )
                            child_workflow_id_short = child_workflow_id[:8]

                            if tool_name and tool_name not in ["workflow", "unknown", "UnknownTool"]:
                                # Format: tool_{toolname}_{workflowname}_{corresponding_subworkflow_runid}
                                tool_name_clean = tool_name.replace(" ", "_").replace("-", "_")[:15]
                                span_name = "tool_{}_{}_{}_{}".format(
                                    base_name.replace("tool_", ""),  # Remove prefix to avoid tool_tool_
                                    tool_name_clean,
                                    child_workflow_name,
                                    child_workflow_id_short,
                                )
                                logger.info(
                                    "[Arize/Phoenix] Tool (with name) triggers child workflow - "
                                    "naming: %s -> child: %s",
                                    span_name,
                                    child_workflow_id[:8],
                                )
                            else:
                                # Skip tool_name if unknown, use: tool_{workflowname}_{corresponding_subworkflow_runid}
                                span_name = "tool_{}_{}_{}".format(
                                    base_name.replace("tool_", ""),  # Remove prefix
                                    child_workflow_name,
                                    child_workflow_id_short,
                                )
                                logger.info(
                                    "[Arize/Phoenix] Tool (no name) triggers child workflow - naming: %s -> child: %s",
                                    span_name,
                                    child_workflow_id[:8],
                                )
                        else:
                            # Regular tool
                            tool_name = self._get_tool_name(node_execution)
                            if tool_name:
                                span_name = "{}_[{}]".format(base_name, tool_name[:20])
                            else:
                                span_name = "{}_tool".format(base_name)
                    elif node_execution.node_type == "http-request":
                        # Enhanced naming for API calls
                        api_info = self._get_api_info(node_execution)
                        if api_info and api_info.get("method") and api_info.get("url"):
                            method = api_info["method"]
                            url_part = (
                                api_info["url"].split("/")[-1][:15] if "/" in api_info["url"] else api_info["url"][:15]
                            )
                            span_name = "{}_{}[{}]".format(base_name, method, url_part)
                        else:
                            span_name = "{}_api_call".format(base_name)
                    else:
                        span_name = base_name

                    logger.info("[Arize/Phoenix] Creating node span: %s", span_name)

                    # Create span with proper parent context
                    node_span = self.tracer.start_span(
                        name=span_name,
                        attributes={
                            SpanAttributes.INPUT_VALUE: node_execution.inputs or "{}",
                            SpanAttributes.OUTPUT_VALUE: node_execution.outputs or "{}",
                            SpanAttributes.OPENINFERENCE_SPAN_KIND: span_kind,
                            SpanAttributes.METADATA: json.dumps(node_metadata, ensure_ascii=False),
                            SpanAttributes.SESSION_ID: trace_info.conversation_id or "",
                        },
                        start_time=datetime_to_nanos(created_at),
                        context=parent_context,  # Use determined parent context
                    )

                    # Store the span for potential use as parent by successor nodes
                    node_id = getattr(node_execution, "node_id", node_execution.id)
                    node_spans[node_id] = node_span

                    if child_workflow_id:
                        workflow_tool_name = self._get_tool_name(node_execution) or self._get_workflow_tool_name(
                            node_execution
                        )
                        self._remember_child_workflow_parent_context(
                            child_workflow_run_id=child_workflow_id,
                            parent_span=node_span,
                            parent_workflow_run_id=trace_info.workflow_run_id or "",
                            workflow_tool_name=workflow_tool_name or "",
                        )
                        logger.info(
                            "[Arize/Phoenix] Tool %s will have child workflow %s nested under it",
                            node_execution.id[:8],
                            child_workflow_id[:8],
                        )

                    try:
                        if node_execution.node_type == "llm":
                            llm_attributes: dict[str, Any] = {
                                SpanAttributes.INPUT_VALUE: json.dumps(
                                    process_data.get("prompts", []), ensure_ascii=False
                                ),
                            }
                            provider = process_data.get("model_provider")
                            model = process_data.get("model_name")
                            if provider:
                                llm_attributes[SpanAttributes.LLM_PROVIDER] = provider
                            if model:
                                llm_attributes[SpanAttributes.LLM_MODEL_NAME] = model

                            try:
                                llm_outputs = json.loads(node_execution.outputs) if node_execution.outputs else {}
                                llm_outputs_usage = llm_outputs.get("usage", {})
                            except (json.JSONDecodeError, TypeError):
                                llm_outputs_usage = {}
                                logger.warning(
                                    "[Arize/Phoenix] Invalid LLM outputs JSON for node %s", node_execution.id
                                )

                            usage_data = process_data.get("usage", {}) if "usage" in process_data else llm_outputs_usage
                            if usage_data:
                                llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_TOTAL] = usage_data.get("total_tokens", 0)
                                llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_PROMPT] = usage_data.get(
                                    "prompt_tokens", 0
                                )
                                llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_COMPLETION] = usage_data.get(
                                    "completion_tokens", 0
                                )
                            llm_attributes.update(self._construct_llm_attributes(process_data.get("prompts", [])))
                            node_span.set_attributes(llm_attributes)
                    finally:
                        if node_execution.status == WorkflowNodeExecutionStatus.FAILED:
                            set_span_status(node_span, node_execution.error)
                        else:
                            set_span_status(node_span)
                        node_span.end(end_time=datetime_to_nanos(finished_at))

                except AttributeError:
                    logger.exception(
                        "[Arize/Phoenix] Node data access error for %s",
                        getattr(node_execution, "id", "unknown"),
                    )
                    continue
                except (json.JSONDecodeError, TypeError):
                    logger.exception(
                        "[Arize/Phoenix] JSON parsing error for node %s",
                        getattr(node_execution, "id", "unknown"),
                    )
                    continue
                except Exception:
                    logger.exception(
                        "[Arize/Phoenix] Unexpected error processing node %s",
                        getattr(node_execution, "id", "unknown"),
                    )
                    continue

            logger.info("[Arize/Phoenix] Completed workflow trace with %s nodes", len(nodes))

        except Exception as e:
            logger.error("[Arize/Phoenix] Workflow tracing failed: %s", e, exc_info=True)
            raise ValueError(f"[Arize/Phoenix] Workflow trace failed: {str(e)}")
        finally:
            if trace_info.error:
                set_span_status(workflow_span, trace_info.error)
            else:
                set_span_status(workflow_span)
            workflow_span.end(end_time=datetime_to_nanos(trace_info.end_time))

    def message_trace(self, trace_info: MessageTraceInfo):
        if trace_info.message_data is None:
            return

        file_list = cast(list[str], trace_info.file_list) or []
        message_file_data: MessageFile | None = trace_info.message_file_data

        if message_file_data is not None:
            file_url = f"{self.file_base_url}/{message_file_data.url}" if message_file_data else ""
            file_list.append(file_url)

        message_metadata = {
            "message_id": trace_info.message_id or "",
            "conversation_mode": str(trace_info.conversation_mode or ""),
            "user_id": trace_info.message_data.from_account_id or "",
            "file_list": json.dumps(file_list),
            "status": trace_info.message_data.status or "",
            "status_message": trace_info.error or "",
            "level": "ERROR" if trace_info.error else "DEFAULT",
            "total_tokens": trace_info.total_tokens or 0,
            "prompt_tokens": trace_info.message_tokens or 0,
            "completion_tokens": trace_info.answer_tokens or 0,
            "ls_provider": trace_info.message_data.model_provider or "",
            "ls_model_name": trace_info.message_data.model_id or "",
        }
        message_metadata.update(trace_info.metadata)

        # Add end user data if available
        if trace_info.message_data.from_end_user_id:
            end_user_data: EndUser | None = (
                db.session.query(EndUser).where(EndUser.id == trace_info.message_data.from_end_user_id).first()
            )
            if end_user_data is not None:
                message_metadata["end_user_id"] = end_user_data.session_id

        attributes = {
            SpanAttributes.INPUT_VALUE: trace_info.message_data.query,
            SpanAttributes.OUTPUT_VALUE: trace_info.message_data.answer,
            SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
            SpanAttributes.METADATA: json.dumps(message_metadata, ensure_ascii=False),
            SpanAttributes.SESSION_ID: trace_info.message_data.conversation_id,
        }

        trace_id = string_to_trace_id128(trace_info.trace_id or trace_info.message_id)
        message_span_id = string_to_span_id64(trace_info.message_id)
        span_context = SpanContext(
            trace_id=trace_id,
            span_id=message_span_id,
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
            trace_state=TraceState(),
        )

        message_span = self.tracer.start_span(
            name=TraceTaskName.MESSAGE_TRACE.value,
            attributes=attributes,
            start_time=datetime_to_nanos(trace_info.start_time),
            context=trace.set_span_in_context(trace.NonRecordingSpan(span_context)),
        )

        try:
            if trace_info.error:
                message_span.add_event(
                    "exception",
                    attributes={
                        "exception.message": trace_info.error,
                        "exception.type": "Error",
                        "exception.stacktrace": trace_info.error,
                    },
                )

            # Convert outputs to string based on type
            if isinstance(trace_info.outputs, dict | list):
                outputs_str = json.dumps(trace_info.outputs, ensure_ascii=False)
            elif isinstance(trace_info.outputs, str):
                outputs_str = trace_info.outputs
            else:
                outputs_str = str(trace_info.outputs)

            llm_attributes = {
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.LLM.value,
                SpanAttributes.INPUT_VALUE: json.dumps(trace_info.inputs, ensure_ascii=False),
                SpanAttributes.OUTPUT_VALUE: outputs_str,
                SpanAttributes.METADATA: json.dumps(message_metadata, ensure_ascii=False),
                SpanAttributes.SESSION_ID: trace_info.message_data.conversation_id,
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
                metadata_dict = json.loads(trace_info.message_data.message_metadata)
                model_params = metadata_dict.get("model_parameters")
                if model_params:
                    llm_attributes[SpanAttributes.LLM_INVOCATION_PARAMETERS] = json.dumps(model_params)

            llm_span = self.tracer.start_span(
                name="llm",
                attributes=llm_attributes,
                start_time=datetime_to_nanos(trace_info.start_time),
                context=trace.set_span_in_context(trace.NonRecordingSpan(span_context)),
            )

            try:
                if trace_info.error:
                    llm_span.add_event(
                        "exception",
                        attributes={
                            "exception.message": trace_info.error,
                            "exception.type": "Error",
                            "exception.stacktrace": trace_info.error,
                        },
                    )
            finally:
                if trace_info.error:
                    set_span_status(llm_span, trace_info.error)
                else:
                    set_span_status(llm_span)
                llm_span.end(end_time=datetime_to_nanos(trace_info.end_time))
        finally:
            if trace_info.error:
                set_span_status(message_span, trace_info.error)
            else:
                set_span_status(message_span)
            message_span.end(end_time=datetime_to_nanos(trace_info.end_time))

    def moderation_trace(self, trace_info: ModerationTraceInfo):
        if trace_info.message_data is None:
            return

        metadata = {
            "message_id": trace_info.message_id,
            "tool_name": "moderation",
            "status": trace_info.message_data.status,
            "status_message": trace_info.message_data.error or "",
            "level": "ERROR" if trace_info.message_data.error else "DEFAULT",
        }
        metadata.update(trace_info.metadata)

        trace_id = string_to_trace_id128(trace_info.message_id)
        span_id = string_to_span_id64(trace_info.message_id)
        context = SpanContext(
            trace_id=trace_id,
            span_id=span_id,
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
            trace_state=TraceState(),
        )

        span = self.tracer.start_span(
            name=TraceTaskName.MODERATION_TRACE.value,
            attributes={
                SpanAttributes.INPUT_VALUE: json.dumps(trace_info.inputs, ensure_ascii=False),
                SpanAttributes.OUTPUT_VALUE: json.dumps(
                    {
                        "action": trace_info.action,
                        "flagged": trace_info.flagged,
                        "preset_response": trace_info.preset_response,
                        "inputs": trace_info.inputs,
                    },
                    ensure_ascii=False,
                ),
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                SpanAttributes.METADATA: json.dumps(metadata, ensure_ascii=False),
            },
            start_time=datetime_to_nanos(trace_info.start_time),
            context=trace.set_span_in_context(trace.NonRecordingSpan(context)),
        )

        try:
            if trace_info.message_data.error:
                span.add_event(
                    "exception",
                    attributes={
                        "exception.message": trace_info.message_data.error,
                        "exception.type": "Error",
                        "exception.stacktrace": trace_info.message_data.error,
                    },
                )
        finally:
            if trace_info.message_data.error:
                set_span_status(span, trace_info.message_data.error)
            else:
                set_span_status(span)
            span.end(end_time=datetime_to_nanos(trace_info.end_time))

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        if trace_info.message_data is None:
            return

        start_time = trace_info.start_time or trace_info.message_data.created_at
        end_time = trace_info.end_time or trace_info.message_data.updated_at

        metadata = {
            "message_id": trace_info.message_id,
            "tool_name": "suggested_question",
            "status": trace_info.status,
            "status_message": trace_info.error or "",
            "level": "ERROR" if trace_info.error else "DEFAULT",
            "total_tokens": trace_info.total_tokens,
            "ls_provider": trace_info.model_provider or "",
            "ls_model_name": trace_info.model_id or "",
        }
        metadata.update(trace_info.metadata)

        trace_id = string_to_trace_id128(trace_info.message_id)
        span_id = string_to_span_id64(trace_info.message_id)
        context = SpanContext(
            trace_id=trace_id,
            span_id=span_id,
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
            trace_state=TraceState(),
        )

        span = self.tracer.start_span(
            name=TraceTaskName.SUGGESTED_QUESTION_TRACE.value,
            attributes={
                SpanAttributes.INPUT_VALUE: json.dumps(trace_info.inputs, ensure_ascii=False),
                SpanAttributes.OUTPUT_VALUE: json.dumps(trace_info.suggested_question, ensure_ascii=False),
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                SpanAttributes.METADATA: json.dumps(metadata, ensure_ascii=False),
            },
            start_time=datetime_to_nanos(start_time),
            context=trace.set_span_in_context(trace.NonRecordingSpan(context)),
        )

        try:
            if trace_info.error:
                span.add_event(
                    "exception",
                    attributes={
                        "exception.message": trace_info.error,
                        "exception.type": "Error",
                        "exception.stacktrace": trace_info.error,
                    },
                )
        finally:
            if trace_info.error:
                set_span_status(span, trace_info.error)
            else:
                set_span_status(span)
            span.end(end_time=datetime_to_nanos(end_time))

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            return

        start_time = trace_info.start_time or trace_info.message_data.created_at
        end_time = trace_info.end_time or trace_info.message_data.updated_at

        metadata = {
            "message_id": trace_info.message_id,
            "tool_name": "dataset_retrieval",
            "status": trace_info.message_data.status,
            "status_message": trace_info.message_data.error or "",
            "level": "ERROR" if trace_info.message_data.error else "DEFAULT",
            "ls_provider": trace_info.message_data.model_provider or "",
            "ls_model_name": trace_info.message_data.model_id or "",
        }
        metadata.update(trace_info.metadata)

        trace_id = string_to_trace_id128(trace_info.message_id)
        span_id = string_to_span_id64(trace_info.message_id)
        context = SpanContext(
            trace_id=trace_id,
            span_id=span_id,
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
            trace_state=TraceState(),
        )

        span = self.tracer.start_span(
            name=TraceTaskName.DATASET_RETRIEVAL_TRACE.value,
            attributes={
                SpanAttributes.INPUT_VALUE: json.dumps(trace_info.inputs, ensure_ascii=False),
                SpanAttributes.OUTPUT_VALUE: json.dumps({"documents": trace_info.documents}, ensure_ascii=False),
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.RETRIEVER.value,
                SpanAttributes.METADATA: json.dumps(metadata, ensure_ascii=False),
                "start_time": start_time.isoformat() if start_time else "",
                "end_time": end_time.isoformat() if end_time else "",
            },
            start_time=datetime_to_nanos(start_time),
            context=trace.set_span_in_context(trace.NonRecordingSpan(context)),
        )

        try:
            if trace_info.message_data.error:
                span.add_event(
                    "exception",
                    attributes={
                        "exception.message": trace_info.message_data.error,
                        "exception.type": "Error",
                        "exception.stacktrace": trace_info.message_data.error,
                    },
                )
        finally:
            if trace_info.message_data.error:
                set_span_status(span, trace_info.message_data.error)
            else:
                set_span_status(span)
            span.end(end_time=datetime_to_nanos(end_time))

    def tool_trace(self, trace_info: ToolTraceInfo):
        if trace_info.message_data is None:
            logger.warning("[Arize/Phoenix] Message data is None, skipping tool trace.")
            return

        metadata = {
            "message_id": trace_info.message_id,
            "tool_config": json.dumps(trace_info.tool_config, ensure_ascii=False),
        }

        trace_id = string_to_trace_id128(trace_info.message_id)
        tool_span_id = string_to_span_id64(f"{trace_info.message_id}_{trace_info.tool_name}")
        logger.info("[Arize/Phoenix] Creating tool trace with trace_id: %s, span_id: %s", trace_id, tool_span_id)

        # Create span context with the same trace_id as the parent
        # todo: Create with the appropriate parent span context, so that the tool span is
        # a child of the appropriate span (e.g. message span)
        span_context = SpanContext(
            trace_id=trace_id,
            span_id=tool_span_id,
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
            trace_state=TraceState(),
        )

        tool_params_str = (
            json.dumps(trace_info.tool_parameters, ensure_ascii=False)
            if isinstance(trace_info.tool_parameters, dict)
            else str(trace_info.tool_parameters)
        )

        span = self.tracer.start_span(
            name=trace_info.tool_name,
            attributes={
                SpanAttributes.INPUT_VALUE: json.dumps(trace_info.tool_inputs, ensure_ascii=False),
                SpanAttributes.OUTPUT_VALUE: trace_info.tool_outputs,
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.TOOL.value,
                SpanAttributes.METADATA: json.dumps(metadata, ensure_ascii=False),
                SpanAttributes.TOOL_NAME: trace_info.tool_name,
                SpanAttributes.TOOL_PARAMETERS: tool_params_str,
            },
            start_time=datetime_to_nanos(trace_info.start_time),
            context=trace.set_span_in_context(trace.NonRecordingSpan(span_context)),
        )

        try:
            if trace_info.error:
                span.add_event(
                    "exception",
                    attributes={
                        "exception.message": trace_info.error,
                        "exception.type": "Error",
                        "exception.stacktrace": trace_info.error,
                    },
                )
        finally:
            if trace_info.error:
                set_span_status(span, trace_info.error)
            else:
                set_span_status(span)
            span.end(end_time=datetime_to_nanos(trace_info.end_time))

    def generate_name_trace(self, trace_info: GenerateNameTraceInfo):
        if trace_info.message_data is None:
            return

        metadata = {
            "project_name": self.project,
            "message_id": trace_info.message_id,
            "status": trace_info.message_data.status,
            "status_message": trace_info.message_data.error or "",
            "level": "ERROR" if trace_info.message_data.error else "DEFAULT",
        }
        metadata.update(trace_info.metadata)

        trace_id = string_to_trace_id128(trace_info.message_id)
        span_id = string_to_span_id64(trace_info.message_id)
        context = SpanContext(
            trace_id=trace_id,
            span_id=span_id,
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
            trace_state=TraceState(),
        )

        span = self.tracer.start_span(
            name=TraceTaskName.GENERATE_NAME_TRACE.value,
            attributes={
                SpanAttributes.INPUT_VALUE: json.dumps(trace_info.inputs, ensure_ascii=False),
                SpanAttributes.OUTPUT_VALUE: json.dumps(trace_info.outputs, ensure_ascii=False),
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                SpanAttributes.METADATA: json.dumps(metadata, ensure_ascii=False),
                SpanAttributes.SESSION_ID: trace_info.message_data.conversation_id,
                "start_time": trace_info.start_time.isoformat() if trace_info.start_time else "",
                "end_time": trace_info.end_time.isoformat() if trace_info.end_time else "",
            },
            start_time=datetime_to_nanos(trace_info.start_time),
            context=trace.set_span_in_context(trace.NonRecordingSpan(context)),
        )

        try:
            if trace_info.message_data.error:
                span.add_event(
                    "exception",
                    attributes={
                        "exception.message": trace_info.message_data.error,
                        "exception.type": "Error",
                        "exception.stacktrace": trace_info.message_data.error,
                    },
                )
        finally:
            if trace_info.message_data.error:
                set_span_status(span, trace_info.message_data.error)
            else:
                set_span_status(span)
            span.end(end_time=datetime_to_nanos(trace_info.end_time))

    def api_check(self):
        try:
            with self.tracer.start_span("api_check") as span:
                span.set_attribute("test", "true")
            return True
        except Exception as e:
            logger.info("[Arize/Phoenix] API check failed: %s", str(e), exc_info=True)
            raise ValueError(f"[Arize/Phoenix] API check failed: {str(e)}")

    def ensure_root_span(self, dify_trace_id: str | None):
        """Ensure a unique root span exists for the given Dify trace ID."""
        if str(dify_trace_id) not in self.dify_trace_ids:
            self.carrier: dict[str, str] = {}

            root_span = self.tracer.start_span(name="Dify")
            root_span.set_attribute(SpanAttributes.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKindValues.CHAIN.value)
            root_span.set_attribute("dify_project_name", str(self.project))
            root_span.set_attribute("dify_trace_id", str(dify_trace_id))

            with use_span(root_span, end_on_exit=False):
                self.propagator.inject(carrier=self.carrier)

            set_span_status(root_span)
            root_span.end()
            self.dify_trace_ids.add(str(dify_trace_id))

    def get_project_url(self):
        try:
            if self.arize_phoenix_config.endpoint == "https://otlp.arize.com":
                return "https://app.arize.com/"
            else:
                return f"{self.arize_phoenix_config.endpoint}/projects/"
        except Exception as e:
            logger.info("[Arize/Phoenix] Get run url failed: %s", str(e), exc_info=True)
            raise ValueError(f"[Arize/Phoenix] Get run url failed: {str(e)}")

    def _get_workflow_nodes(self, workflow_run_id: str):
        """Helper method to get workflow nodes"""
        workflow_nodes = (
            db.session.execute(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id)
            )
            .scalars()
            .all()
        )

        # Debug: Check what we're actually getting
        logger.info("[Arize/Phoenix] Query returned %s nodes", len(workflow_nodes))
        if workflow_nodes:
            first_node = workflow_nodes[0]
            logger.info("[Arize/Phoenix] First node type: %s", type(first_node))
            logger.info("[Arize/Phoenix] First node value: %s", first_node)

        return workflow_nodes

    def _get_workflow_graph(self, workflow_run_id: str):
        """Get the original workflow graph to understand node relationships"""
        try:
            # Test database connectivity first
            logger.info("[Arize/Phoenix] Testing database access for workflow_run_id: %s", workflow_run_id)

            # Test basic database connection
            test_result = db.session.execute(select(text("1"))).scalar()
            logger.info("[Arize/Phoenix] Database connection test result: %s", test_result)

            # Import here to avoid circular imports
            from models.workflow import Workflow, WorkflowRun

            # Test WorkflowRun table access
            logger.info("[Arize/Phoenix] Attempting to query workflow_runs table...")
            workflow_run = (
                db.session.execute(select(WorkflowRun).where(WorkflowRun.id == workflow_run_id)).scalars().first()
            )

            if not workflow_run:
                # Try to find any workflow runs to verify table access
                logger.info("[Arize/Phoenix] Specific workflow run not found, checking if table has any records...")
                any_run = db.session.execute(select(WorkflowRun).limit(1)).scalars().first()
                if any_run:
                    logger.info("[Arize/Phoenix] WorkflowRun table accessible, but run %s not found", workflow_run_id)
                else:
                    logger.info("[Arize/Phoenix] WorkflowRun table appears empty or inaccessible")
                return None

            logger.info("[Arize/Phoenix] Found workflow run, workflow_id: %s", workflow_run.workflow_id)

            # Test Workflow table access
            logger.info("[Arize/Phoenix] Attempting to query workflows table...")
            workflow = (
                db.session.execute(select(Workflow).where(Workflow.id == workflow_run.workflow_id)).scalars().first()
            )

            if not workflow:
                logger.warning("[Arize/Phoenix] Workflow not found for id: %s", workflow_run.workflow_id)
                return None

            if not workflow.graph:
                logger.warning("[Arize/Phoenix] Workflow graph is empty for workflow: %s", workflow_run.workflow_id)
                return None

            logger.info(
                "[Arize/Phoenix] Found workflow graph, type: %s, length: %s",
                type(workflow.graph),
                len(str(workflow.graph)),
            )

            import json

            graph = json.loads(workflow.graph) if isinstance(workflow.graph, str) else workflow.graph
            logger.info(
                "[Arize/Phoenix] Parsed workflow graph with %s nodes, %s edges",
                len(graph.get("nodes", [])),
                len(graph.get("edges", [])),
            )

            return graph

        except Exception as e:
            logger.error("[Arize/Phoenix] Failed to get workflow graph: %s", str(e), exc_info=True)
            return None

    def _build_comprehensive_hierarchy(self, workflow_graph, execution_nodes):
        """Build comprehensive hierarchy using both graph design AND execution data"""
        hierarchy_map = {}
        node_mapping = {}
        execution_context = {}

        # 1. Build graph-based relationships
        if workflow_graph and "edges" in workflow_graph:
            for edge in workflow_graph["edges"]:
                source = edge.get("source")
                target = edge.get("target")
                if source and target:
                    hierarchy_map[target] = source

        # 2. Map execution nodes to graph nodes
        for exec_node in execution_nodes:
            node_id = getattr(exec_node, "node_id", exec_node.id)
            exec_id = exec_node.id
            node_mapping[exec_id] = node_id

            # Store execution context keyed by the same node identifier used in node_spans.
            execution_context[node_id] = {
                "node_type": exec_node.node_type,
                "status": exec_node.status,
                "index": getattr(exec_node, "index", 0),
                "created_at": exec_node.created_at,
            }

        # 3. Handle decision node outputs for conditional hierarchy
        decision_relationships = self._resolve_decision_paths(execution_nodes, hierarchy_map)
        hierarchy_map.update(decision_relationships)

        # 4. Handle loop-based execution
        loop_relationships = self._resolve_loop_hierarchy(execution_nodes, workflow_graph)
        hierarchy_map.update(loop_relationships)

        logger.info("[Arize/Phoenix] Built comprehensive hierarchy:")
        logger.info("  Graph relationships: %s", len(hierarchy_map))
        logger.info("  Execution mappings: %s", len(node_mapping))
        logger.info("  Decision paths: %s", len(decision_relationships))
        logger.info("  Loop relationships: %s", len(loop_relationships))

        return hierarchy_map, node_mapping, execution_context

    def _get_parent_workflow_context(self, trace_info):
        """Return verified parent workflow context for nested workflow traces.

        Parentage is created only when an actual exported parent span context is
        available, either from explicit metadata or from a tool span captured
        while processing the parent workflow in this process. If lineage cannot
        be verified, the workflow is exported as a root span.
        """
        try:
            workflow_run_id = trace_info.workflow_run_id or ""
            if workflow_run_id in self.child_workflow_parent_contexts:
                return self.child_workflow_parent_contexts[workflow_run_id]

            if hasattr(trace_info, "metadata") and trace_info.metadata:
                parent_trace_id = trace_info.metadata.get("parent_trace_id")
                parent_span_id = trace_info.metadata.get("parent_span_id")

                if parent_trace_id and parent_span_id:
                    trace_id = self._coerce_span_id_value(parent_trace_id)
                    span_id = self._coerce_span_id_value(parent_span_id)
                    if trace_id is None or span_id is None:
                        return None
                    return {
                        "trace_id": trace_id,
                        "parent_span_context": SpanContext(
                            trace_id=trace_id,
                            span_id=span_id,
                            is_remote=False,
                            trace_flags=TraceFlags(TraceFlags.SAMPLED),
                            trace_state=TraceState(),
                        ),
                        "workflow_tool_name": trace_info.metadata.get("workflow_tool_name", ""),
                    }

        except Exception as e:
            logger.warning("[Arize/Phoenix] Could not determine parent workflow context: %s", str(e))

        return None

    def _remember_child_workflow_parent_context(
        self,
        child_workflow_run_id: str,
        parent_span: Span,
        parent_workflow_run_id: str,
        workflow_tool_name: str,
    ) -> None:
        """Store the exported parent span context for a child workflow run."""
        if not child_workflow_run_id:
            return

        parent_span_context = parent_span.get_span_context()
        self.child_workflow_parent_contexts[child_workflow_run_id] = {
            "trace_id": parent_span_context.trace_id,
            "parent_span_context": parent_span_context,
            "parent_workflow_run_id": parent_workflow_run_id,
            "workflow_tool_name": workflow_tool_name,
        }

    def _coerce_span_id_value(self, value: Any) -> int | None:
        """Parse decimal or hex span identifiers from metadata into integers."""
        if value is None:
            return None
        if isinstance(value, int):
            return value

        value_str = str(value).strip()
        if not value_str:
            return None

        base = 16 if value_str.lower().startswith("0x") else 10
        try:
            return int(value_str, base)
        except ValueError:
            logger.warning("[Arize/Phoenix] Invalid span identifier value: %s", value)
            return None

    def _find_parent_workflow_tool(self, child_workflow_run_id):
        """Find parent workflow that called this workflow as a tool"""
        try:
            from models.tools import WorkflowToolProvider
            from models.workflow import WorkflowNodeExecutionModel, WorkflowRun

            child_workflow_app_id = self._get_workflow_app_id(child_workflow_run_id)
            if not child_workflow_app_id:
                logger.warning("[Arize/Phoenix] Could not get app_id for workflow_run: %s", child_workflow_run_id[:8])
                return None

            child_run = (
                db.session.execute(select(WorkflowRun).where(WorkflowRun.id == child_workflow_run_id)).scalars().first()
            )

            if not child_run or not child_run.created_at:
                return None

            workflow_tool = (
                db.session.execute(
                    select(WorkflowToolProvider).where(
                        WorkflowToolProvider.app_id == child_workflow_app_id,
                        WorkflowToolProvider.tenant_id == child_run.tenant_id,
                    )
                )
                .scalars()
                .first()
            )

            if not workflow_tool:
                logger.debug("[Arize/Phoenix] App %s is not registered as a workflow tool", child_workflow_app_id[:8])
                return None

            logger.info(
                "[Arize/Phoenix] Found workflow tool registration: %s (app: %s)",
                workflow_tool.name,
                child_workflow_app_id[:8],
            )

            start_window = child_run.created_at - timedelta(seconds=60)  # Increased from 30s
            end_window = child_run.created_at + timedelta(seconds=15)  # Increased from 5s

            logger.debug(
                "[Arize/Phoenix] Child workflow timing - start: %s, search window: %s to %s",
                child_run.created_at,
                start_window,
                end_window,
            )

            potential_parent_tools = (
                db.session.execute(
                    select(WorkflowNodeExecutionModel)
                    .where(
                        WorkflowNodeExecutionModel.node_type.in_(["workflow", "tool"]),
                        WorkflowNodeExecutionModel.tenant_id == child_run.tenant_id,
                        WorkflowNodeExecutionModel.created_at >= start_window,
                        WorkflowNodeExecutionModel.created_at <= end_window,
                    )
                    .order_by(WorkflowNodeExecutionModel.created_at.desc())
                )
                .scalars()
                .all()
            )

            logger.info(
                "[Arize/Phoenix] Found %s potential parent tool executions in time window for workflow '%s'",
                len(potential_parent_tools),
                workflow_tool.name,
            )

            # Debug: Log details of each potential parent tool
            for i, tool in enumerate(potential_parent_tools[:5]):  # Log first 5 only
                try:
                    inputs = json.loads(tool.inputs) if tool.inputs else {}
                    topic = inputs.get("topic", "No topic")
                    logger.debug(
                        "[Arize/Phoenix] Potential parent %s: node_id=%s, type=%s, topic='%s', time=%s",
                        i + 1,
                        tool.id[:8],
                        tool.node_type,
                        topic,
                        tool.created_at,
                    )
                except Exception:
                    logger.debug(
                        "[Arize/Phoenix] Potential parent %s: node_id=%s, type=%s, time=%s",
                        i + 1,
                        tool.id[:8],
                        tool.node_type,
                        tool.created_at,
                    )

            matching_parent_tools = [
                tool_node
                for tool_node in potential_parent_tools
                if self._tool_matches_child_workflow_lineage(
                    tool_node=tool_node,
                    workflow_tool=workflow_tool,
                    child_workflow_run_id=child_workflow_run_id,
                    child_workflow_app_id=child_workflow_app_id,
                )
            ]

            if not matching_parent_tools:
                logger.debug(
                    "[Arize/Phoenix] No verified parent tool found for child workflow %s",
                    child_workflow_run_id[:8],
                )
                return None

            matching_parent_tools.sort(
                key=lambda tool_node: abs((child_run.created_at - tool_node.created_at).total_seconds())
            )
            tool_node = matching_parent_tools[0]
            parent_run_id = tool_node.workflow_run_id or ""
            if not parent_run_id:
                return None
            parent_app_info = self._get_app_info_from_workflow_run_id(parent_run_id)

            logger.info(
                "[Arize/Phoenix] Found verified parent workflow tool: %s -> child workflow: %s (tool: %s)",
                tool_node.id[:8],
                child_workflow_run_id[:8],
                workflow_tool.name,
            )

            return {
                "trace_id": string_to_trace_id128(parent_run_id),
                "parent_workflow_run_id": parent_run_id,
                "workflow_tool_name": workflow_tool.name,
                "parent_app_name": parent_app_info.get("app_name", "Unknown Parent App"),
            }

        except Exception as e:
            logger.warning("[Arize/Phoenix] Error finding parent workflow tool: %s", str(e))

        return None

    def _find_parent_tool_by_sql(self, child_workflow_run_id, potential_parent_tools):
        """Direct SQL approach to find which tool created this workflow"""
        try:
            from models.workflow import WorkflowRun

            # Get child workflow details
            child_run = (
                db.session.execute(select(WorkflowRun).where(WorkflowRun.id == child_workflow_run_id)).scalars().first()
            )

            if not child_run:
                return None

            logger.debug(
                "[Arize/Phoenix] Child workflow: app_id=%s, start_time=%s", child_run.app_id, child_run.created_at
            )

            # Look for tools that executed just before child workflow
            for tool_node in potential_parent_tools:
                if not tool_node.created_at:
                    continue

                # Calculate time difference
                time_diff = (child_run.created_at - tool_node.created_at).total_seconds()

                # Check if timing is reasonable (0-30 seconds after tool)
                if 0 <= time_diff <= 30:
                    # Check if this tool has workflow execution indicators
                    has_workflow_output = self._tool_has_workflow_output(tool_node, child_workflow_run_id)

                    if has_workflow_output:
                        parent_run_id = tool_node.workflow_run_id or ""
                        if not parent_run_id:
                            continue
                        parent_trace_id = string_to_trace_id128(parent_run_id)

                        logger.info(
                            "[Arize/Phoenix] SQL Direct Match: Tool %s -> Child workflow %s (%ss gap)",
                            tool_node.id[:8],
                            child_workflow_run_id[:8],
                            time_diff,
                        )

                        # Get parent app info
                        parent_app_info = self._get_app_info_from_workflow_run_id(parent_run_id)

                        return {
                            "trace_id": parent_trace_id,
                            "parent_span_id": string_to_span_id64(f"{parent_run_id}_{tool_node.id}"),
                            "parent_workflow_run_id": parent_run_id,  # Add parent workflow run ID
                            "workflow_tool_name": f"direct_sql_match_{tool_node.node_type}",
                            "parent_app_name": parent_app_info.get("app_name", "Unknown Parent App"),
                        }

            return None

        except Exception as e:
            logger.warning("[Arize/Phoenix] Error in SQL parent tool search: %s", str(e))
            return None

    def _tool_has_workflow_output(self, tool_node, target_workflow_run_id):
        """Check if tool node has indicators of creating a workflow"""
        try:
            # Check outputs for workflow execution evidence
            if hasattr(tool_node, "outputs") and tool_node.outputs:
                import json

                outputs = json.loads(tool_node.outputs) if isinstance(tool_node.outputs, str) else tool_node.outputs

                if isinstance(outputs, dict):
                    output_str = str(outputs)
                    # Direct match
                    if target_workflow_run_id in output_str:
                        logger.debug("[Arize/Phoenix] Tool %s output contains target workflow_run_id", tool_node.id[:8])
                        return True

                    # Pattern match for workflow indicators
                    workflow_indicators = ["workflow", "run_id", "execution", "started", "completed"]
                    if any(indicator in output_str.lower() for indicator in workflow_indicators):
                        logger.debug("[Arize/Phoenix] Tool %s output has workflow indicators", tool_node.id[:8])
                        return True

            # Check process_data for workflow creation
            if hasattr(tool_node, "process_data") and tool_node.process_data:
                import json

                process_data = (
                    json.loads(tool_node.process_data)
                    if isinstance(tool_node.process_data, str)
                    else tool_node.process_data
                )

                if isinstance(process_data, dict):
                    process_str = str(process_data)
                    if target_workflow_run_id in process_str:
                        logger.debug(
                            "[Arize/Phoenix] Tool %s process_data contains target workflow_run_id", tool_node.id[:8]
                        )
                        return True

            return False

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error checking tool workflow output: %s", str(e))
            return False

    def _get_workflow_app_id(self, workflow_run_id):
        """Get the app_id for a workflow_run_id"""
        try:
            from models.workflow import Workflow, WorkflowRun

            # Get workflow run -> workflow -> app_id
            workflow_run = (
                db.session.execute(select(WorkflowRun).where(WorkflowRun.id == workflow_run_id)).scalars().first()
            )

            if not workflow_run:
                return None

            workflow = (
                db.session.execute(select(Workflow).where(Workflow.id == workflow_run.workflow_id)).scalars().first()
            )

            if not workflow:
                return None

            return workflow.app_id

        except Exception as e:
            logger.warning("[Arize/Phoenix] Error getting app_id for workflow_run %s: %s", workflow_run_id[:8], str(e))
            return None

    def _tool_called_workflow_tool(self, tool_node, workflow_tool, child_workflow_run_id):
        """Check if a tool node execution called the specific workflow tool"""
        try:
            # Method 1: Check process_data for workflow tool references
            if hasattr(tool_node, "process_data") and tool_node.process_data:
                import json

                process_data = (
                    json.loads(tool_node.process_data)
                    if isinstance(tool_node.process_data, str)
                    else tool_node.process_data
                )

                if isinstance(process_data, dict):
                    # Look for workflow tool specific identifiers
                    tool_provider = process_data.get("tool_provider", "")
                    tool_name = process_data.get("tool_name", "")
                    app_id_ref = process_data.get("app_id", "")

                    # Check if this matches our workflow tool
                    if (
                        workflow_tool.name in tool_name
                        or workflow_tool.app_id == app_id_ref
                        or "workflow" in tool_provider.lower()
                    ):
                        logger.debug("[Arize/Phoenix] Tool %s matches workflow tool by process_data", tool_node.id[:8])
                        return True

            # Method 2: Check inputs for workflow tool references
            if hasattr(tool_node, "inputs") and tool_node.inputs:
                import json

                inputs = json.loads(tool_node.inputs) if isinstance(tool_node.inputs, str) else tool_node.inputs

                if isinstance(inputs, dict):
                    # Check for app_id or workflow references in inputs
                    if workflow_tool.app_id in str(inputs):
                        logger.debug(
                            "[Arize/Phoenix] Tool %s matches workflow tool by app_id in inputs", tool_node.id[:8]
                        )
                        return True

                    # Log for debugging
                    logger.debug("[Arize/Phoenix] Tool %s inputs checked, no app_id match", tool_node.id[:8])

            # Method 3: Check outputs for child workflow_run_id (MOST IMPORTANT)
            if hasattr(tool_node, "outputs") and tool_node.outputs:
                import json

                outputs = json.loads(tool_node.outputs) if isinstance(tool_node.outputs, str) else tool_node.outputs

                if isinstance(outputs, dict):
                    # Direct match: tool output contains this workflow_run_id
                    if child_workflow_run_id in str(outputs):
                        logger.info(
                            "[Arize/Phoenix] FOUND: Tool %s created child workflow %s (in outputs)",
                            tool_node.id[:8],
                            child_workflow_run_id[:8],
                        )
                        return True

                    # Check for workflow execution references in outputs
                    output_str = str(outputs).lower()
                    if any(key in output_str for key in ["workflow_run_id", "execution_id", "run_id"]):
                        logger.debug("[Arize/Phoenix] Tool %s has workflow references in outputs", tool_node.id[:8])
                        # Additional logging for debugging
                        logger.debug("[Arize/Phoenix] Tool outputs keys: %s", list(outputs.keys()))

            # Method 4: Enhanced process_data checking
            if hasattr(tool_node, "process_data") and tool_node.process_data:
                import json

                try:
                    process_data = (
                        json.loads(tool_node.process_data)
                        if isinstance(tool_node.process_data, str)
                        else tool_node.process_data
                    )

                    if isinstance(process_data, dict):
                        # Look for workflow execution metadata in process_data
                        if child_workflow_run_id in str(process_data):
                            logger.info(
                                "[Arize/Phoenix] FOUND: Tool %s created child workflow %s (in process_data)",
                                tool_node.id[:8],
                                child_workflow_run_id[:8],
                            )
                            return True

                except Exception as e:
                    logger.debug("[Arize/Phoenix] Could not parse process_data for tool %s: %s", tool_node.id[:8], e)

            # Method 4: Timing-based correlation (within 15 seconds)
            if hasattr(tool_node, "created_at") and tool_node.created_at:
                from models.workflow import WorkflowRun

                child_run = (
                    db.session.execute(select(WorkflowRun).where(WorkflowRun.id == child_workflow_run_id))
                    .scalars()
                    .first()
                )

                if child_run and child_run.created_at:
                    time_diff = (child_run.created_at - tool_node.created_at).total_seconds()
                    if 0 <= time_diff <= 15:  # Child started within 15 seconds after tool
                        logger.debug(
                            "[Arize/Phoenix] Tool %s matches by timing correlation (%ss)", tool_node.id[:8], time_diff
                        )
                        return True

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error checking tool-workflow correlation: %s", str(e))

        return False

    def _fallback_parent_tool_search(self, child_workflow_run_id):
        """Fallback to original timing-based search method"""
        try:
            from models.workflow import WorkflowNodeExecutionModel

            # Original method: look for recent tool/workflow nodes
            recent_workflow_tools = (
                db.session.execute(
                    select(WorkflowNodeExecutionModel)
                    .where(WorkflowNodeExecutionModel.node_type.in_(["workflow", "tool"]))
                    .order_by(WorkflowNodeExecutionModel.created_at.desc())
                    .limit(20)
                )
                .scalars()
                .all()
            )

            for tool_node in recent_workflow_tools:
                # Use original timing-based method
                if self._tool_created_workflow(tool_node, child_workflow_run_id):
                    parent_run_id = tool_node.workflow_run_id or ""
                    if not parent_run_id:
                        continue
                    parent_trace_id = string_to_trace_id128(parent_run_id)

                    logger.info(
                        "[Arize/Phoenix] Fallback: Found parent workflow tool: %s -> child: %s",
                        tool_node.id[:8],
                        child_workflow_run_id[:8],
                    )

                    # Get parent app name even for fallback cases
                    parent_app_info = self._get_app_info_from_workflow_run_id(parent_run_id)

                    return {
                        "trace_id": parent_trace_id,
                        "parent_span_id": string_to_span_id64(f"{parent_run_id}_{tool_node.id}"),
                        "parent_workflow_run_id": parent_run_id,  # Add parent workflow run ID
                        "workflow_tool_name": "unknown_workflow_tool",
                        "parent_app_name": parent_app_info.get("app_name", "Unknown Parent App"),
                    }

        except Exception as e:
            logger.warning("[Arize/Phoenix] Error in fallback parent tool search: %s", str(e))

        return None

    def _tool_created_workflow(self, tool_node, child_workflow_run_id):
        """Check if a tool node created a specific child workflow"""
        try:
            # Method 1: Check outputs for workflow reference
            if tool_node.outputs:
                import json

                outputs = json.loads(tool_node.outputs) if isinstance(tool_node.outputs, str) else tool_node.outputs

                # Check if outputs contain reference to the child workflow
                if isinstance(outputs, dict):
                    # Look for various workflow reference patterns
                    workflow_refs = [
                        outputs.get("workflow_run_id"),
                        outputs.get("app_id"),
                        outputs.get("run_id"),
                        outputs.get("execution_id"),
                    ]
                    if any(ref == child_workflow_run_id for ref in workflow_refs if ref):
                        return True

            # Method 2: Check process_data for workflow tool configuration
            if hasattr(tool_node, "process_data") and tool_node.process_data:
                import json

                process_data = (
                    json.loads(tool_node.process_data)
                    if isinstance(tool_node.process_data, str)
                    else tool_node.process_data
                )

                # Check if this tool is configured to call workflows
                if isinstance(process_data, dict):
                    tool_type = process_data.get("tool_type") or process_data.get("provider")
                    if tool_type and "workflow" in str(tool_type).lower():
                        # This is likely a workflow tool - check timing
                        return self._check_timing_relationship(tool_node, child_workflow_run_id)

            # Method 3: Check timing for any tool node (fallback)
            return self._check_timing_relationship(tool_node, child_workflow_run_id)

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error checking tool-workflow relationship: %s", str(e))

        return False

    def _check_timing_relationship(self, tool_node, child_workflow_run_id):
        """Check timing relationship between tool execution and child workflow start"""
        try:
            from models.workflow import WorkflowRun

            # Get the child workflow run start time
            child_run = (
                db.session.execute(select(WorkflowRun).where(WorkflowRun.id == child_workflow_run_id)).scalars().first()
            )

            if child_run and tool_node.created_at and child_run.created_at:
                time_diff = (child_run.created_at - tool_node.created_at).total_seconds()

                # Based on analysis: child workflows start within 15 seconds, often 0-1s
                if 0 <= time_diff <= 15:
                    logger.info(
                        "[Arize/Phoenix] Timing match: tool %s -> workflow %s (%ss delay)",
                        tool_node.id[:8],
                        child_workflow_run_id[:8],
                        time_diff,
                    )
                    return True

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error checking timing relationship: %s", str(e))

        return False

    def _find_child_workflow_by_timing(self, tool_node):
        """Find a child workflow only when tenant and lineage checks both pass."""
        try:
            from models.workflow import WorkflowRun

            if not tool_node.created_at:
                return None

            # Enhanced method: Check if this tool has already been associated with a child workflow
            # This prevents the same workflow from being tagged to multiple tools
            tool_node_id = tool_node.id

            # First, check outputs for direct workflow reference
            if hasattr(tool_node, "outputs") and tool_node.outputs:
                outputs = json.loads(tool_node.outputs) if isinstance(tool_node.outputs, str) else tool_node.outputs
                if isinstance(outputs, dict):
                    # Look for direct workflow_run_id reference in outputs
                    for key, value in outputs.items():
                        if "workflow_run_id" in str(key).lower() or "run_id" in str(key).lower():
                            potential_workflow_id = str(value)
                            if len(potential_workflow_id) > 30:  # Workflow IDs are long UUIDs
                                logger.info(
                                    "[Arize/Phoenix] Found direct workflow reference in tool %s outputs: %s",
                                    tool_node_id[:8],
                                    potential_workflow_id[:8],
                                )
                                return potential_workflow_id

            # Second, check process_data for workflow execution evidence
            if hasattr(tool_node, "process_data") and tool_node.process_data:
                process_data = (
                    json.loads(tool_node.process_data)
                    if isinstance(tool_node.process_data, str)
                    else tool_node.process_data
                )
                if isinstance(process_data, dict):
                    # Look for workflow execution metadata
                    for key, value in process_data.items():
                        if "workflow" in str(key).lower() and "run" in str(key).lower():
                            potential_workflow_id = str(value)
                            if len(potential_workflow_id) > 30:
                                logger.info(
                                    "[Arize/Phoenix] Found workflow reference in tool %s process_data: %s",
                                    tool_node_id[:8],
                                    potential_workflow_id[:8],
                                )
                                return potential_workflow_id

            candidate_app_ids = self._extract_workflow_app_ids_from_tool(tool_node)
            if not candidate_app_ids:
                return None

            potential_children = (
                db.session.execute(
                    select(WorkflowRun)
                    .where(
                        WorkflowRun.tenant_id == tool_node.tenant_id,
                        WorkflowRun.app_id.in_(candidate_app_ids),
                        WorkflowRun.created_at >= tool_node.created_at,
                        WorkflowRun.created_at <= tool_node.created_at + timedelta(seconds=15),
                    )
                    .order_by(WorkflowRun.created_at)
                )
                .scalars()
                .all()
            )

            if not potential_children:
                return None

            # Check if any of these workflows are already associated with other tools in this workflow
            tool_workflow_run_id = tool_node.workflow_run_id
            already_associated = set()

            # Get other tool nodes from the same workflow
            from models.workflow import WorkflowNodeExecutionModel

            other_tools = (
                db.session.execute(
                    select(WorkflowNodeExecutionModel).where(
                        WorkflowNodeExecutionModel.workflow_run_id == tool_workflow_run_id,
                        WorkflowNodeExecutionModel.node_type == "tool",
                        WorkflowNodeExecutionModel.id != tool_node_id,
                    )
                )
                .scalars()
                .all()
            )

            # Check what child workflows other tools have already claimed
            for other_tool in other_tools:
                if other_tool.created_at and other_tool.created_at <= tool_node.created_at:
                    # This tool executed before our tool, check its potential children
                    for child_run in potential_children:
                        time_diff = (child_run.created_at - other_tool.created_at).total_seconds()
                        if 0 <= time_diff <= 15:  # This child might belong to the earlier tool
                            already_associated.add(child_run.id)
                            logger.debug(
                                "[Arize/Phoenix] Child workflow %s already associated with earlier tool %s",
                                child_run.id[:8],
                                other_tool.id[:8],
                            )

            # Find the best available match that's not already associated
            best_match = None
            best_time_diff = float("inf")

            for child_run in potential_children:
                if child_run.id in already_associated:
                    continue
                if not self._workflow_run_matches_tool_lineage(tool_node, child_run):
                    continue

                # Only consider unassociated workflows that also match tool lineage
                if child_run.id not in already_associated:
                    time_diff = (child_run.created_at - tool_node.created_at).total_seconds()
                    if 0 <= time_diff < best_time_diff:
                        best_time_diff = time_diff
                        best_match = child_run

            if best_match and best_time_diff <= 15:
                logger.info(
                    "[Arize/Phoenix] Found unique child workflow: tool %s -> %s (%ss)",
                    tool_node.id[:8],
                    best_match.id[:8],
                    best_time_diff,
                )
                return best_match.id

            if potential_children:
                logger.debug(
                    "[Arize/Phoenix] Tool %s - all potential children already associated with other tools",
                    tool_node_id[:8],
                )

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error finding child workflow: %s", str(e))

        return None

    def _parse_json_mapping(self, payload: Any) -> dict[str, Any]:
        """Return a JSON object payload as a dictionary, or an empty dict."""
        if isinstance(payload, dict):
            return payload
        if isinstance(payload, str) and payload:
            try:
                parsed = json.loads(payload)
            except (json.JSONDecodeError, TypeError):
                return {}
            if isinstance(parsed, dict):
                return parsed
        return {}

    def _json_mapping_contains_value(self, payload: Any, expected_value: str) -> bool:
        """Check whether a JSON payload contains an expected string value."""
        if not expected_value:
            return False
        mapping = self._parse_json_mapping(payload)
        if not mapping:
            return False
        return expected_value in json.dumps(mapping, ensure_ascii=False)

    def _extract_workflow_app_ids_from_tool(self, tool_node) -> set[str]:
        """Extract referenced workflow app IDs from tool node payloads."""
        candidate_app_ids: set[str] = set()
        for payload in (tool_node.inputs, tool_node.outputs, tool_node.process_data):
            mapping = self._parse_json_mapping(payload)
            for key, value in mapping.items():
                key_lower = str(key).lower()
                if key_lower in {"app_id", "workflow_app_id"} and value:
                    candidate_app_ids.add(str(value))

        return candidate_app_ids

    def _workflow_run_matches_tool_lineage(self, tool_node, workflow_run) -> bool:
        """Verify a candidate workflow run belongs to the tool's declared workflow lineage."""
        if self._json_mapping_contains_value(tool_node.outputs, workflow_run.id):
            return True
        if self._json_mapping_contains_value(tool_node.process_data, workflow_run.id):
            return True

        candidate_app_ids = self._extract_workflow_app_ids_from_tool(tool_node)
        return workflow_run.app_id in candidate_app_ids

    def _find_parent_tools_by_timing(self, child_workflow_run_id):
        """Find parent tool nodes that might have triggered this workflow"""
        try:
            from models.workflow import WorkflowNodeExecutionModel, WorkflowRun

            # Get the child workflow start time
            child_run = (
                db.session.execute(select(WorkflowRun).where(WorkflowRun.id == child_workflow_run_id)).scalars().first()
            )

            if not child_run or not child_run.created_at:
                return []

            # Look for tool nodes that executed shortly before this workflow started
            start_window = child_run.created_at - timedelta(seconds=30)
            end_window = child_run.created_at + timedelta(seconds=5)

            potential_parent_tools = (
                db.session.execute(
                    select(WorkflowNodeExecutionModel)
                    .where(
                        WorkflowNodeExecutionModel.node_type == "tool",
                        WorkflowNodeExecutionModel.created_at >= start_window,
                        WorkflowNodeExecutionModel.created_at <= end_window,
                    )
                    .order_by(WorkflowNodeExecutionModel.created_at.desc())
                )
                .scalars()
                .all()
            )

            # Filter to tools that are close in timing
            matching_tools = []
            for tool in potential_parent_tools:
                if tool.created_at:
                    time_diff = (child_run.created_at - tool.created_at).total_seconds()
                    if 0 <= time_diff <= 15:  # Within 15 seconds before child start
                        matching_tools.append(tool.id)

            return matching_tools

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error finding parent tools: %s", str(e))
            return []

    def _get_parent_workflow_run_from_tool(self, tool_node_id):
        """Get the parent workflow run ID from a tool node ID"""
        try:
            from models.workflow import WorkflowNodeExecutionModel

            tool_node = (
                db.session.execute(
                    select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == tool_node_id)
                )
                .scalars()
                .first()
            )

            if tool_node:
                return tool_node.workflow_run_id

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error getting parent workflow run from tool: %s", str(e))

        return None

    def _find_logical_parent_span(self, node_execution, node_spans, execution_context):
        """Find logical parent span based on execution context and node relationships"""
        try:
            node_index = getattr(node_execution, "index", 0)

            # For tools and LLMs, try to find the most recent parent span
            # Look for nodes with lower index (executed before this one)
            potential_parents = []

            for span_node_id, span in node_spans.items():
                # Get execution context for this span
                if span_node_id in execution_context:
                    context = execution_context[span_node_id]
                    span_index = context.get("index", 0)

                    # This span executed before current node
                    if span_index < node_index:
                        potential_parents.append((span_index, span))

            # Return the most recent parent (highest index that's still lower than current)
            if potential_parents:
                potential_parents.sort(key=operator.itemgetter(0), reverse=True)
                return potential_parents[0][1]

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error finding logical parent: %s", str(e))

        return None

    def _get_workflow_tool_name(self, node_execution):
        """Extract workflow tool name from node execution data"""
        try:
            if hasattr(node_execution, "process_data") and node_execution.process_data:
                process_data = (
                    json.loads(node_execution.process_data)
                    if isinstance(node_execution.process_data, str)
                    else node_execution.process_data
                )

                # Look for workflow name in process data
                workflow_name = process_data.get("workflow_name") or process_data.get("app_name")
                if workflow_name:
                    return workflow_name

            # Fallback: Check inputs for workflow reference
            if node_execution.inputs:
                inputs = (
                    json.loads(node_execution.inputs)
                    if isinstance(node_execution.inputs, str)
                    else node_execution.inputs
                )

                workflow_ref = inputs.get("workflow_id") or inputs.get("app_id")
                if workflow_ref:
                    return "workflow_{}".format(workflow_ref[:8])

        except Exception as e:
            logger.debug("[Arize/Phoenix] Could not extract workflow tool name: %s", str(e))

        return None

    def _is_workflow_tool(self, node_execution):
        """Check if a tool node is actually calling a workflow"""
        try:
            if hasattr(node_execution, "process_data") and node_execution.process_data:
                process_data = (
                    json.loads(node_execution.process_data)
                    if isinstance(node_execution.process_data, str)
                    else node_execution.process_data
                )

                # Check for workflow tool indicators
                if isinstance(process_data, dict):
                    tool_type = (
                        process_data.get("tool_type")
                        or process_data.get("provider")
                        or process_data.get("tool_name", "")
                    )

                    # Look for workflow-related indicators
                    workflow_indicators = ["workflow", "app", "dify"]
                    if any(indicator in str(tool_type).lower() for indicator in workflow_indicators):
                        return True

                    # Check for app_id in tool configuration
                    if "app_id" in process_data or "workflow_id" in process_data:
                        return True

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error checking workflow tool indicators: %s", str(e))

        return False

    def _get_tool_name(self, node_execution):
        """Extract tool name from regular tool nodes - enhanced with database lookup"""
        try:
            # Method 1: Try to get tool name from process_data
            if hasattr(node_execution, "process_data") and node_execution.process_data:
                process_data = (
                    json.loads(node_execution.process_data)
                    if isinstance(node_execution.process_data, str)
                    else node_execution.process_data
                )

                if isinstance(process_data, dict):
                    # Try different name fields
                    tool_name = (
                        process_data.get("tool_name")
                        or process_data.get("provider")
                        or process_data.get("tool_type")
                        or process_data.get("name")
                    )

                    if tool_name and tool_name not in ["workflow", "unknown", ""]:
                        return str(tool_name).replace("_", " ").title()

                    # Method 2: Try to get from tool configuration in process_data
                    tool_config = process_data.get("tool_config", {})
                    if isinstance(tool_config, dict):
                        config_name = tool_config.get("name") or tool_config.get("provider")
                        if config_name and config_name not in ["workflow", "unknown", ""]:
                            return str(config_name).replace("_", " ").title()

            # Method 3: Try to extract from inputs if it's a workflow tool
            if hasattr(node_execution, "inputs") and node_execution.inputs:
                inputs = (
                    json.loads(node_execution.inputs)
                    if isinstance(node_execution.inputs, str)
                    else node_execution.inputs
                )
                if isinstance(inputs, dict):
                    # Check if there's a tool reference in inputs
                    app_id = inputs.get("app_id")
                    if app_id:
                        # Query the tools table for this app_id
                        tool_from_db = self._get_tool_name_from_db(app_id)
                        if tool_from_db:
                            return tool_from_db

            # Method 4: Try to get tool name from database using node metadata
            if hasattr(node_execution, "execution_metadata") and node_execution.execution_metadata:
                metadata = (
                    json.loads(node_execution.execution_metadata)
                    if isinstance(node_execution.execution_metadata, str)
                    else node_execution.execution_metadata
                )
                if isinstance(metadata, dict):
                    tool_provider_id = metadata.get("tool_provider_id")
                    if tool_provider_id:
                        tool_from_db = self._get_tool_name_by_provider_id(tool_provider_id)
                        if tool_from_db:
                            return tool_from_db

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error extracting tool name: %s", str(e))

        return None

    def _is_child_workflow(self, trace_info):
        """Determine if this is a child workflow based on parent context"""
        try:
            # Check if this workflow was called as a tool from another workflow
            parent_context = self._get_parent_workflow_context(trace_info)
            return parent_context is not None
        except Exception:
            return False

    def _ensure_child_workflows_processed(self, main_trace_info):
        """Ensure all child workflows are processed before main workflow"""
        try:
            # Get all tool nodes from this workflow that might trigger child workflows
            nodes = self._get_workflow_nodes(main_trace_info.workflow_run_id)
            tool_nodes = [n for n in nodes if n.node_type == "tool"]

            for tool_node in tool_nodes:
                child_workflow_id = self._find_child_workflow_by_timing(tool_node)
                if child_workflow_id:
                    # Check if child workflow trace exists
                    if not self._child_workflow_trace_exists(child_workflow_id):
                        logger.info(
                            "[Arize/Phoenix] Child workflow %s not yet traced, should be processed first",
                            child_workflow_id[:8],
                        )
                        # In a real implementation, you might queue the child workflow for processing
                        # For now, we'll log this as a processing order issue

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error ensuring child workflows processed: %s", str(e))

    def _child_workflow_trace_exists(self, workflow_run_id):
        """Check if a child workflow has already been traced"""
        try:
            # This could check a cache, database, or trace store
            # For now, we'll implement basic logic
            return False  # Placeholder - implement based on your trace storage
        except Exception:
            return False

    def _get_child_workflow_references(self, main_workflow_run_id):
        """Get references to child workflow traces for main workflow"""
        try:
            child_refs = []
            nodes = self._get_workflow_nodes(main_workflow_run_id)
            tool_nodes = [n for n in nodes if n.node_type == "tool"]

            for tool_node in tool_nodes:
                child_workflow_id = self._find_child_workflow_by_timing(tool_node)
                if child_workflow_id:
                    trace_info = self._get_child_workflow_trace_info(child_workflow_id)
                    if trace_info:
                        child_refs.append(
                            {
                                "child_workflow_run_id": child_workflow_id,
                                "child_trace_id": trace_info.get("trace_id", ""),
                                "calling_tool_id": tool_node.id,
                                "tool_index": getattr(tool_node, "index", 0),
                            }
                        )

            return child_refs

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error getting child workflow references: %s", str(e))
            return []

    def _get_child_workflow_trace_info(self, child_workflow_run_id):
        """Get trace information for a child workflow"""
        try:
            # This would typically query your trace store or cache
            # For now, we'll generate the expected trace/span IDs
            trace_id = string_to_trace_id128(child_workflow_run_id)
            span_id = string_to_span_id64(child_workflow_run_id)

            return {"trace_id": hex(trace_id), "span_id": hex(span_id), "workflow_run_id": child_workflow_run_id}

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error getting child workflow trace info: %s", str(e))
            return None

    def _get_tool_name_from_db(self, app_id):
        """Query tools table to get tool name by app_id"""
        try:
            from models.tools import WorkflowToolProvider

            tool_provider = (
                db.session.execute(select(WorkflowToolProvider).where(WorkflowToolProvider.app_id == app_id))
                .scalars()
                .first()
            )

            if tool_provider:
                return tool_provider.name

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error getting tool name from DB by app_id: %s", str(e))

        return None

    def _get_tool_name_by_provider_id(self, provider_id):
        """Query tools table to get tool name by provider_id"""
        try:
            # Try different tool tables based on provider type
            from models.tools import ApiToolProvider, BuiltinToolProvider, WorkflowToolProvider

            # Try workflow tool provider first
            workflow_tool = (
                db.session.execute(select(WorkflowToolProvider).where(WorkflowToolProvider.id == provider_id))
                .scalars()
                .first()
            )

            if workflow_tool:
                return workflow_tool.name

            # Try builtin tool provider
            builtin_tool = (
                db.session.execute(select(BuiltinToolProvider).where(BuiltinToolProvider.id == provider_id))
                .scalars()
                .first()
            )

            if builtin_tool:
                return builtin_tool.name

            # Try API tool provider
            api_tool = (
                db.session.execute(select(ApiToolProvider).where(ApiToolProvider.id == provider_id)).scalars().first()
            )

            if api_tool:
                return api_tool.name

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error getting tool name from DB by provider_id: %s", str(e))

        return None

    def _get_api_info(self, node_execution):
        """Extract API call information from HTTP request node"""
        try:
            if hasattr(node_execution, "process_data") and node_execution.process_data:
                process_data = (
                    json.loads(node_execution.process_data)
                    if isinstance(node_execution.process_data, str)
                    else node_execution.process_data
                )

                return {
                    "method": process_data.get("method", ""),
                    "url": process_data.get("url", ""),
                    "status_code": process_data.get("status_code", ""),
                }

        except Exception as e:
            logger.debug("[Arize/Phoenix] Error extracting API info: %s", str(e))

        return None

    def _resolve_decision_paths(self, execution_nodes, base_hierarchy):
        """Resolve actual execution paths from decision nodes (question-classifier, if-else)"""
        decision_relationships = {}

        # Group nodes by execution order
        sorted_nodes = sorted(execution_nodes, key=lambda n: getattr(n, "index", 0))

        for i, node in enumerate(sorted_nodes):
            if node.node_type in ["question-classifier", "if-else"]:
                # Find which nodes executed after this decision node
                next_nodes = sorted_nodes[i + 1 :]

                # Get the decision output to understand which path was taken
                decision_output = self._extract_decision_output(node)

                # For question-classifier, use class_id to determine next node
                if node.node_type == "question-classifier" and decision_output:
                    class_id = decision_output.get("class_id")
                    if class_id and next_nodes:
                        # The immediate next node is likely the one chosen by classifier
                        next_node = next_nodes[0]
                        next_node_id = getattr(next_node, "node_id", next_node.id)
                        decision_node_id = getattr(node, "node_id", node.id)

                        # Override hierarchy to show actual execution path
                        decision_relationships[next_node_id] = decision_node_id

                        logger.info(
                            "[Arize/Phoenix] Decision path: %s -> %s (class: %s)",
                            decision_node_id,
                            next_node_id,
                            decision_output.get("class_name", "")[:50],
                        )

                # For if-else, determine which branch was taken based on subsequent execution
                elif node.node_type == "if-else" and next_nodes:
                    # The next executed node shows which branch was taken
                    next_node = next_nodes[0]
                    next_node_id = getattr(next_node, "node_id", next_node.id)
                    decision_node_id = getattr(node, "node_id", node.id)

                    decision_relationships[next_node_id] = decision_node_id

                    logger.info("[Arize/Phoenix] IF/ELSE path: %s -> %s", decision_node_id, next_node_id)

        return decision_relationships

    def _extract_decision_output(self, node):
        """Extract decision output from question-classifier or if-else node"""
        try:
            if node.outputs:
                import json

                outputs = json.loads(node.outputs) if isinstance(node.outputs, str) else node.outputs
                return outputs
        except Exception as e:
            logger.warning("[Arize/Phoenix] Could not parse decision output for node %s: %s", node.id, str(e))
        return None

    def _resolve_loop_hierarchy(self, execution_nodes, workflow_graph):
        """Handle loop-based execution hierarchy with enhanced iteration detection"""
        loop_relationships = {}

        # Find loop and loop-start nodes
        loop_nodes = [n for n in execution_nodes if n.node_type == "loop"]
        iteration_nodes = [n for n in execution_nodes if n.node_type == "iteration"]  # Add iteration support

        # Handle traditional loops
        for loop_node in loop_nodes:
            loop_node_id = getattr(loop_node, "node_id", loop_node.id)
            loop_index = getattr(loop_node, "index", 0)

            logger.info("[Arize/Phoenix] Processing loop node: %s (index: %s)", loop_node_id, loop_index)

            # Find nodes that should be children of this loop
            # These are nodes that execute after the loop starts and before the loop ends
            for node in execution_nodes:
                if node != loop_node and node.node_type not in ["start", "end"]:
                    node_id = getattr(node, "node_id", node.id)

                    # Check if node is inside loop based on execution order and graph structure
                    if self._is_node_in_loop_execution(node, loop_node, execution_nodes, workflow_graph):
                        loop_relationships[node_id] = loop_node_id
                        logger.info("[Arize/Phoenix] Loop child: %s -> loop: %s", node_id, loop_node_id)

        # Handle iteration nodes (similar to loops but different node type)
        for iteration_node in iteration_nodes:
            iteration_node_id = getattr(iteration_node, "node_id", iteration_node.id)
            iteration_index = getattr(iteration_node, "index", 0)

            logger.info("[Arize/Phoenix] Processing iteration node: %s (index: %s)", iteration_node_id, iteration_index)

            # Find tools and other nodes that should be children of this iteration
            for node in execution_nodes:
                if node != iteration_node and node.node_type not in ["start", "end"]:
                    node_id = getattr(node, "node_id", node.id)

                    # For iterations, tools executed within the iteration timeframe should be children
                    if self._is_node_in_iteration_execution(node, iteration_node, execution_nodes):
                        loop_relationships[node_id] = iteration_node_id
                        logger.info("[Arize/Phoenix] Iteration child: %s -> iteration: %s", node_id, iteration_node_id)

        return loop_relationships

    def _is_node_in_loop(self, node_id, loop_node_id, workflow_graph):
        """Check if a node is inside a loop based on graph structure"""
        try:
            # Look for nodes with parentId matching the loop
            for graph_node in workflow_graph.get("nodes", []):
                if graph_node.get("id") == node_id:
                    parent_id = graph_node.get("parentId")
                    if parent_id == loop_node_id:
                        return True
            return False
        except Exception:
            return False

    def _is_node_in_loop_execution(self, node, loop_node, execution_nodes, workflow_graph):
        """Enhanced check if a node is inside a loop based on execution order and graph structure"""
        try:
            node_index = getattr(node, "index", 0)
            loop_index = getattr(loop_node, "index", 0)
            node_id = getattr(node, "node_id", node.id)
            loop_node_id = getattr(loop_node, "node_id", loop_node.id)

            # Method 1: Graph-based check (if available)
            if workflow_graph and self._is_node_in_loop(node_id, loop_node_id, workflow_graph):
                return True

            # Method 2: Execution order check
            # Nodes inside loops typically execute after the loop node
            if node_index > loop_index:
                # Check if there's a reasonable execution gap (not too far apart)
                if (node_index - loop_index) <= 50:  # Reasonable iteration range
                    return True

            # Method 3: Check for loop iteration patterns
            # Tools that execute multiple times are likely inside loops
            node_type = node.node_type
            if node_type in ["tool", "llm"] and self._node_appears_multiple_times(node, execution_nodes):
                return True

            return False

        except Exception:
            return False

    def _is_node_in_iteration_execution(self, node, iteration_node, execution_nodes):
        """Check if a node is inside an iteration based on execution timing"""
        try:
            node_created = getattr(node, "created_at", None)
            iteration_created = getattr(iteration_node, "created_at", None)

            if not node_created or not iteration_created:
                return False

            # Check if node executed during or shortly after the iteration
            time_diff = (node_created - iteration_created).total_seconds()

            # Node executed within reasonable time after iteration started (0 to 300 seconds)
            if 0 <= time_diff <= 300:
                return True

            return False

        except Exception:
            return False

    def _node_appears_multiple_times(self, node, execution_nodes):
        """Check if a node appears to be executed multiple times (indicating loop iteration)"""
        try:
            node_id = getattr(node, "node_id", node.id)
            count = 0

            for exec_node in execution_nodes:
                exec_node_id = getattr(exec_node, "node_id", exec_node.id)
                if exec_node_id == node_id:
                    count += 1

            return count > 1

        except Exception:
            return False

    def _construct_llm_attributes(self, prompts: dict | list | str | None) -> dict[str, Any]:
        """Helper method to construct LLM attributes with passed prompts."""
        attributes = {}
        if isinstance(prompts, list):
            for i, msg in enumerate(prompts):
                if isinstance(msg, dict):
                    attributes[f"{SpanAttributes.LLM_INPUT_MESSAGES}.{i}.message.content"] = msg.get(
                        "text", msg.get("content", "")
                    )
                    role = msg.get("role")
                    if role is not None:
                        attributes[f"{SpanAttributes.LLM_INPUT_MESSAGES}.{i}.message.role"] = role
                    # todo: handle assistant and tool role messages, as they don't always
                    # have a text field, but may have a tool_calls field instead
                    # e.g. 'tool_calls': [{'id': '98af3a29-b066-45a5-b4b1-46c74ddafc58',
                    # 'type': 'function', 'function': {'name': 'current_time', 'arguments': '{}'}}]}
        elif isinstance(prompts, dict):
            attributes[f"{SpanAttributes.LLM_INPUT_MESSAGES}.0.message.content"] = json.dumps(prompts)
            attributes[f"{SpanAttributes.LLM_INPUT_MESSAGES}.0.message.role"] = "user"
        elif isinstance(prompts, str):
            attributes[f"{SpanAttributes.LLM_INPUT_MESSAGES}.0.message.content"] = prompts
            attributes[f"{SpanAttributes.LLM_INPUT_MESSAGES}.0.message.role"] = "user"

        return attributes

    def _get_app_info_from_workflow_run_id(self, workflow_run_id: str) -> dict:
        """
        Get app info (id and name) from workflow_run_id for enhanced tracing metadata

        Database relationship: workflow_run -> workflow -> app -> app.name, app.id
        Returns: {"app_id": str, "app_name": str}
        """
        try:
            from models.model import App
            from models.workflow import Workflow, WorkflowRun

            # Get workflow run
            workflow_run = (
                db.session.execute(select(WorkflowRun).where(WorkflowRun.id == workflow_run_id)).scalars().first()
            )

            if not workflow_run:
                logger.warning("[Arize/Phoenix] WorkflowRun not found for ID: %s", workflow_run_id)
                return {"app_id": "unknown", "app_name": "Unknown Workflow Run"}

            # Get workflow
            workflow = (
                db.session.execute(select(Workflow).where(Workflow.id == workflow_run.workflow_id)).scalars().first()
            )

            if not workflow:
                logger.warning("[Arize/Phoenix] Workflow not found for ID: %s", workflow_run.workflow_id)
                return {"app_id": "unknown", "app_name": "Unknown Workflow"}

            # Get app
            app = db.session.execute(select(App).where(App.id == workflow.app_id)).scalars().first()

            if not app:
                logger.warning("[Arize/Phoenix] App not found for ID: %s", workflow.app_id)
                return {"app_id": workflow.app_id, "app_name": "Unknown App"}

            logger.info(
                "[Arize/Phoenix] Found app: %s (%s) for workflow_run: %s", app.name, app.id, workflow_run_id[:8]
            )

            return {"app_id": app.id, "app_name": app.name}

        except Exception as e:
            logger.exception("[Arize/Phoenix] Error getting app info for workflow_run %s", workflow_run_id[:8])
            return {"app_id": "error", "app_name": f"Error: {str(e)[:50]}"}

    def _tool_matches_child_workflow_lineage(
        self,
        tool_node,
        workflow_tool,
        child_workflow_run_id: str,
        child_workflow_app_id: str,
    ) -> bool:
        """Require explicit lineage evidence before using timing as a tie-breaker."""
        if self._json_mapping_contains_value(tool_node.outputs, child_workflow_run_id):
            return True
        if self._json_mapping_contains_value(tool_node.process_data, child_workflow_run_id):
            return True
        if self._json_mapping_contains_value(tool_node.inputs, child_workflow_app_id):
            return True
        if self._json_mapping_contains_value(tool_node.process_data, child_workflow_app_id):
            return True

        process_data = self._parse_json_mapping(tool_node.process_data)
        if workflow_tool.name and process_data.get("tool_name") == workflow_tool.name:
            return True

        return False
