import json
import logging
import os
import traceback
from datetime import datetime, timedelta
from typing import Any, Union, cast
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
from opentelemetry.semconv.trace import SpanAttributes as OTELSpanAttributes
from opentelemetry.trace import Span, Status, StatusCode, set_span_in_context, use_span
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.util.types import AttributeValue
from sqlalchemy.orm import sessionmaker

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
from core.repositories import DifyCoreRepositoryFactory
from extensions.ext_database import db
from models.model import EndUser, MessageFile
from models.workflow import WorkflowNodeExecutionTriggeredFrom

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
                OTELSpanAttributes.EXCEPTION_TYPE: exception_type,
                OTELSpanAttributes.EXCEPTION_MESSAGE: exception_message,
                OTELSpanAttributes.EXCEPTION_ESCAPED: False,
                OTELSpanAttributes.EXCEPTION_STACKTRACE: error_string,
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
        self.propagator = TraceContextTextMapPropagator()
        self.dify_trace_ids: set[str] = set()

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

        dify_trace_id = trace_info.trace_id or trace_info.message_id or trace_info.workflow_run_id
        self.ensure_root_span(dify_trace_id)
        root_span_context = self.propagator.extract(carrier=self.carrier)

        workflow_span = self.tracer.start_span(
            name=TraceTaskName.WORKFLOW_TRACE.value,
            attributes={
                SpanAttributes.OPENINFERENCE_SPAN_KIND: OpenInferenceSpanKindValues.CHAIN.value,
                SpanAttributes.INPUT_VALUE: safe_json_dumps(trace_info.workflow_run_inputs),
                SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.OUTPUT_VALUE: safe_json_dumps(trace_info.workflow_run_outputs),
                SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                SpanAttributes.METADATA: safe_json_dumps(metadata),
                SpanAttributes.SESSION_ID: trace_info.conversation_id or "",
            },
            start_time=datetime_to_nanos(trace_info.start_time),
            context=root_span_context,
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
        workflow_node_executions = workflow_node_execution_repository.get_by_workflow_run(
            workflow_run_id=trace_info.workflow_run_id
        )

        try:
            for node_execution in workflow_node_executions:
                tenant_id = trace_info.tenant_id  # Use from trace_info instead
                app_id = trace_info.metadata.get("app_id")  # Use from trace_info instead
                inputs_value = node_execution.inputs or {}
                outputs_value = node_execution.outputs or {}

                created_at = node_execution.created_at or datetime.now()
                elapsed_time = node_execution.elapsed_time
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
                        "level": "ERROR" if node_execution.status == "failed" else "DEFAULT",
                    }
                )

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

                    usage_data = (
                        process_data.get("usage", {}) if "usage" in process_data else outputs_value.get("usage", {})
                    )
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

                workflow_span_context = set_span_in_context(workflow_span)
                node_span = self.tracer.start_span(
                    name=node_execution.node_type,
                    attributes={
                        SpanAttributes.OPENINFERENCE_SPAN_KIND: span_kind.value,
                        SpanAttributes.INPUT_VALUE: safe_json_dumps(inputs_value),
                        SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                        SpanAttributes.OUTPUT_VALUE: safe_json_dumps(outputs_value),
                        SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                        SpanAttributes.METADATA: safe_json_dumps(node_metadata),
                        SpanAttributes.SESSION_ID: trace_info.conversation_id or "",
                    },
                    start_time=datetime_to_nanos(created_at),
                    context=workflow_span_context,
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
                finally:
                    if node_execution.status == "failed":
                        set_span_status(node_span, node_execution.error)
                    else:
                        set_span_status(node_span)
                    node_span.end(end_time=datetime_to_nanos(finished_at))
        finally:
            if trace_info.error:
                set_span_status(workflow_span, trace_info.error)
            else:
                set_span_status(workflow_span)
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
            end_user_data: EndUser | None = (
                db.session.query(EndUser).where(EndUser.id == trace_info.message_data.from_end_user_id).first()
            )
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
                metadata_dict = json.loads(trace_info.message_data.message_metadata)
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

    def _construct_llm_attributes(self, prompts: dict | list | str | None) -> dict[str, str]:
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

        def set_tool_call_attributes(message_index: int, tool_index: int, tool_call: dict | object | None) -> None:
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
