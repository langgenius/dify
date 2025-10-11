import hashlib
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Union, cast
from urllib.parse import urlparse

from openinference.semconv.trace import OpenInferenceSpanKindValues, SpanAttributes
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter as GrpcOTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter as HttpOTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.id_generator import RandomIdGenerator
from opentelemetry.trace import SpanContext, TraceFlags, TraceState
from sqlalchemy import select

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import ArizeConfig, PhoenixConfig
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
from extensions.ext_database import db
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


class ArizePhoenixDataTrace(BaseTraceInstance):
    def __init__(
        self,
        arize_phoenix_config: ArizeConfig | PhoenixConfig,
    ):
        super().__init__(arize_phoenix_config)
        import logging

        logging.basicConfig()
        logging.getLogger().setLevel(logging.DEBUG)
        self.arize_phoenix_config = arize_phoenix_config
        self.tracer, self.processor = setup_tracer(arize_phoenix_config)
        self.project = arize_phoenix_config.project
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")

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
            logger.error("[Arize/Phoenix] Error in the trace: %s", str(e), exc_info=True)
            raise

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        workflow_metadata = {
            "workflow_run_id": trace_info.workflow_run_id or "",
            "message_id": trace_info.message_id or "",
            "workflow_app_log_id": trace_info.workflow_app_log_id or "",
            "status": trace_info.workflow_run_status or "",
            "status_message": trace_info.error or "",
            "level": "ERROR" if trace_info.error else "DEFAULT",
            "total_tokens": trace_info.total_tokens or 0,
        }
        workflow_metadata.update(trace_info.metadata)

        trace_id = string_to_trace_id128(trace_info.trace_id or trace_info.workflow_run_id)
        span_id = RandomIdGenerator().generate_span_id()
        context = SpanContext(
            trace_id=trace_id,
            span_id=span_id,
            is_remote=False,
            trace_flags=TraceFlags(TraceFlags.SAMPLED),
            trace_state=TraceState(),
        )

        workflow_span = self.tracer.start_span(
            name=TraceTaskName.WORKFLOW_TRACE.value,
            attributes={
                SpanAttributes.INPUT_VALUE: json.dumps(trace_info.workflow_run_inputs, ensure_ascii=False),
                SpanAttributes.OUTPUT_VALUE: json.dumps(trace_info.workflow_run_outputs, ensure_ascii=False),
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                SpanAttributes.METADATA: json.dumps(workflow_metadata, ensure_ascii=False),
                SpanAttributes.SESSION_ID: trace_info.conversation_id or "",
            },
            start_time=datetime_to_nanos(trace_info.start_time),
            context=trace.set_span_in_context(trace.NonRecordingSpan(context)),
        )

        try:
            # Process workflow nodes
            for node_execution in self._get_workflow_nodes(trace_info.workflow_run_id):
                created_at = node_execution.created_at or datetime.now()
                elapsed_time = node_execution.elapsed_time
                finished_at = created_at + timedelta(seconds=elapsed_time)

                process_data = json.loads(node_execution.process_data) if node_execution.process_data else {}

                node_metadata = {
                    "node_id": node_execution.id,
                    "node_type": node_execution.node_type,
                    "node_status": node_execution.status,
                    "tenant_id": node_execution.tenant_id,
                    "app_id": node_execution.app_id,
                    "app_name": node_execution.title,
                    "status": node_execution.status,
                    "level": "ERROR" if node_execution.status != "succeeded" else "DEFAULT",
                }

                if node_execution.execution_metadata:
                    node_metadata.update(json.loads(node_execution.execution_metadata))

                # Determine the correct span kind based on node type
                span_kind = OpenInferenceSpanKindValues.CHAIN
                if node_execution.node_type == "llm":
                    span_kind = OpenInferenceSpanKindValues.LLM
                    provider = process_data.get("model_provider")
                    model = process_data.get("model_name")
                    if provider:
                        node_metadata["ls_provider"] = provider
                    if model:
                        node_metadata["ls_model_name"] = model

                    outputs = json.loads(node_execution.outputs).get("usage", {}) if "outputs" in node_execution else {}
                    usage_data = process_data.get("usage", {}) if "usage" in process_data else outputs.get("usage", {})
                    if usage_data:
                        node_metadata["total_tokens"] = usage_data.get("total_tokens", 0)
                        node_metadata["prompt_tokens"] = usage_data.get("prompt_tokens", 0)
                        node_metadata["completion_tokens"] = usage_data.get("completion_tokens", 0)
                elif node_execution.node_type == "dataset_retrieval":
                    span_kind = OpenInferenceSpanKindValues.RETRIEVER
                elif node_execution.node_type == "tool":
                    span_kind = OpenInferenceSpanKindValues.TOOL
                else:
                    span_kind = OpenInferenceSpanKindValues.CHAIN

                node_span = self.tracer.start_span(
                    name=node_execution.node_type,
                    attributes={
                        SpanAttributes.INPUT_VALUE: node_execution.inputs or "{}",
                        SpanAttributes.OUTPUT_VALUE: node_execution.outputs or "{}",
                        SpanAttributes.OPENINFERENCE_SPAN_KIND: span_kind.value,
                        SpanAttributes.METADATA: json.dumps(node_metadata, ensure_ascii=False),
                        SpanAttributes.SESSION_ID: trace_info.conversation_id or "",
                    },
                    start_time=datetime_to_nanos(created_at),
                    context=trace.set_span_in_context(trace.NonRecordingSpan(context)),
                )

                try:
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
                        outputs = (
                            json.loads(node_execution.outputs).get("usage", {}) if "outputs" in node_execution else {}
                        )
                        usage_data = (
                            process_data.get("usage", {}) if "usage" in process_data else outputs.get("usage", {})
                        )
                        if usage_data:
                            llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_TOTAL] = usage_data.get("total_tokens", 0)
                            llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_PROMPT] = usage_data.get("prompt_tokens", 0)
                            llm_attributes[SpanAttributes.LLM_TOKEN_COUNT_COMPLETION] = usage_data.get(
                                "completion_tokens", 0
                            )
                        llm_attributes.update(self._construct_llm_attributes(process_data.get("prompts", [])))
                        node_span.set_attributes(llm_attributes)
                finally:
                    node_span.end(end_time=datetime_to_nanos(finished_at))
        finally:
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
        message_span_id = RandomIdGenerator().generate_span_id()
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
                if model_params := metadata_dict.get("model_parameters"):
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
                llm_span.end(end_time=datetime_to_nanos(trace_info.end_time))
        finally:
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
        span_id = RandomIdGenerator().generate_span_id()
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
        span_id = RandomIdGenerator().generate_span_id()
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
        span_id = RandomIdGenerator().generate_span_id()
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
        tool_span_id = RandomIdGenerator().generate_span_id()
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
        span_id = RandomIdGenerator().generate_span_id()
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
            span.end(end_time=datetime_to_nanos(trace_info.end_time))

    def api_check(self):
        try:
            with self.tracer.start_span("api_check") as span:
                span.set_attribute("test", "true")
            return True
        except Exception as e:
            logger.info("[Arize/Phoenix] API check failed: %s", str(e), exc_info=True)
            raise ValueError(f"[Arize/Phoenix] API check failed: {str(e)}")

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
        workflow_nodes = db.session.scalars(
            select(
                WorkflowNodeExecutionModel.id,
                WorkflowNodeExecutionModel.tenant_id,
                WorkflowNodeExecutionModel.app_id,
                WorkflowNodeExecutionModel.title,
                WorkflowNodeExecutionModel.node_type,
                WorkflowNodeExecutionModel.status,
                WorkflowNodeExecutionModel.inputs,
                WorkflowNodeExecutionModel.outputs,
                WorkflowNodeExecutionModel.created_at,
                WorkflowNodeExecutionModel.elapsed_time,
                WorkflowNodeExecutionModel.process_data,
                WorkflowNodeExecutionModel.execution_metadata,
            ).where(WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id)
        ).all()
        return workflow_nodes

    def _construct_llm_attributes(self, prompts: dict | list | str | None) -> dict[str, str]:
        """Helper method to construct LLM attributes with passed prompts."""
        attributes = {}
        if isinstance(prompts, list):
            for i, msg in enumerate(prompts):
                if isinstance(msg, dict):
                    attributes[f"{SpanAttributes.LLM_INPUT_MESSAGES}.{i}.message.content"] = msg.get("text", "")
                    attributes[f"{SpanAttributes.LLM_INPUT_MESSAGES}.{i}.message.role"] = msg.get("role", "user")
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
