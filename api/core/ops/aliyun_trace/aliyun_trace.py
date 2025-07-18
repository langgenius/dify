import json
import logging
from collections.abc import Sequence
from typing import Optional
from urllib.parse import urljoin

from opentelemetry.trace import Status, StatusCode
from sqlalchemy.orm import Session, sessionmaker

from core.ops.aliyun_trace.data_exporter.traceclient import (
    TraceClient,
    convert_datetime_to_nanoseconds,
    convert_to_span_id,
    convert_to_trace_id,
    generate_span_id,
)
from core.ops.aliyun_trace.entities.aliyun_trace_entity import SpanData
from core.ops.aliyun_trace.entities.semconv import (
    GEN_AI_COMPLETION,
    GEN_AI_FRAMEWORK,
    GEN_AI_MODEL_NAME,
    GEN_AI_PROMPT,
    GEN_AI_PROMPT_TEMPLATE_TEMPLATE,
    GEN_AI_PROMPT_TEMPLATE_VARIABLE,
    GEN_AI_RESPONSE_FINISH_REASON,
    GEN_AI_SESSION_ID,
    GEN_AI_SPAN_KIND,
    GEN_AI_SYSTEM,
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
from core.rag.models.document import Document
from core.repositories import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.nodes import NodeType
from models import Account, App, EndUser, TenantAccountJoin, WorkflowNodeExecutionTriggeredFrom, db

logger = logging.getLogger(__name__)


class AliyunDataTrace(BaseTraceInstance):
    def __init__(
        self,
        aliyun_config: AliyunConfig,
    ):
        super().__init__(aliyun_config)
        base_url = aliyun_config.endpoint.rstrip("/")
        endpoint = urljoin(base_url, f"adapt_{aliyun_config.license_key}/api/otlp/traces")
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
            logger.info(f"Aliyun get run url failed: {str(e)}", exc_info=True)
            raise ValueError(f"Aliyun get run url failed: {str(e)}")

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        trace_id = convert_to_trace_id(trace_info.workflow_run_id)
        workflow_span_id = convert_to_span_id(trace_info.workflow_run_id, "workflow")
        self.add_workflow_span(trace_id, workflow_span_id, trace_info)

        workflow_node_executions = self.get_workflow_node_executions(trace_info)
        for node_execution in workflow_node_executions:
            node_span = self.build_workflow_node_span(node_execution, trace_id, trace_info, workflow_span_id)
            self.trace_client.add_span(node_span)

    def message_trace(self, trace_info: MessageTraceInfo):
        message_data = trace_info.message_data
        if message_data is None:
            return
        message_id = trace_info.message_id

        user_id = message_data.from_account_id
        if message_data.from_end_user_id:
            end_user_data: Optional[EndUser] = (
                db.session.query(EndUser).filter(EndUser.id == message_data.from_end_user_id).first()
            )
            if end_user_data is not None:
                user_id = end_user_data.session_id

        status: Status = Status(StatusCode.OK)
        if trace_info.error:
            status = Status(StatusCode.ERROR, trace_info.error)

        trace_id = convert_to_trace_id(message_id)
        message_span_id = convert_to_span_id(message_id, "message")
        message_span = SpanData(
            trace_id=trace_id,
            parent_span_id=None,
            span_id=message_span_id,
            name="message",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                GEN_AI_SESSION_ID: trace_info.metadata.get("conversation_id", ""),
                GEN_AI_USER_ID: str(user_id),
                GEN_AI_SPAN_KIND: GenAISpanKind.CHAIN.value,
                GEN_AI_FRAMEWORK: "dify",
                INPUT_VALUE: json.dumps(trace_info.inputs, ensure_ascii=False),
                OUTPUT_VALUE: str(trace_info.outputs),
            },
            status=status,
        )
        self.trace_client.add_span(message_span)

        app_model_config = getattr(trace_info.message_data, "app_model_config", {})
        pre_prompt = getattr(app_model_config, "pre_prompt", "")
        inputs_data = getattr(trace_info.message_data, "inputs", {})
        llm_span = SpanData(
            trace_id=trace_id,
            parent_span_id=message_span_id,
            span_id=convert_to_span_id(message_id, "llm"),
            name="llm",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                GEN_AI_SESSION_ID: trace_info.metadata.get("conversation_id", ""),
                GEN_AI_USER_ID: str(user_id),
                GEN_AI_SPAN_KIND: GenAISpanKind.LLM.value,
                GEN_AI_FRAMEWORK: "dify",
                GEN_AI_MODEL_NAME: trace_info.metadata.get("ls_model_name", ""),
                GEN_AI_SYSTEM: trace_info.metadata.get("ls_provider", ""),
                GEN_AI_USAGE_INPUT_TOKENS: str(trace_info.message_tokens),
                GEN_AI_USAGE_OUTPUT_TOKENS: str(trace_info.answer_tokens),
                GEN_AI_USAGE_TOTAL_TOKENS: str(trace_info.total_tokens),
                GEN_AI_PROMPT_TEMPLATE_VARIABLE: json.dumps(inputs_data, ensure_ascii=False),
                GEN_AI_PROMPT_TEMPLATE_TEMPLATE: pre_prompt,
                GEN_AI_PROMPT: json.dumps(trace_info.inputs, ensure_ascii=False),
                GEN_AI_COMPLETION: str(trace_info.outputs),
                INPUT_VALUE: json.dumps(trace_info.inputs, ensure_ascii=False),
                OUTPUT_VALUE: str(trace_info.outputs),
            },
            status=status,
        )
        self.trace_client.add_span(llm_span)

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            return
        message_id = trace_info.message_id

        documents_data = extract_retrieval_documents(trace_info.documents)
        dataset_retrieval_span = SpanData(
            trace_id=convert_to_trace_id(message_id),
            parent_span_id=convert_to_span_id(message_id, "message"),
            span_id=generate_span_id(),
            name="dataset_retrieval",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                GEN_AI_SPAN_KIND: GenAISpanKind.RETRIEVER.value,
                GEN_AI_FRAMEWORK: "dify",
                RETRIEVAL_QUERY: str(trace_info.inputs),
                RETRIEVAL_DOCUMENT: json.dumps(documents_data, ensure_ascii=False),
                INPUT_VALUE: str(trace_info.inputs),
                OUTPUT_VALUE: json.dumps(documents_data, ensure_ascii=False),
            },
        )
        self.trace_client.add_span(dataset_retrieval_span)

    def tool_trace(self, trace_info: ToolTraceInfo):
        if trace_info.message_data is None:
            return
        message_id = trace_info.message_id

        status: Status = Status(StatusCode.OK)
        if trace_info.error:
            status = Status(StatusCode.ERROR, trace_info.error)

        tool_span = SpanData(
            trace_id=convert_to_trace_id(message_id),
            parent_span_id=convert_to_span_id(message_id, "message"),
            span_id=generate_span_id(),
            name=trace_info.tool_name,
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                GEN_AI_SPAN_KIND: GenAISpanKind.TOOL.value,
                GEN_AI_FRAMEWORK: "dify",
                TOOL_NAME: trace_info.tool_name,
                TOOL_DESCRIPTION: json.dumps(trace_info.tool_config, ensure_ascii=False),
                TOOL_PARAMETERS: json.dumps(trace_info.tool_inputs, ensure_ascii=False),
                INPUT_VALUE: json.dumps(trace_info.inputs, ensure_ascii=False),
                OUTPUT_VALUE: str(trace_info.tool_outputs),
            },
            status=status,
        )
        self.trace_client.add_span(tool_span)

    def get_workflow_node_executions(self, trace_info: WorkflowTraceInfo) -> Sequence[WorkflowNodeExecution]:
        # through workflow_run_id get all_nodes_execution using repository
        session_factory = sessionmaker(bind=db.engine)
        # Find the app's creator account
        with Session(db.engine, expire_on_commit=False) as session:
            # Get the app to find its creator
            app_id = trace_info.metadata.get("app_id")
            if not app_id:
                raise ValueError("No app_id found in trace_info metadata")

            app = session.query(App).filter(App.id == app_id).first()
            if not app:
                raise ValueError(f"App with id {app_id} not found")

            if not app.created_by:
                raise ValueError(f"App with id {app_id} has no creator (created_by is None)")

            service_account = session.query(Account).filter(Account.id == app.created_by).first()
            if not service_account:
                raise ValueError(f"Creator account with id {app.created_by} not found for app {app_id}")
            current_tenant = (
                session.query(TenantAccountJoin).filter_by(account_id=service_account.id, current=True).first()
            )
            if not current_tenant:
                raise ValueError(f"Current tenant not found for account {service_account.id}")
            service_account.set_tenant_id(current_tenant.tenant_id)
        workflow_node_execution_repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=session_factory,
            user=service_account,
            app_id=trace_info.metadata.get("app_id"),
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        # Get all executions for this workflow run
        workflow_node_executions = workflow_node_execution_repository.get_by_workflow_run(
            workflow_run_id=trace_info.workflow_run_id
        )
        return workflow_node_executions

    def build_workflow_node_span(
        self, node_execution: WorkflowNodeExecution, trace_id: int, trace_info: WorkflowTraceInfo, workflow_span_id: int
    ):
        try:
            if node_execution.node_type == NodeType.LLM:
                node_span = self.build_workflow_llm_span(trace_id, workflow_span_id, trace_info, node_execution)
            elif node_execution.node_type == NodeType.KNOWLEDGE_RETRIEVAL:
                node_span = self.build_workflow_retrieval_span(trace_id, workflow_span_id, trace_info, node_execution)
            elif node_execution.node_type == NodeType.TOOL:
                node_span = self.build_workflow_tool_span(trace_id, workflow_span_id, trace_info, node_execution)
            else:
                node_span = self.build_workflow_task_span(trace_id, workflow_span_id, trace_info, node_execution)
            return node_span
        except Exception as e:
            logging.debug(f"Error occurred in build_workflow_node_span: {e}", exc_info=True)
            return None

    def get_workflow_node_status(self, node_execution: WorkflowNodeExecution) -> Status:
        span_status: Status = Status(StatusCode.UNSET)
        if node_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED:
            span_status = Status(StatusCode.OK)
        elif node_execution.status in [WorkflowNodeExecutionStatus.FAILED, WorkflowNodeExecutionStatus.EXCEPTION]:
            span_status = Status(StatusCode.ERROR, str(node_execution.error))
        return span_status

    def build_workflow_task_span(
        self, trace_id: int, workflow_span_id: int, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution
    ) -> SpanData:
        return SpanData(
            trace_id=trace_id,
            parent_span_id=workflow_span_id,
            span_id=convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=convert_datetime_to_nanoseconds(node_execution.created_at),
            end_time=convert_datetime_to_nanoseconds(node_execution.finished_at),
            attributes={
                GEN_AI_SESSION_ID: trace_info.metadata.get("conversation_id") or "",
                GEN_AI_SPAN_KIND: GenAISpanKind.TASK.value,
                GEN_AI_FRAMEWORK: "dify",
                INPUT_VALUE: json.dumps(node_execution.inputs, ensure_ascii=False),
                OUTPUT_VALUE: json.dumps(node_execution.outputs, ensure_ascii=False),
            },
            status=self.get_workflow_node_status(node_execution),
        )

    def build_workflow_tool_span(
        self, trace_id: int, workflow_span_id: int, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution
    ) -> SpanData:
        tool_des = {}
        if node_execution.metadata:
            tool_des = node_execution.metadata.get(WorkflowNodeExecutionMetadataKey.TOOL_INFO, {})
        return SpanData(
            trace_id=trace_id,
            parent_span_id=workflow_span_id,
            span_id=convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=convert_datetime_to_nanoseconds(node_execution.created_at),
            end_time=convert_datetime_to_nanoseconds(node_execution.finished_at),
            attributes={
                GEN_AI_SPAN_KIND: GenAISpanKind.TOOL.value,
                GEN_AI_FRAMEWORK: "dify",
                TOOL_NAME: node_execution.title,
                TOOL_DESCRIPTION: json.dumps(tool_des, ensure_ascii=False),
                TOOL_PARAMETERS: json.dumps(node_execution.inputs if node_execution.inputs else {}, ensure_ascii=False),
                INPUT_VALUE: json.dumps(node_execution.inputs if node_execution.inputs else {}, ensure_ascii=False),
                OUTPUT_VALUE: json.dumps(node_execution.outputs, ensure_ascii=False),
            },
            status=self.get_workflow_node_status(node_execution),
        )

    def build_workflow_retrieval_span(
        self, trace_id: int, workflow_span_id: int, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution
    ) -> SpanData:
        input_value = ""
        if node_execution.inputs:
            input_value = str(node_execution.inputs.get("query", ""))
        output_value = ""
        if node_execution.outputs:
            output_value = json.dumps(node_execution.outputs.get("result", []), ensure_ascii=False)
        return SpanData(
            trace_id=trace_id,
            parent_span_id=workflow_span_id,
            span_id=convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=convert_datetime_to_nanoseconds(node_execution.created_at),
            end_time=convert_datetime_to_nanoseconds(node_execution.finished_at),
            attributes={
                GEN_AI_SPAN_KIND: GenAISpanKind.RETRIEVER.value,
                GEN_AI_FRAMEWORK: "dify",
                RETRIEVAL_QUERY: input_value,
                RETRIEVAL_DOCUMENT: output_value,
                INPUT_VALUE: input_value,
                OUTPUT_VALUE: output_value,
            },
            status=self.get_workflow_node_status(node_execution),
        )

    def build_workflow_llm_span(
        self, trace_id: int, workflow_span_id: int, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution
    ) -> SpanData:
        process_data = node_execution.process_data or {}
        outputs = node_execution.outputs or {}
        usage_data = process_data.get("usage", {}) if "usage" in process_data else outputs.get("usage", {})
        return SpanData(
            trace_id=trace_id,
            parent_span_id=workflow_span_id,
            span_id=convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=convert_datetime_to_nanoseconds(node_execution.created_at),
            end_time=convert_datetime_to_nanoseconds(node_execution.finished_at),
            attributes={
                GEN_AI_SESSION_ID: trace_info.metadata.get("conversation_id") or "",
                GEN_AI_SPAN_KIND: GenAISpanKind.LLM.value,
                GEN_AI_FRAMEWORK: "dify",
                GEN_AI_MODEL_NAME: process_data.get("model_name", ""),
                GEN_AI_SYSTEM: process_data.get("model_provider", ""),
                GEN_AI_USAGE_INPUT_TOKENS: str(usage_data.get("prompt_tokens", 0)),
                GEN_AI_USAGE_OUTPUT_TOKENS: str(usage_data.get("completion_tokens", 0)),
                GEN_AI_USAGE_TOTAL_TOKENS: str(usage_data.get("total_tokens", 0)),
                GEN_AI_PROMPT: json.dumps(process_data.get("prompts", []), ensure_ascii=False),
                GEN_AI_COMPLETION: str(outputs.get("text", "")),
                GEN_AI_RESPONSE_FINISH_REASON: outputs.get("finish_reason", ""),
                INPUT_VALUE: json.dumps(process_data.get("prompts", []), ensure_ascii=False),
                OUTPUT_VALUE: str(outputs.get("text", "")),
            },
            status=self.get_workflow_node_status(node_execution),
        )

    def add_workflow_span(self, trace_id: int, workflow_span_id: int, trace_info: WorkflowTraceInfo):
        message_span_id = None
        if trace_info.message_id:
            message_span_id = convert_to_span_id(trace_info.message_id, "message")
        user_id = trace_info.metadata.get("user_id")
        status: Status = Status(StatusCode.OK)
        if trace_info.error:
            status = Status(StatusCode.ERROR, trace_info.error)
        if message_span_id:  # chatflow
            message_span = SpanData(
                trace_id=trace_id,
                parent_span_id=None,
                span_id=message_span_id,
                name="message",
                start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
                end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
                attributes={
                    GEN_AI_SESSION_ID: trace_info.metadata.get("conversation_id") or "",
                    GEN_AI_USER_ID: str(user_id),
                    GEN_AI_SPAN_KIND: GenAISpanKind.CHAIN.value,
                    GEN_AI_FRAMEWORK: "dify",
                    INPUT_VALUE: trace_info.workflow_run_inputs.get("sys.query", ""),
                    OUTPUT_VALUE: json.dumps(trace_info.workflow_run_outputs, ensure_ascii=False),
                },
                status=status,
            )
            self.trace_client.add_span(message_span)

        workflow_span = SpanData(
            trace_id=trace_id,
            parent_span_id=message_span_id,
            span_id=workflow_span_id,
            name="workflow",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                GEN_AI_USER_ID: str(user_id),
                GEN_AI_SPAN_KIND: GenAISpanKind.CHAIN.value,
                GEN_AI_FRAMEWORK: "dify",
                INPUT_VALUE: json.dumps(trace_info.workflow_run_inputs, ensure_ascii=False),
                OUTPUT_VALUE: json.dumps(trace_info.workflow_run_outputs, ensure_ascii=False),
            },
            status=status,
        )
        self.trace_client.add_span(workflow_span)

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        message_id = trace_info.message_id
        status: Status = Status(StatusCode.OK)
        if trace_info.error:
            status = Status(StatusCode.ERROR, trace_info.error)
        suggested_question_span = SpanData(
            trace_id=convert_to_trace_id(message_id),
            parent_span_id=convert_to_span_id(message_id, "message"),
            span_id=convert_to_span_id(message_id, "suggested_question"),
            name="suggested_question",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                GEN_AI_SPAN_KIND: GenAISpanKind.LLM.value,
                GEN_AI_FRAMEWORK: "dify",
                GEN_AI_MODEL_NAME: trace_info.metadata.get("ls_model_name", ""),
                GEN_AI_SYSTEM: trace_info.metadata.get("ls_provider", ""),
                GEN_AI_PROMPT: json.dumps(trace_info.inputs, ensure_ascii=False),
                GEN_AI_COMPLETION: json.dumps(trace_info.suggested_question, ensure_ascii=False),
                INPUT_VALUE: json.dumps(trace_info.inputs, ensure_ascii=False),
                OUTPUT_VALUE: json.dumps(trace_info.suggested_question, ensure_ascii=False),
            },
            status=status,
        )
        self.trace_client.add_span(suggested_question_span)


def extract_retrieval_documents(documents: list[Document]):
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
