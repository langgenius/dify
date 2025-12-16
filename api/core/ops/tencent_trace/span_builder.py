"""
Tencent APM Span Builder - handles all span construction logic
"""

import json
import logging
from datetime import datetime

from opentelemetry.trace import Status, StatusCode

from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    MessageTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.tencent_trace.entities.semconv import (
    GEN_AI_COMPLETION,
    GEN_AI_FRAMEWORK,
    GEN_AI_IS_ENTRY,
    GEN_AI_IS_STREAMING_REQUEST,
    GEN_AI_MODEL_NAME,
    GEN_AI_PROMPT,
    GEN_AI_PROVIDER,
    GEN_AI_RESPONSE_FINISH_REASON,
    GEN_AI_SESSION_ID,
    GEN_AI_SPAN_KIND,
    GEN_AI_USAGE_INPUT_TOKENS,
    GEN_AI_USAGE_OUTPUT_TOKENS,
    GEN_AI_USAGE_TOTAL_TOKENS,
    GEN_AI_USER_ID,
    INPUT_VALUE,
    OUTPUT_VALUE,
    RETRIEVAL_DOCUMENT,
    RETRIEVAL_QUERY,
    TOOL_DESCRIPTION,
    TOOL_NAME,
    TOOL_PARAMETERS,
    GenAISpanKind,
)
from core.ops.tencent_trace.entities.tencent_trace_entity import SpanData
from core.ops.tencent_trace.utils import TencentTraceUtils
from core.rag.models.document import Document
from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)

logger = logging.getLogger(__name__)


class TencentSpanBuilder:
    """Builder class for constructing different types of spans"""

    @staticmethod
    def _get_time_nanoseconds(time_value: datetime | None) -> int:
        """Convert datetime to nanoseconds for span creation."""
        return TencentTraceUtils.convert_datetime_to_nanoseconds(time_value)

    @staticmethod
    def build_workflow_spans(
        trace_info: WorkflowTraceInfo, trace_id: int, user_id: str, links: list | None = None
    ) -> list[SpanData]:
        """Build workflow-related spans"""
        spans = []
        links = links or []

        message_span_id = None
        workflow_span_id = TencentTraceUtils.convert_to_span_id(trace_info.workflow_run_id, "workflow")

        if hasattr(trace_info, "metadata") and trace_info.metadata.get("conversation_id"):
            message_span_id = TencentTraceUtils.convert_to_span_id(trace_info.workflow_run_id, "message")

        status = Status(StatusCode.OK)
        if trace_info.error:
            status = Status(StatusCode.ERROR, trace_info.error)

        if message_span_id:
            message_span = TencentSpanBuilder._build_message_span(
                trace_info, trace_id, message_span_id, user_id, status, links
            )
            spans.append(message_span)

        workflow_span = TencentSpanBuilder._build_workflow_span(
            trace_info, trace_id, workflow_span_id, message_span_id, user_id, status, links
        )
        spans.append(workflow_span)

        return spans

    @staticmethod
    def _build_message_span(
        trace_info: WorkflowTraceInfo, trace_id: int, message_span_id: int, user_id: str, status: Status, links: list
    ) -> SpanData:
        """Build message span for chatflow"""
        return SpanData(
            trace_id=trace_id,
            parent_span_id=None,
            span_id=message_span_id,
            name="message",
            start_time=TencentSpanBuilder._get_time_nanoseconds(trace_info.start_time),
            end_time=TencentSpanBuilder._get_time_nanoseconds(trace_info.end_time),
            attributes={
                GEN_AI_SESSION_ID: trace_info.metadata.get("conversation_id", ""),
                GEN_AI_USER_ID: str(user_id),
                GEN_AI_SPAN_KIND: GenAISpanKind.WORKFLOW.value,
                GEN_AI_FRAMEWORK: "dify",
                GEN_AI_IS_ENTRY: "true",
                INPUT_VALUE: trace_info.workflow_run_inputs.get("sys.query", ""),
                OUTPUT_VALUE: json.dumps(trace_info.workflow_run_outputs, ensure_ascii=False),
            },
            status=status,
            links=links,
        )

    @staticmethod
    def _build_workflow_span(
        trace_info: WorkflowTraceInfo,
        trace_id: int,
        workflow_span_id: int,
        message_span_id: int | None,
        user_id: str,
        status: Status,
        links: list,
    ) -> SpanData:
        """Build workflow span"""
        attributes = {
            GEN_AI_USER_ID: str(user_id),
            GEN_AI_SPAN_KIND: GenAISpanKind.WORKFLOW.value,
            GEN_AI_FRAMEWORK: "dify",
            INPUT_VALUE: json.dumps(trace_info.workflow_run_inputs, ensure_ascii=False),
            OUTPUT_VALUE: json.dumps(trace_info.workflow_run_outputs, ensure_ascii=False),
        }

        if message_span_id is None:
            attributes[GEN_AI_IS_ENTRY] = "true"

        return SpanData(
            trace_id=trace_id,
            parent_span_id=message_span_id,
            span_id=workflow_span_id,
            name="workflow",
            start_time=TencentSpanBuilder._get_time_nanoseconds(trace_info.start_time),
            end_time=TencentSpanBuilder._get_time_nanoseconds(trace_info.end_time),
            attributes=attributes,
            status=status,
            links=links,
        )

    @staticmethod
    def build_workflow_llm_span(
        trace_id: int, workflow_span_id: int, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution
    ) -> SpanData:
        """Build LLM span for workflow nodes."""
        process_data = node_execution.process_data or {}
        outputs = node_execution.outputs or {}
        usage_data = process_data.get("usage", {}) if "usage" in process_data else outputs.get("usage", {})

        attributes = {
            GEN_AI_SESSION_ID: trace_info.metadata.get("conversation_id", ""),
            GEN_AI_SPAN_KIND: GenAISpanKind.GENERATION.value,
            GEN_AI_FRAMEWORK: "dify",
            GEN_AI_MODEL_NAME: process_data.get("model_name", ""),
            GEN_AI_PROVIDER: process_data.get("model_provider", ""),
            GEN_AI_USAGE_INPUT_TOKENS: str(usage_data.get("prompt_tokens", 0)),
            GEN_AI_USAGE_OUTPUT_TOKENS: str(usage_data.get("completion_tokens", 0)),
            GEN_AI_USAGE_TOTAL_TOKENS: str(usage_data.get("total_tokens", 0)),
            GEN_AI_PROMPT: json.dumps(process_data.get("prompts", []), ensure_ascii=False),
            GEN_AI_COMPLETION: str(outputs.get("text", "")),
            GEN_AI_RESPONSE_FINISH_REASON: outputs.get("finish_reason", ""),
            INPUT_VALUE: json.dumps(process_data.get("prompts", []), ensure_ascii=False),
            OUTPUT_VALUE: str(outputs.get("text", "")),
        }

        if usage_data.get("time_to_first_token") is not None:
            attributes[GEN_AI_IS_STREAMING_REQUEST] = "true"

        return SpanData(
            trace_id=trace_id,
            parent_span_id=workflow_span_id,
            span_id=TencentTraceUtils.convert_to_span_id(node_execution.id, "node"),
            name="GENERATION",
            start_time=TencentSpanBuilder._get_time_nanoseconds(node_execution.created_at),
            end_time=TencentSpanBuilder._get_time_nanoseconds(node_execution.finished_at),
            attributes=attributes,
            status=TencentSpanBuilder._get_workflow_node_status(node_execution),
        )

    @staticmethod
    def build_message_span(
        trace_info: MessageTraceInfo, trace_id: int, user_id: str, links: list | None = None
    ) -> SpanData:
        """Build message span."""
        links = links or []
        status = Status(StatusCode.OK)
        if trace_info.error:
            status = Status(StatusCode.ERROR, trace_info.error)

        attributes = {
            GEN_AI_SESSION_ID: trace_info.metadata.get("conversation_id", ""),
            GEN_AI_USER_ID: str(user_id),
            GEN_AI_SPAN_KIND: GenAISpanKind.WORKFLOW.value,
            GEN_AI_FRAMEWORK: "dify",
            GEN_AI_IS_ENTRY: "true",
            INPUT_VALUE: str(trace_info.inputs or ""),
            OUTPUT_VALUE: str(trace_info.outputs or ""),
        }

        if trace_info.is_streaming_request:
            attributes[GEN_AI_IS_STREAMING_REQUEST] = "true"

        return SpanData(
            trace_id=trace_id,
            parent_span_id=None,
            span_id=TencentTraceUtils.convert_to_span_id(trace_info.message_id, "message"),
            name="message",
            start_time=TencentSpanBuilder._get_time_nanoseconds(trace_info.start_time),
            end_time=TencentSpanBuilder._get_time_nanoseconds(trace_info.end_time),
            attributes=attributes,
            status=status,
            links=links,
        )

    @staticmethod
    def build_tool_span(trace_info: ToolTraceInfo, trace_id: int, parent_span_id: int) -> SpanData:
        """Build tool span."""
        status = Status(StatusCode.OK)
        if trace_info.error:
            status = Status(StatusCode.ERROR, trace_info.error)

        return SpanData(
            trace_id=trace_id,
            parent_span_id=parent_span_id,
            span_id=TencentTraceUtils.convert_to_span_id(trace_info.message_id, "tool"),
            name=trace_info.tool_name,
            start_time=TencentSpanBuilder._get_time_nanoseconds(trace_info.start_time),
            end_time=TencentSpanBuilder._get_time_nanoseconds(trace_info.end_time),
            attributes={
                GEN_AI_SPAN_KIND: GenAISpanKind.TOOL.value,
                GEN_AI_FRAMEWORK: "dify",
                TOOL_NAME: trace_info.tool_name,
                TOOL_DESCRIPTION: "",
                TOOL_PARAMETERS: json.dumps(trace_info.tool_parameters, ensure_ascii=False),
                INPUT_VALUE: json.dumps(trace_info.tool_inputs, ensure_ascii=False),
                OUTPUT_VALUE: str(trace_info.tool_outputs),
            },
            status=status,
        )

    @staticmethod
    def build_retrieval_span(trace_info: DatasetRetrievalTraceInfo, trace_id: int, parent_span_id: int) -> SpanData:
        """Build dataset retrieval span."""
        status = Status(StatusCode.OK)
        if getattr(trace_info, "error", None):
            status = Status(StatusCode.ERROR, trace_info.error)  # type: ignore[arg-type]

        documents_data = TencentSpanBuilder._extract_retrieval_documents(trace_info.documents)

        return SpanData(
            trace_id=trace_id,
            parent_span_id=parent_span_id,
            span_id=TencentTraceUtils.convert_to_span_id(trace_info.message_id, "retrieval"),
            name="retrieval",
            start_time=TencentSpanBuilder._get_time_nanoseconds(trace_info.start_time),
            end_time=TencentSpanBuilder._get_time_nanoseconds(trace_info.end_time),
            attributes={
                GEN_AI_SPAN_KIND: GenAISpanKind.RETRIEVER.value,
                GEN_AI_FRAMEWORK: "dify",
                RETRIEVAL_QUERY: str(trace_info.inputs or ""),
                RETRIEVAL_DOCUMENT: json.dumps(documents_data, ensure_ascii=False),
                INPUT_VALUE: str(trace_info.inputs or ""),
                OUTPUT_VALUE: json.dumps(documents_data, ensure_ascii=False),
            },
            status=status,
        )

    @staticmethod
    def _get_workflow_node_status(node_execution: WorkflowNodeExecution) -> Status:
        """Get workflow node execution status."""
        if node_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED:
            return Status(StatusCode.OK)
        elif node_execution.status in [WorkflowNodeExecutionStatus.FAILED, WorkflowNodeExecutionStatus.EXCEPTION]:
            return Status(StatusCode.ERROR, str(node_execution.error))
        return Status(StatusCode.UNSET)

    @staticmethod
    def build_workflow_retrieval_span(
        trace_id: int, workflow_span_id: int, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution
    ) -> SpanData:
        """Build knowledge retrieval span for workflow nodes."""
        input_value = ""
        if node_execution.inputs:
            input_value = str(node_execution.inputs.get("query", ""))
        output_value = ""
        if node_execution.outputs:
            output_value = json.dumps(node_execution.outputs.get("result", []), ensure_ascii=False)

        return SpanData(
            trace_id=trace_id,
            parent_span_id=workflow_span_id,
            span_id=TencentTraceUtils.convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=TencentSpanBuilder._get_time_nanoseconds(node_execution.created_at),
            end_time=TencentSpanBuilder._get_time_nanoseconds(node_execution.finished_at),
            attributes={
                GEN_AI_SESSION_ID: trace_info.metadata.get("conversation_id", ""),
                GEN_AI_SPAN_KIND: GenAISpanKind.RETRIEVER.value,
                GEN_AI_FRAMEWORK: "dify",
                RETRIEVAL_QUERY: input_value,
                RETRIEVAL_DOCUMENT: output_value,
                INPUT_VALUE: input_value,
                OUTPUT_VALUE: output_value,
            },
            status=TencentSpanBuilder._get_workflow_node_status(node_execution),
        )

    @staticmethod
    def build_workflow_tool_span(
        trace_id: int, workflow_span_id: int, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution
    ) -> SpanData:
        """Build tool span for workflow nodes."""
        tool_des = {}
        if node_execution.metadata:
            tool_des = node_execution.metadata.get(WorkflowNodeExecutionMetadataKey.TOOL_INFO, {})

        return SpanData(
            trace_id=trace_id,
            parent_span_id=workflow_span_id,
            span_id=TencentTraceUtils.convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=TencentSpanBuilder._get_time_nanoseconds(node_execution.created_at),
            end_time=TencentSpanBuilder._get_time_nanoseconds(node_execution.finished_at),
            attributes={
                GEN_AI_SPAN_KIND: GenAISpanKind.TOOL.value,
                GEN_AI_FRAMEWORK: "dify",
                TOOL_NAME: node_execution.title,
                TOOL_DESCRIPTION: json.dumps(tool_des, ensure_ascii=False),
                TOOL_PARAMETERS: json.dumps(node_execution.inputs or {}, ensure_ascii=False),
                INPUT_VALUE: json.dumps(node_execution.inputs or {}, ensure_ascii=False),
                OUTPUT_VALUE: json.dumps(node_execution.outputs, ensure_ascii=False),
            },
            status=TencentSpanBuilder._get_workflow_node_status(node_execution),
        )

    @staticmethod
    def build_workflow_task_span(
        trace_id: int, workflow_span_id: int, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution
    ) -> SpanData:
        """Build generic task span for workflow nodes."""
        return SpanData(
            trace_id=trace_id,
            parent_span_id=workflow_span_id,
            span_id=TencentTraceUtils.convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=TencentSpanBuilder._get_time_nanoseconds(node_execution.created_at),
            end_time=TencentSpanBuilder._get_time_nanoseconds(node_execution.finished_at),
            attributes={
                GEN_AI_SESSION_ID: trace_info.metadata.get("conversation_id", ""),
                GEN_AI_SPAN_KIND: GenAISpanKind.TASK.value,
                GEN_AI_FRAMEWORK: "dify",
                INPUT_VALUE: json.dumps(node_execution.inputs, ensure_ascii=False),
                OUTPUT_VALUE: json.dumps(node_execution.outputs, ensure_ascii=False),
            },
            status=TencentSpanBuilder._get_workflow_node_status(node_execution),
        )

    @staticmethod
    def _extract_retrieval_documents(documents: list[Document]):
        """Extract documents data for retrieval tracing."""
        documents_data = []
        for document in documents:
            document_data = {
                "content": document.page_content,
                "metadata": {
                    "dataset_id": document.metadata.get("dataset_id"),
                    "doc_id": document.metadata.get("doc_id"),
                    "document_id": document.metadata.get("document_id"),
                },
                "score": document.metadata.get("score"),
            }
            documents_data.append(document_data)
        return documents_data
