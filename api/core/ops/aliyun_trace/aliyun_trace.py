import logging
from collections.abc import Sequence

from sqlalchemy.orm import sessionmaker

from core.ops.aliyun_trace.data_exporter.traceclient import (
    TraceClient,
    build_endpoint,
    convert_datetime_to_nanoseconds,
    convert_to_span_id,
    convert_to_trace_id,
    generate_span_id,
)
from core.ops.aliyun_trace.entities.aliyun_trace_entity import SpanData, TraceMetadata
from core.ops.aliyun_trace.entities.semconv import (
    GEN_AI_COMPLETION,
    GEN_AI_INPUT_MESSAGE,
    GEN_AI_OUTPUT_MESSAGE,
    GEN_AI_PROMPT,
    GEN_AI_PROVIDER_NAME,
    GEN_AI_REQUEST_MODEL,
    GEN_AI_RESPONSE_FINISH_REASON,
    GEN_AI_USAGE_INPUT_TOKENS,
    GEN_AI_USAGE_OUTPUT_TOKENS,
    GEN_AI_USAGE_TOTAL_TOKENS,
    RETRIEVAL_DOCUMENT,
    RETRIEVAL_QUERY,
    TOOL_DESCRIPTION,
    TOOL_NAME,
    TOOL_PARAMETERS,
    GenAISpanKind,
)
from core.ops.aliyun_trace.utils import (
    create_common_span_attributes,
    create_links_from_trace_id,
    create_status_from_error,
    extract_retrieval_documents,
    format_input_messages,
    format_output_messages,
    format_retrieval_documents,
    get_user_id_from_message_data,
    get_workflow_node_status,
    serialize_json_data,
)
from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import AliyunConfig
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
from core.repositories import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.entities import WorkflowNodeExecution
from core.workflow.enums import NodeType, WorkflowNodeExecutionMetadataKey
from extensions.ext_database import db
from models import WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


class AliyunDataTrace(BaseTraceInstance):
    def __init__(
        self,
        aliyun_config: AliyunConfig,
    ):
        super().__init__(aliyun_config)
        endpoint = build_endpoint(aliyun_config.endpoint, aliyun_config.license_key)
        self.trace_client = TraceClient(service_name=aliyun_config.app_name, endpoint=endpoint)

    def trace(self, trace_info: BaseTraceInfo):
        if isinstance(trace_info, WorkflowTraceInfo):
            self.workflow_trace(trace_info)
        if isinstance(trace_info, MessageTraceInfo):
            self.message_trace(trace_info)
        if isinstance(trace_info, ModerationTraceInfo):
            pass
        if isinstance(trace_info, SuggestedQuestionTraceInfo):
            self.suggested_question_trace(trace_info)
        if isinstance(trace_info, DatasetRetrievalTraceInfo):
            self.dataset_retrieval_trace(trace_info)
        if isinstance(trace_info, ToolTraceInfo):
            self.tool_trace(trace_info)
        if isinstance(trace_info, GenerateNameTraceInfo):
            pass

    def api_check(self):
        return self.trace_client.api_check()

    def get_project_url(self):
        try:
            return self.trace_client.get_project_url()
        except Exception as e:
            logger.info("Aliyun get project url failed: %s", str(e), exc_info=True)
            raise ValueError(f"Aliyun get project url failed: {str(e)}")

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        trace_metadata = TraceMetadata(
            trace_id=convert_to_trace_id(trace_info.workflow_run_id),
            workflow_span_id=convert_to_span_id(trace_info.workflow_run_id, "workflow"),
            session_id=trace_info.metadata.get("conversation_id") or "",
            user_id=str(trace_info.metadata.get("user_id") or ""),
            links=create_links_from_trace_id(trace_info.trace_id),
        )

        self.add_workflow_span(trace_info, trace_metadata)

        workflow_node_executions = self.get_workflow_node_executions(trace_info)
        for node_execution in workflow_node_executions:
            node_span = self.build_workflow_node_span(node_execution, trace_info, trace_metadata)
            self.trace_client.add_span(node_span)

    def message_trace(self, trace_info: MessageTraceInfo):
        message_data = trace_info.message_data
        if message_data is None:
            return

        message_id = trace_info.message_id
        user_id = get_user_id_from_message_data(message_data)
        status = create_status_from_error(trace_info.error)

        trace_metadata = TraceMetadata(
            trace_id=convert_to_trace_id(message_id),
            workflow_span_id=0,
            session_id=trace_info.metadata.get("conversation_id") or "",
            user_id=user_id,
            links=create_links_from_trace_id(trace_info.trace_id),
        )

        inputs_json = serialize_json_data(trace_info.inputs)
        outputs_str = str(trace_info.outputs)

        message_span_id = convert_to_span_id(message_id, "message")
        message_span = SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=None,
            span_id=message_span_id,
            name="message",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes=create_common_span_attributes(
                session_id=trace_metadata.session_id,
                user_id=trace_metadata.user_id,
                span_kind=GenAISpanKind.CHAIN,
                inputs=inputs_json,
                outputs=outputs_str,
            ),
            status=status,
            links=trace_metadata.links,
        )
        self.trace_client.add_span(message_span)

        llm_span = SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=message_span_id,
            span_id=convert_to_span_id(message_id, "llm"),
            name="llm",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                **create_common_span_attributes(
                    session_id=trace_metadata.session_id,
                    user_id=trace_metadata.user_id,
                    span_kind=GenAISpanKind.LLM,
                    inputs=inputs_json,
                    outputs=outputs_str,
                ),
                GEN_AI_REQUEST_MODEL: trace_info.metadata.get("ls_model_name") or "",
                GEN_AI_PROVIDER_NAME: trace_info.metadata.get("ls_provider") or "",
                GEN_AI_USAGE_INPUT_TOKENS: str(trace_info.message_tokens),
                GEN_AI_USAGE_OUTPUT_TOKENS: str(trace_info.answer_tokens),
                GEN_AI_USAGE_TOTAL_TOKENS: str(trace_info.total_tokens),
                GEN_AI_PROMPT: inputs_json,
                GEN_AI_COMPLETION: outputs_str,
            },
            status=status,
            links=trace_metadata.links,
        )
        self.trace_client.add_span(llm_span)

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            return

        message_id = trace_info.message_id

        trace_metadata = TraceMetadata(
            trace_id=convert_to_trace_id(message_id),
            workflow_span_id=0,
            session_id=trace_info.metadata.get("conversation_id") or "",
            user_id=str(trace_info.metadata.get("user_id") or ""),
            links=create_links_from_trace_id(trace_info.trace_id),
        )

        documents_data = extract_retrieval_documents(trace_info.documents)
        documents_json = serialize_json_data(documents_data)
        inputs_str = str(trace_info.inputs)

        dataset_retrieval_span = SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=convert_to_span_id(message_id, "message"),
            span_id=generate_span_id(),
            name="dataset_retrieval",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                **create_common_span_attributes(
                    session_id=trace_metadata.session_id,
                    user_id=trace_metadata.user_id,
                    span_kind=GenAISpanKind.RETRIEVER,
                    inputs=inputs_str,
                    outputs=documents_json,
                ),
                RETRIEVAL_QUERY: inputs_str,
                RETRIEVAL_DOCUMENT: documents_json,
            },
            links=trace_metadata.links,
        )
        self.trace_client.add_span(dataset_retrieval_span)

    def tool_trace(self, trace_info: ToolTraceInfo):
        if trace_info.message_data is None:
            return

        message_id = trace_info.message_id
        status = create_status_from_error(trace_info.error)

        trace_metadata = TraceMetadata(
            trace_id=convert_to_trace_id(message_id),
            workflow_span_id=0,
            session_id=trace_info.metadata.get("conversation_id") or "",
            user_id=str(trace_info.metadata.get("user_id") or ""),
            links=create_links_from_trace_id(trace_info.trace_id),
        )

        tool_config_json = serialize_json_data(trace_info.tool_config)
        tool_inputs_json = serialize_json_data(trace_info.tool_inputs)
        inputs_json = serialize_json_data(trace_info.inputs)

        tool_span = SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=convert_to_span_id(message_id, "message"),
            span_id=generate_span_id(),
            name=trace_info.tool_name,
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                **create_common_span_attributes(
                    session_id=trace_metadata.session_id,
                    user_id=trace_metadata.user_id,
                    span_kind=GenAISpanKind.TOOL,
                    inputs=inputs_json,
                    outputs=str(trace_info.tool_outputs),
                ),
                TOOL_NAME: trace_info.tool_name,
                TOOL_DESCRIPTION: tool_config_json,
                TOOL_PARAMETERS: tool_inputs_json,
            },
            status=status,
            links=trace_metadata.links,
        )
        self.trace_client.add_span(tool_span)

    def get_workflow_node_executions(self, trace_info: WorkflowTraceInfo) -> Sequence[WorkflowNodeExecution]:
        app_id = trace_info.metadata.get("app_id")
        if not app_id:
            raise ValueError("No app_id found in trace_info metadata")

        service_account = self.get_service_account_with_tenant(app_id)

        session_factory = sessionmaker(bind=db.engine)
        workflow_node_execution_repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=session_factory,
            user=service_account,
            app_id=app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        return workflow_node_execution_repository.get_by_workflow_run(workflow_run_id=trace_info.workflow_run_id)

    def build_workflow_node_span(
        self, node_execution: WorkflowNodeExecution, trace_info: WorkflowTraceInfo, trace_metadata: TraceMetadata
    ):
        try:
            if node_execution.node_type == NodeType.LLM:
                node_span = self.build_workflow_llm_span(trace_info, node_execution, trace_metadata)
            elif node_execution.node_type == NodeType.KNOWLEDGE_RETRIEVAL:
                node_span = self.build_workflow_retrieval_span(trace_info, node_execution, trace_metadata)
            elif node_execution.node_type == NodeType.TOOL:
                node_span = self.build_workflow_tool_span(trace_info, node_execution, trace_metadata)
            else:
                node_span = self.build_workflow_task_span(trace_info, node_execution, trace_metadata)
            return node_span
        except Exception as e:
            logger.warning("Error occurred in build_workflow_node_span: %s", e, exc_info=True)
            return None

    def build_workflow_task_span(
        self, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution, trace_metadata: TraceMetadata
    ) -> SpanData:
        inputs_json = serialize_json_data(node_execution.inputs)
        outputs_json = serialize_json_data(node_execution.outputs)
        return SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=trace_metadata.workflow_span_id,
            span_id=convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=convert_datetime_to_nanoseconds(node_execution.created_at),
            end_time=convert_datetime_to_nanoseconds(node_execution.finished_at),
            attributes=create_common_span_attributes(
                session_id=trace_metadata.session_id,
                user_id=trace_metadata.user_id,
                span_kind=GenAISpanKind.TASK,
                inputs=inputs_json,
                outputs=outputs_json,
            ),
            status=get_workflow_node_status(node_execution),
            links=trace_metadata.links,
        )

    def build_workflow_tool_span(
        self, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution, trace_metadata: TraceMetadata
    ) -> SpanData:
        tool_des = {}
        if node_execution.metadata:
            tool_des = node_execution.metadata.get(WorkflowNodeExecutionMetadataKey.TOOL_INFO, {})

        inputs_json = serialize_json_data(node_execution.inputs or {})
        outputs_json = serialize_json_data(node_execution.outputs)

        return SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=trace_metadata.workflow_span_id,
            span_id=convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=convert_datetime_to_nanoseconds(node_execution.created_at),
            end_time=convert_datetime_to_nanoseconds(node_execution.finished_at),
            attributes={
                **create_common_span_attributes(
                    session_id=trace_metadata.session_id,
                    user_id=trace_metadata.user_id,
                    span_kind=GenAISpanKind.TOOL,
                    inputs=inputs_json,
                    outputs=outputs_json,
                ),
                TOOL_NAME: node_execution.title,
                TOOL_DESCRIPTION: serialize_json_data(tool_des),
                TOOL_PARAMETERS: inputs_json,
            },
            status=get_workflow_node_status(node_execution),
            links=trace_metadata.links,
        )

    def build_workflow_retrieval_span(
        self, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution, trace_metadata: TraceMetadata
    ) -> SpanData:
        input_value = str(node_execution.inputs.get("query", "")) if node_execution.inputs else ""
        output_value = serialize_json_data(node_execution.outputs.get("result", [])) if node_execution.outputs else ""

        retrieval_documents = node_execution.outputs.get("result", []) if node_execution.outputs else []
        semantic_retrieval_documents = format_retrieval_documents(retrieval_documents)
        semantic_retrieval_documents_json = serialize_json_data(semantic_retrieval_documents)

        return SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=trace_metadata.workflow_span_id,
            span_id=convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=convert_datetime_to_nanoseconds(node_execution.created_at),
            end_time=convert_datetime_to_nanoseconds(node_execution.finished_at),
            attributes={
                **create_common_span_attributes(
                    session_id=trace_metadata.session_id,
                    user_id=trace_metadata.user_id,
                    span_kind=GenAISpanKind.RETRIEVER,
                    inputs=input_value,
                    outputs=output_value,
                ),
                RETRIEVAL_QUERY: input_value,
                RETRIEVAL_DOCUMENT: semantic_retrieval_documents_json,
            },
            status=get_workflow_node_status(node_execution),
            links=trace_metadata.links,
        )

    def build_workflow_llm_span(
        self, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution, trace_metadata: TraceMetadata
    ) -> SpanData:
        process_data = node_execution.process_data or {}
        outputs = node_execution.outputs or {}
        usage_data = process_data.get("usage", {}) if "usage" in process_data else outputs.get("usage", {})

        prompts_json = serialize_json_data(process_data.get("prompts", []))
        text_output = str(outputs.get("text", ""))

        gen_ai_input_message = format_input_messages(process_data)
        gen_ai_output_message = format_output_messages(outputs)

        return SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=trace_metadata.workflow_span_id,
            span_id=convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=convert_datetime_to_nanoseconds(node_execution.created_at),
            end_time=convert_datetime_to_nanoseconds(node_execution.finished_at),
            attributes={
                **create_common_span_attributes(
                    session_id=trace_metadata.session_id,
                    user_id=trace_metadata.user_id,
                    span_kind=GenAISpanKind.LLM,
                    inputs=prompts_json,
                    outputs=text_output,
                ),
                GEN_AI_REQUEST_MODEL: process_data.get("model_name") or "",
                GEN_AI_PROVIDER_NAME: process_data.get("model_provider") or "",
                GEN_AI_USAGE_INPUT_TOKENS: str(usage_data.get("prompt_tokens", 0)),
                GEN_AI_USAGE_OUTPUT_TOKENS: str(usage_data.get("completion_tokens", 0)),
                GEN_AI_USAGE_TOTAL_TOKENS: str(usage_data.get("total_tokens", 0)),
                GEN_AI_PROMPT: prompts_json,
                GEN_AI_COMPLETION: text_output,
                GEN_AI_RESPONSE_FINISH_REASON: outputs.get("finish_reason") or "",
                GEN_AI_INPUT_MESSAGE: gen_ai_input_message,
                GEN_AI_OUTPUT_MESSAGE: gen_ai_output_message,
            },
            status=get_workflow_node_status(node_execution),
            links=trace_metadata.links,
        )

    def add_workflow_span(self, trace_info: WorkflowTraceInfo, trace_metadata: TraceMetadata):
        message_span_id = None
        if trace_info.message_id:
            message_span_id = convert_to_span_id(trace_info.message_id, "message")
        status = create_status_from_error(trace_info.error)

        inputs_json = serialize_json_data(trace_info.workflow_run_inputs)
        outputs_json = serialize_json_data(trace_info.workflow_run_outputs)

        if message_span_id:
            message_span = SpanData(
                trace_id=trace_metadata.trace_id,
                parent_span_id=None,
                span_id=message_span_id,
                name="message",
                start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
                end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
                attributes=create_common_span_attributes(
                    session_id=trace_metadata.session_id,
                    user_id=trace_metadata.user_id,
                    span_kind=GenAISpanKind.CHAIN,
                    inputs=trace_info.workflow_run_inputs.get("sys.query") or "",
                    outputs=outputs_json,
                ),
                status=status,
                links=trace_metadata.links,
            )
            self.trace_client.add_span(message_span)

        workflow_span = SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=message_span_id,
            span_id=trace_metadata.workflow_span_id,
            name="workflow",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes=create_common_span_attributes(
                session_id=trace_metadata.session_id,
                user_id=trace_metadata.user_id,
                span_kind=GenAISpanKind.CHAIN,
                inputs=inputs_json,
                outputs=outputs_json,
            ),
            status=status,
            links=trace_metadata.links,
        )
        self.trace_client.add_span(workflow_span)

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        message_id = trace_info.message_id
        status = create_status_from_error(trace_info.error)

        trace_metadata = TraceMetadata(
            trace_id=convert_to_trace_id(message_id),
            workflow_span_id=0,
            session_id=trace_info.metadata.get("conversation_id") or "",
            user_id=str(trace_info.metadata.get("user_id") or ""),
            links=create_links_from_trace_id(trace_info.trace_id),
        )

        inputs_json = serialize_json_data(trace_info.inputs)
        suggested_question_json = serialize_json_data(trace_info.suggested_question)

        suggested_question_span = SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=convert_to_span_id(message_id, "message"),
            span_id=convert_to_span_id(message_id, "suggested_question"),
            name="suggested_question",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                **create_common_span_attributes(
                    session_id=trace_metadata.session_id,
                    user_id=trace_metadata.user_id,
                    span_kind=GenAISpanKind.LLM,
                    inputs=inputs_json,
                    outputs=suggested_question_json,
                ),
                GEN_AI_REQUEST_MODEL: trace_info.metadata.get("ls_model_name") or "",
                GEN_AI_PROVIDER_NAME: trace_info.metadata.get("ls_provider") or "",
                GEN_AI_PROMPT: inputs_json,
                GEN_AI_COMPLETION: suggested_question_json,
            },
            status=status,
            links=trace_metadata.links,
        )
        self.trace_client.add_span(suggested_question_span)
