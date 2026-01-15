import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any, cast

import mlflow
from mlflow.entities import Document, Span, SpanEvent, SpanStatusCode, SpanType
from mlflow.tracing.constant import SpanAttributeKey, TokenUsageKey, TraceMetadataKey
from mlflow.tracing.fluent import start_span_no_context, update_current_trace
from mlflow.tracing.provider import detach_span_from_context, set_span_in_context

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import DatabricksConfig, MLflowConfig
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
from core.workflow.enums import NodeType
from extensions.ext_database import db
from models import EndUser
from models.workflow import WorkflowNodeExecutionModel

logger = logging.getLogger(__name__)


def datetime_to_nanoseconds(dt: datetime | None) -> int | None:
    """Convert datetime to nanosecond timestamp for MLflow API"""
    if dt is None:
        return None
    return int(dt.timestamp() * 1_000_000_000)


class MLflowDataTrace(BaseTraceInstance):
    def __init__(self, config: MLflowConfig | DatabricksConfig):
        super().__init__(config)
        if isinstance(config, DatabricksConfig):
            self._setup_databricks(config)
        else:
            self._setup_mlflow(config)

        # Enable async logging to minimize performance overhead
        os.environ["MLFLOW_ENABLE_ASYNC_TRACE_LOGGING"] = "true"

    def _setup_databricks(self, config: DatabricksConfig):
        """Setup connection to Databricks-managed MLflow instances"""
        os.environ["DATABRICKS_HOST"] = config.host

        if config.client_id and config.client_secret:
            # OAuth: https://docs.databricks.com/aws/en/dev-tools/auth/oauth-m2m?language=Environment
            os.environ["DATABRICKS_CLIENT_ID"] = config.client_id
            os.environ["DATABRICKS_CLIENT_SECRET"] = config.client_secret
        elif config.personal_access_token:
            # PAT: https://docs.databricks.com/aws/en/dev-tools/auth/pat
            os.environ["DATABRICKS_TOKEN"] = config.personal_access_token
        else:
            raise ValueError(
                "Either Databricks token (PAT) or client id and secret (OAuth) must be provided"
                "See https://docs.databricks.com/aws/en/dev-tools/auth/#what-authorization-option-should-i-choose "
                "for more information about the authorization options."
            )
        mlflow.set_tracking_uri("databricks")
        mlflow.set_experiment(experiment_id=config.experiment_id)

        # Remove trailing slash from host
        config.host = config.host.rstrip("/")
        self._project_url = f"{config.host}/ml/experiments/{config.experiment_id}/traces"

    def _setup_mlflow(self, config: MLflowConfig):
        """Setup connection to MLflow instances"""
        mlflow.set_tracking_uri(config.tracking_uri)
        mlflow.set_experiment(experiment_id=config.experiment_id)

        # Simple auth if provided
        if config.username and config.password:
            os.environ["MLFLOW_TRACKING_USERNAME"] = config.username
            os.environ["MLFLOW_TRACKING_PASSWORD"] = config.password

        self._project_url = f"{config.tracking_uri}/#/experiments/{config.experiment_id}/traces"

    def trace(self, trace_info: BaseTraceInfo):
        """Simple dispatch to trace methods"""
        try:
            if isinstance(trace_info, WorkflowTraceInfo):
                self.workflow_trace(trace_info)
            elif isinstance(trace_info, MessageTraceInfo):
                self.message_trace(trace_info)
            elif isinstance(trace_info, ToolTraceInfo):
                self.tool_trace(trace_info)
            elif isinstance(trace_info, ModerationTraceInfo):
                self.moderation_trace(trace_info)
            elif isinstance(trace_info, DatasetRetrievalTraceInfo):
                self.dataset_retrieval_trace(trace_info)
            elif isinstance(trace_info, SuggestedQuestionTraceInfo):
                self.suggested_question_trace(trace_info)
            elif isinstance(trace_info, GenerateNameTraceInfo):
                self.generate_name_trace(trace_info)
        except Exception:
            logger.exception("[MLflow] Trace error")
            raise

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        """Create workflow span as root, with node spans as children"""
        # fields with sys.xyz is added by Dify, they are duplicate to trace_info.metadata
        raw_inputs = trace_info.workflow_run_inputs or {}
        workflow_inputs = {k: v for k, v in raw_inputs.items() if not k.startswith("sys.")}

        # Special inputs propagated by system
        if trace_info.query:
            workflow_inputs["query"] = trace_info.query

        workflow_span = start_span_no_context(
            name=TraceTaskName.WORKFLOW_TRACE.value,
            span_type=SpanType.CHAIN,
            inputs=workflow_inputs,
            attributes=trace_info.metadata,
            start_time_ns=datetime_to_nanoseconds(trace_info.start_time),
        )

        # Set reserved fields in trace-level metadata
        trace_metadata = {}
        if user_id := trace_info.metadata.get("user_id"):
            trace_metadata[TraceMetadataKey.TRACE_USER] = user_id
        if session_id := trace_info.conversation_id:
            trace_metadata[TraceMetadataKey.TRACE_SESSION] = session_id
        self._set_trace_metadata(workflow_span, trace_metadata)

        try:
            # Create child spans for workflow nodes
            for node in self._get_workflow_nodes(trace_info.workflow_run_id):
                inputs = None
                attributes = {
                    "node_id": node.id,
                    "node_type": node.node_type,
                    "status": node.status,
                    "tenant_id": node.tenant_id,
                    "app_id": node.app_id,
                    "app_name": node.title,
                }

                if node.node_type in (NodeType.LLM, NodeType.QUESTION_CLASSIFIER):
                    inputs, llm_attributes = self._parse_llm_inputs_and_attributes(node)
                    attributes.update(llm_attributes)
                elif node.node_type == NodeType.HTTP_REQUEST:
                    inputs = node.process_data  # contains request URL

                if not inputs:
                    inputs = json.loads(node.inputs) if node.inputs else {}

                node_span = start_span_no_context(
                    name=node.title,
                    span_type=self._get_node_span_type(node.node_type),
                    parent_span=workflow_span,
                    inputs=inputs,
                    attributes=attributes,
                    start_time_ns=datetime_to_nanoseconds(node.created_at),
                )

                # Handle node errors
                if node.status != "succeeded":
                    node_span.set_status(SpanStatusCode.ERROR)
                    node_span.add_event(
                        SpanEvent(  # type: ignore[abstract]
                            name="exception",
                            attributes={
                                "exception.message": f"Node failed with status: {node.status}",
                                "exception.type": "Error",
                                "exception.stacktrace": f"Node failed with status: {node.status}",
                            },
                        )
                    )

                # End node span
                finished_at = node.created_at + timedelta(seconds=node.elapsed_time)
                outputs = json.loads(node.outputs) if node.outputs else {}
                if node.node_type == NodeType.KNOWLEDGE_RETRIEVAL:
                    outputs = self._parse_knowledge_retrieval_outputs(outputs)
                elif node.node_type == NodeType.LLM:
                    outputs = outputs.get("text", outputs)
                node_span.end(
                    outputs=outputs,
                    end_time_ns=datetime_to_nanoseconds(finished_at),
                )

            # Handle workflow-level errors
            if trace_info.error:
                workflow_span.set_status(SpanStatusCode.ERROR)
                workflow_span.add_event(
                    SpanEvent(  # type: ignore[abstract]
                        name="exception",
                        attributes={
                            "exception.message": trace_info.error,
                            "exception.type": "Error",
                            "exception.stacktrace": trace_info.error,
                        },
                    )
                )

        finally:
            workflow_span.end(
                outputs=trace_info.workflow_run_outputs,
                end_time_ns=datetime_to_nanoseconds(trace_info.end_time),
            )

    def _parse_llm_inputs_and_attributes(self, node: WorkflowNodeExecutionModel) -> tuple[Any, dict]:
        """Parse LLM inputs and attributes from LLM workflow node"""
        if node.process_data is None:
            return {}, {}

        try:
            data = json.loads(node.process_data)
        except (json.JSONDecodeError, TypeError):
            return {}, {}

        inputs = self._parse_prompts(data.get("prompts"))
        attributes = {
            "model_name": data.get("model_name"),
            "model_provider": data.get("model_provider"),
            "finish_reason": data.get("finish_reason"),
        }

        if hasattr(SpanAttributeKey, "MESSAGE_FORMAT"):
            attributes[SpanAttributeKey.MESSAGE_FORMAT] = "dify"

        if usage := data.get("usage"):
            # Set reserved token usage attributes
            attributes[SpanAttributeKey.CHAT_USAGE] = {
                TokenUsageKey.INPUT_TOKENS: usage.get("prompt_tokens", 0),
                TokenUsageKey.OUTPUT_TOKENS: usage.get("completion_tokens", 0),
                TokenUsageKey.TOTAL_TOKENS: usage.get("total_tokens", 0),
            }
            # Store raw usage data as well as it includes more data like price
            attributes["usage"] = usage

        return inputs, attributes

    def _parse_knowledge_retrieval_outputs(self, outputs: dict):
        """Parse KR outputs and attributes from KR workflow node"""
        retrieved = outputs.get("result", [])

        if not retrieved or not isinstance(retrieved, list):
            return outputs

        documents = []
        for item in retrieved:
            documents.append(Document(page_content=item.get("content", ""), metadata=item.get("metadata", {})))
        return documents

    def message_trace(self, trace_info: MessageTraceInfo):
        """Create span for CHATBOT message processing"""
        if not trace_info.message_data:
            return

        file_list = cast(list[str], trace_info.file_list) or []
        if message_file_data := trace_info.message_file_data:
            base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")
            file_list.append(f"{base_url}/{message_file_data.url}")

        span = start_span_no_context(
            name=TraceTaskName.MESSAGE_TRACE.value,
            span_type=SpanType.LLM,
            inputs=self._parse_prompts(trace_info.inputs),  # type: ignore[arg-type]
            attributes={
                "message_id": trace_info.message_id,  # type: ignore[dict-item]
                "model_provider": trace_info.message_data.model_provider,
                "model_id": trace_info.message_data.model_id,
                "conversation_mode": trace_info.conversation_mode,
                "file_list": file_list,  # type: ignore[dict-item]
                "total_price": trace_info.message_data.total_price,
                **trace_info.metadata,
            },
            start_time_ns=datetime_to_nanoseconds(trace_info.start_time),
        )

        if hasattr(SpanAttributeKey, "MESSAGE_FORMAT"):
            span.set_attribute(SpanAttributeKey.MESSAGE_FORMAT, "dify")

        # Set token usage
        span.set_attribute(
            SpanAttributeKey.CHAT_USAGE,
            {
                TokenUsageKey.INPUT_TOKENS: trace_info.message_tokens or 0,
                TokenUsageKey.OUTPUT_TOKENS: trace_info.answer_tokens or 0,
                TokenUsageKey.TOTAL_TOKENS: trace_info.total_tokens or 0,
            },
        )

        # Set reserved fields in trace-level metadata
        trace_metadata = {}
        if user_id := self._get_message_user_id(trace_info.metadata):
            trace_metadata[TraceMetadataKey.TRACE_USER] = user_id
        if session_id := trace_info.metadata.get("conversation_id"):
            trace_metadata[TraceMetadataKey.TRACE_SESSION] = session_id
        self._set_trace_metadata(span, trace_metadata)

        if trace_info.error:
            span.set_status(SpanStatusCode.ERROR)
            span.add_event(
                SpanEvent(  # type: ignore[abstract]
                    name="error",
                    attributes={
                        "exception.message": trace_info.error,
                        "exception.type": "Error",
                        "exception.stacktrace": trace_info.error,
                    },
                )
            )

        span.end(
            outputs=trace_info.message_data.answer,
            end_time_ns=datetime_to_nanoseconds(trace_info.end_time),
        )

    def _get_message_user_id(self, metadata: dict) -> str | None:
        if (end_user_id := metadata.get("from_end_user_id")) and (
            end_user_data := db.session.query(EndUser).where(EndUser.id == end_user_id).first()
        ):
            return end_user_data.session_id

        return metadata.get("from_account_id")  # type: ignore[return-value]

    def tool_trace(self, trace_info: ToolTraceInfo):
        span = start_span_no_context(
            name=trace_info.tool_name,
            span_type=SpanType.TOOL,
            inputs=trace_info.tool_inputs,  # type: ignore[arg-type]
            attributes={
                "message_id": trace_info.message_id,  # type: ignore[dict-item]
                "metadata": trace_info.metadata,  # type: ignore[dict-item]
                "tool_config": trace_info.tool_config,  # type: ignore[dict-item]
                "tool_parameters": trace_info.tool_parameters,  # type: ignore[dict-item]
            },
            start_time_ns=datetime_to_nanoseconds(trace_info.start_time),
        )

        # Handle tool errors
        if trace_info.error:
            span.set_status(SpanStatusCode.ERROR)
            span.add_event(
                SpanEvent(  # type: ignore[abstract]
                    name="error",
                    attributes={
                        "exception.message": trace_info.error,
                        "exception.type": "Error",
                        "exception.stacktrace": trace_info.error,
                    },
                )
            )

        span.end(
            outputs=trace_info.tool_outputs,
            end_time_ns=datetime_to_nanoseconds(trace_info.end_time),
        )

    def moderation_trace(self, trace_info: ModerationTraceInfo):
        if trace_info.message_data is None:
            return

        start_time = trace_info.start_time or trace_info.message_data.created_at
        span = start_span_no_context(
            name=TraceTaskName.MODERATION_TRACE.value,
            span_type=SpanType.TOOL,
            inputs=trace_info.inputs or {},
            attributes={
                "message_id": trace_info.message_id,  # type: ignore[dict-item]
                "metadata": trace_info.metadata,  # type: ignore[dict-item]
            },
            start_time_ns=datetime_to_nanoseconds(start_time),
        )

        span.end(
            outputs={
                "action": trace_info.action,
                "flagged": trace_info.flagged,
                "preset_response": trace_info.preset_response,
            },
            end_time_ns=datetime_to_nanoseconds(trace_info.end_time),
        )

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            return

        span = start_span_no_context(
            name=TraceTaskName.DATASET_RETRIEVAL_TRACE.value,
            span_type=SpanType.RETRIEVER,
            inputs=trace_info.inputs,
            attributes={
                "message_id": trace_info.message_id,  # type: ignore[dict-item]
                "metadata": trace_info.metadata,  # type: ignore[dict-item]
            },
            start_time_ns=datetime_to_nanoseconds(trace_info.start_time),
        )
        span.end(outputs={"documents": trace_info.documents}, end_time_ns=datetime_to_nanoseconds(trace_info.end_time))

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        if trace_info.message_data is None:
            return

        start_time = trace_info.start_time or trace_info.message_data.created_at
        end_time = trace_info.end_time or trace_info.message_data.updated_at

        span = start_span_no_context(
            name=TraceTaskName.SUGGESTED_QUESTION_TRACE.value,
            span_type=SpanType.TOOL,
            inputs=trace_info.inputs,
            attributes={
                "message_id": trace_info.message_id,  # type: ignore[dict-item]
                "model_provider": trace_info.model_provider,  # type: ignore[dict-item]
                "model_id": trace_info.model_id,  # type: ignore[dict-item]
                "total_tokens": trace_info.total_tokens or 0,  # type: ignore[dict-item]
            },
            start_time_ns=datetime_to_nanoseconds(start_time),
        )

        if trace_info.error:
            span.set_status(SpanStatusCode.ERROR)
            span.add_event(
                SpanEvent(  # type: ignore[abstract]
                    name="error",
                    attributes={
                        "exception.message": trace_info.error,
                        "exception.type": "Error",
                        "exception.stacktrace": trace_info.error,
                    },
                )
            )

        span.end(outputs=trace_info.suggested_question, end_time_ns=datetime_to_nanoseconds(end_time))

    def generate_name_trace(self, trace_info: GenerateNameTraceInfo):
        span = start_span_no_context(
            name=TraceTaskName.GENERATE_NAME_TRACE.value,
            span_type=SpanType.CHAIN,
            inputs=trace_info.inputs,
            attributes={"message_id": trace_info.message_id},  # type: ignore[dict-item]
            start_time_ns=datetime_to_nanoseconds(trace_info.start_time),
        )
        span.end(outputs=trace_info.outputs, end_time_ns=datetime_to_nanoseconds(trace_info.end_time))

    def _get_workflow_nodes(self, workflow_run_id: str):
        """Helper method to get workflow nodes"""
        workflow_nodes = (
            db.session.query(
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
            )
            .filter(WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id)
            .order_by(WorkflowNodeExecutionModel.created_at)
            .all()
        )
        return workflow_nodes

    def _get_node_span_type(self, node_type: str) -> str:
        """Map Dify node types to MLflow span types"""
        node_type_mapping = {
            NodeType.LLM: SpanType.LLM,
            NodeType.QUESTION_CLASSIFIER: SpanType.LLM,
            NodeType.KNOWLEDGE_RETRIEVAL: SpanType.RETRIEVER,
            NodeType.TOOL: SpanType.TOOL,
            NodeType.CODE: SpanType.TOOL,
            NodeType.HTTP_REQUEST: SpanType.TOOL,
            NodeType.AGENT: SpanType.AGENT,
        }
        return node_type_mapping.get(node_type, "CHAIN")  # type: ignore[arg-type,call-overload]

    def _set_trace_metadata(self, span: Span, metadata: dict):
        token = None
        try:
            # NB: Set span in context such that we can use update_current_trace() API
            token = set_span_in_context(span)
            update_current_trace(metadata=metadata)
        finally:
            if token:
                detach_span_from_context(token)

    def _parse_prompts(self, prompts):
        """Postprocess prompts format to be standard chat messages"""
        if isinstance(prompts, str):
            return prompts
        elif isinstance(prompts, dict):
            return self._parse_single_message(prompts)
        elif isinstance(prompts, list):
            messages = [self._parse_single_message(item) for item in prompts]
            messages = self._resolve_tool_call_ids(messages)
            return messages
        return prompts  # Fallback to original format

    def _parse_single_message(self, item: dict):
        """Postprocess single message format to be standard chat message"""
        role = item.get("role", "user")
        msg = {"role": role, "content": item.get("text", "")}

        if (
            (tool_calls := item.get("tool_calls"))
            # Tool message does not contain tool calls normally
            and role != "tool"
        ):
            msg["tool_calls"] = tool_calls

        if files := item.get("files"):
            msg["files"] = files

        return msg

    def _resolve_tool_call_ids(self, messages: list[dict]):
        """
        The tool call message from Dify does not contain tool call ids, which is not
        ideal for debugging. This method resolves the tool call ids by matching the
        tool call name and parameters with the tool instruction messages.
        """
        tool_call_ids = []
        for msg in messages:
            if tool_calls := msg.get("tool_calls"):
                tool_call_ids = [t["id"] for t in tool_calls]
            if msg["role"] == "tool":
                # Get the tool call id in the order of the tool call messages
                # assuming Dify runs tools sequentially
                if tool_call_ids:
                    msg["tool_call_id"] = tool_call_ids.pop(0)
        return messages

    def api_check(self):
        """Simple connection test"""
        try:
            mlflow.search_experiments(max_results=1)
            return True
        except Exception as e:
            raise ValueError(f"MLflow connection failed: {str(e)}")

    def get_project_url(self):
        return self._project_url
