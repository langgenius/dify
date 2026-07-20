import logging
from collections.abc import Sequence
from typing import Any, override

from opentelemetry.trace import SpanKind
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
    WorkflowTraceInfo,
)
from core.repositories import DifyCoreRepositoryFactory
from dify_trace_aliyun.config import AliyunConfig
from dify_trace_aliyun.data_exporter.traceclient import (
    TraceClient,
    build_endpoint,
    convert_datetime_to_nanoseconds,
    convert_to_span_id,
    convert_to_trace_id,
    generate_span_id,
)
from dify_trace_aliyun.entities.aliyun_trace_entity import SpanData, TraceMetadata
from dify_trace_aliyun.entities.semconv import (
    DIFY_APP_ID,
    GEN_AI_AGENT_NAME,
    GEN_AI_COMPLETION,
    GEN_AI_INPUT_MESSAGE,
    GEN_AI_OPERATION_NAME,
    GEN_AI_OUTPUT_MESSAGE,
    GEN_AI_PROMPT,
    GEN_AI_PROVIDER_NAME,
    GEN_AI_REACT_FINISH_REASON,
    GEN_AI_REACT_ROUND,
    GEN_AI_REQUEST_MODEL,
    GEN_AI_RESPONSE_FINISH_REASON,
    GEN_AI_RESPONSE_TIME_TO_FIRST_TOKEN,
    GEN_AI_USAGE_INPUT_TOKENS,
    GEN_AI_USAGE_OUTPUT_TOKENS,
    GEN_AI_USAGE_TOTAL_TOKENS,
    OPERATION_NAME_CHAT,
    OPERATION_NAME_INVOKE_AGENT,
    OPERATION_NAME_REACT,
    RETRIEVAL_DOCUMENT,
    RETRIEVAL_QUERY,
    TOOL_DESCRIPTION,
    TOOL_NAME,
    TOOL_PARAMETERS,
    GenAISpanKind,
)
from dify_trace_aliyun.utils import (
    AgentLogEntry,
    convert_seconds_to_nanoseconds,
    create_common_span_attributes,
    create_links_from_trace_id,
    create_status_from_agent_log_entry,
    create_status_from_error,
    extract_model_name_from_thought_label,
    extract_react_round_number,
    extract_retrieval_documents,
    format_input_messages,
    format_output_messages,
    format_retrieval_documents,
    get_user_id_from_message_data,
    get_workflow_node_status,
    is_llm_thought_entry,
    parse_agent_log_entries,
    serialize_json_data,
)
from extensions.ext_database import db
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
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

    @override
    def trace(self, trace_info: BaseTraceInfo):
        match trace_info:
            case WorkflowTraceInfo():
                self.workflow_trace(trace_info)
            case MessageTraceInfo():
                self.message_trace(trace_info)
            case ModerationTraceInfo():
                pass
            case SuggestedQuestionTraceInfo():
                self.suggested_question_trace(trace_info)
            case DatasetRetrievalTraceInfo():
                self.dataset_retrieval_trace(trace_info)
            case ToolTraceInfo():
                self.tool_trace(trace_info)
            case GenerateNameTraceInfo():
                pass
            case _:
                pass

    def api_check(self):
        return self.trace_client.api_check()

    def get_project_url(self):
        try:
            return self.trace_client.get_project_url()
        except Exception as e:
            logger.info("Aliyun get project url failed: %s", str(e), exc_info=True)
            raise ValueError(f"Aliyun get project url failed: {str(e)}")

    def _extract_app_id(self, trace_info: BaseTraceInfo) -> str:
        """Extract app_id from trace_info, trying metadata first then message_data."""
        app_id = trace_info.metadata.get("app_id")
        if app_id:
            return str(app_id)
        message_data = getattr(trace_info, "message_data", None)
        if message_data is not None:
            return str(getattr(message_data, "app_id", ""))
        return ""

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
            if node_span is not None and node_execution.node_type == BuiltinNodeTypes.AGENT:
                for react_span in self.build_agent_react_spans(node_execution, trace_metadata):
                    self.trace_client.add_span(react_span)

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
            attributes={
                **create_common_span_attributes(
                    session_id=trace_metadata.session_id,
                    user_id=trace_metadata.user_id,
                    span_kind=GenAISpanKind.CHAIN,
                    inputs=inputs_json,
                    outputs=outputs_str,
                ),
                DIFY_APP_ID: self._extract_app_id(trace_info),
            },
            status=status,
            links=trace_metadata.links,
            span_kind=SpanKind.SERVER,
        )
        self.trace_client.add_span(message_span)

        llm_attributes: dict[str, Any] = {
            **create_common_span_attributes(
                session_id=trace_metadata.session_id,
                user_id=trace_metadata.user_id,
                span_kind=GenAISpanKind.LLM,
                inputs=inputs_json,
                outputs=outputs_str,
            ),
            GEN_AI_OPERATION_NAME: OPERATION_NAME_CHAT,
            GEN_AI_REQUEST_MODEL: trace_info.metadata.get("ls_model_name") or "",
            GEN_AI_PROVIDER_NAME: trace_info.metadata.get("ls_provider") or "",
            GEN_AI_USAGE_INPUT_TOKENS: str(trace_info.message_tokens),
            GEN_AI_USAGE_OUTPUT_TOKENS: str(trace_info.answer_tokens),
            GEN_AI_USAGE_TOTAL_TOKENS: str(trace_info.total_tokens),
            GEN_AI_PROMPT: inputs_json,
            GEN_AI_COMPLETION: outputs_str,
        }
        if trace_info.gen_ai_server_time_to_first_token is not None:
            llm_attributes[GEN_AI_RESPONSE_TIME_TO_FIRST_TOKEN] = convert_seconds_to_nanoseconds(
                trace_info.gen_ai_server_time_to_first_token
            )

        llm_span = SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=message_span_id,
            span_id=convert_to_span_id(message_id, "llm"),
            name="llm",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes=llm_attributes,
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
        workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
            session_factory=session_factory,
            tenant_id=trace_info.tenant_id,
            user=service_account,
            app_id=app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        return workflow_node_execution_repository.get_by_workflow_execution(
            workflow_execution_id=trace_info.workflow_run_id
        )

    def build_workflow_node_span(
        self, node_execution: WorkflowNodeExecution, trace_info: WorkflowTraceInfo, trace_metadata: TraceMetadata
    ):
        try:
            if node_execution.node_type == BuiltinNodeTypes.LLM:
                node_span = self.build_workflow_llm_span(trace_info, node_execution, trace_metadata)
            elif node_execution.node_type == BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL:
                node_span = self.build_workflow_retrieval_span(trace_info, node_execution, trace_metadata)
            elif node_execution.node_type == BuiltinNodeTypes.TOOL:
                node_span = self.build_workflow_tool_span(trace_info, node_execution, trace_metadata)
            elif node_execution.node_type == BuiltinNodeTypes.AGENT:
                node_span = self.build_workflow_agent_span(trace_info, node_execution, trace_metadata)
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

        attributes: dict[str, Any] = {
            **create_common_span_attributes(
                session_id=trace_metadata.session_id,
                user_id=trace_metadata.user_id,
                span_kind=GenAISpanKind.LLM,
                inputs=prompts_json,
                outputs=text_output,
            ),
            GEN_AI_OPERATION_NAME: OPERATION_NAME_CHAT,
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
        }
        time_to_first_token = usage_data.get("time_to_first_token")
        if time_to_first_token is not None:
            attributes[GEN_AI_RESPONSE_TIME_TO_FIRST_TOKEN] = convert_seconds_to_nanoseconds(float(time_to_first_token))

        return SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=trace_metadata.workflow_span_id,
            span_id=convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=convert_datetime_to_nanoseconds(node_execution.created_at),
            end_time=convert_datetime_to_nanoseconds(node_execution.finished_at),
            attributes=attributes,
            status=get_workflow_node_status(node_execution),
            links=trace_metadata.links,
        )

    def build_workflow_agent_span(
        self, trace_info: WorkflowTraceInfo, node_execution: WorkflowNodeExecution, trace_metadata: TraceMetadata
    ) -> SpanData:
        """Build an AGENT-kind span for an agent-strategy node (instead of a generic TASK span)."""
        inputs_json = serialize_json_data(node_execution.inputs)
        outputs = node_execution.outputs or {}
        usage_data = outputs.get("usage", {}) or {}
        text_output = str(outputs.get("text", ""))

        attributes: dict[str, Any] = {
            **create_common_span_attributes(
                session_id=trace_metadata.session_id,
                user_id=trace_metadata.user_id,
                span_kind=GenAISpanKind.AGENT,
                inputs=inputs_json,
                outputs=text_output,
            ),
            GEN_AI_OPERATION_NAME: OPERATION_NAME_INVOKE_AGENT,
            GEN_AI_AGENT_NAME: node_execution.title,
            GEN_AI_USAGE_INPUT_TOKENS: str(usage_data.get("prompt_tokens", 0)),
            GEN_AI_USAGE_OUTPUT_TOKENS: str(usage_data.get("completion_tokens", 0)),
            GEN_AI_USAGE_TOTAL_TOKENS: str(usage_data.get("total_tokens", 0)),
        }
        time_to_first_token = usage_data.get("time_to_first_token")
        if time_to_first_token is not None:
            attributes[GEN_AI_RESPONSE_TIME_TO_FIRST_TOKEN] = convert_seconds_to_nanoseconds(float(time_to_first_token))

        return SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=trace_metadata.workflow_span_id,
            span_id=convert_to_span_id(node_execution.id, "node"),
            name=node_execution.title,
            start_time=convert_datetime_to_nanoseconds(node_execution.created_at),
            end_time=convert_datetime_to_nanoseconds(node_execution.finished_at),
            attributes=attributes,
            status=get_workflow_node_status(node_execution),
            links=trace_metadata.links,
        )

    def build_agent_react_spans(
        self, node_execution: WorkflowNodeExecution, trace_metadata: TraceMetadata
    ) -> list[SpanData]:
        """Build ReAct STEP spans (one per round) and their child LLM spans from the agent execution log.

        The agent log lives in ``outputs["json"]``; ``started_at``/``finished_at`` there are
        monotonic-clock seconds, so they are mapped onto wall-clock time by anchoring the
        earliest ``started_at`` to the node's start time. Entries without timing fall back
        to the node's start/end times. Returns an empty list when no log is available.
        """
        try:
            outputs = node_execution.outputs or {}
            round_entries = parse_agent_log_entries(outputs)
            if not round_entries:
                return []

            agent_span_id = convert_to_span_id(node_execution.id, "node")
            node_start_ns = convert_datetime_to_nanoseconds(node_execution.created_at)
            node_end_ns = convert_datetime_to_nanoseconds(node_execution.finished_at)

            monotonic_starts = [
                entry.metadata["started_at"]
                for round_entry in round_entries
                for entry in [round_entry, *round_entry.children]
                if isinstance(entry.metadata.get("started_at"), (int, float))
            ]
            base_monotonic = min(monotonic_starts) if monotonic_starts else None

            def to_wall_clock_ns(monotonic_seconds: Any, fallback: int | None) -> int | None:
                if (
                    isinstance(monotonic_seconds, (int, float))
                    and base_monotonic is not None
                    and node_start_ns is not None
                ):
                    return node_start_ns + convert_seconds_to_nanoseconds(float(monotonic_seconds) - base_monotonic)
                return fallback

            spans: list[SpanData] = []
            for index, round_entry in enumerate(round_entries, start=1):
                round_number = extract_react_round_number(round_entry.label, index)
                step_span_id = generate_span_id()
                step_attributes: dict[str, Any] = {
                    **create_common_span_attributes(
                        session_id=trace_metadata.session_id,
                        user_id=trace_metadata.user_id,
                        span_kind=GenAISpanKind.STEP,
                        inputs="",
                        outputs=serialize_json_data(round_entry.data),
                    ),
                    GEN_AI_OPERATION_NAME: OPERATION_NAME_REACT,
                    GEN_AI_REACT_ROUND: round_number,
                }
                if round_entry.error:
                    step_attributes[GEN_AI_REACT_FINISH_REASON] = "error"
                spans.append(
                    SpanData(
                        trace_id=trace_metadata.trace_id,
                        parent_span_id=agent_span_id,
                        span_id=step_span_id,
                        name=round_entry.label or f"react step {round_number}",
                        start_time=to_wall_clock_ns(round_entry.metadata.get("started_at"), node_start_ns),
                        end_time=to_wall_clock_ns(round_entry.metadata.get("finished_at"), node_end_ns),
                        attributes=step_attributes,
                        status=create_status_from_agent_log_entry(round_entry),
                        links=trace_metadata.links,
                    )
                )

                for child in round_entry.children:
                    if not is_llm_thought_entry(child):
                        continue
                    spans.append(
                        self._build_agent_llm_call_span(
                            entry=child,
                            step_span_id=step_span_id,
                            trace_metadata=trace_metadata,
                            start_time=to_wall_clock_ns(child.metadata.get("started_at"), node_start_ns),
                            end_time=to_wall_clock_ns(child.metadata.get("finished_at"), node_end_ns),
                        )
                    )
            return spans
        except Exception as e:
            logger.warning("Error occurred in build_agent_react_spans: %s", e, exc_info=True)
            return []

    def _build_agent_llm_call_span(
        self,
        entry: AgentLogEntry,
        step_span_id: int,
        trace_metadata: TraceMetadata,
        start_time: int | None,
        end_time: int | None,
    ) -> SpanData:
        completion = str(entry.data.get("thought") or entry.data.get("action") or "")
        return SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=step_span_id,
            span_id=generate_span_id(),
            name=entry.label or "llm",
            start_time=start_time,
            end_time=end_time,
            attributes={
                **create_common_span_attributes(
                    session_id=trace_metadata.session_id,
                    user_id=trace_metadata.user_id,
                    span_kind=GenAISpanKind.LLM,
                    inputs="",
                    outputs=serialize_json_data(entry.data),
                ),
                GEN_AI_OPERATION_NAME: OPERATION_NAME_CHAT,
                GEN_AI_REQUEST_MODEL: extract_model_name_from_thought_label(entry.label),
                GEN_AI_PROVIDER_NAME: str(entry.metadata.get("provider") or ""),
                GEN_AI_USAGE_TOTAL_TOKENS: str(entry.metadata.get("total_tokens", 0)),
                GEN_AI_COMPLETION: completion,
            },
            status=create_status_from_agent_log_entry(entry),
            links=trace_metadata.links,
        )

    def add_workflow_span(self, trace_info: WorkflowTraceInfo, trace_metadata: TraceMetadata):
        message_span_id = None
        if trace_info.message_id:
            message_span_id = convert_to_span_id(trace_info.message_id, "message")
        status = create_status_from_error(trace_info.error)

        inputs_json = serialize_json_data(trace_info.workflow_run_inputs)
        outputs_json = serialize_json_data(trace_info.workflow_run_outputs)

        app_id = self._extract_app_id(trace_info)

        if message_span_id:
            message_span = SpanData(
                trace_id=trace_metadata.trace_id,
                parent_span_id=None,
                span_id=message_span_id,
                name="message",
                start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
                end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
                attributes={
                    **create_common_span_attributes(
                        session_id=trace_metadata.session_id,
                        user_id=trace_metadata.user_id,
                        span_kind=GenAISpanKind.CHAIN,
                        inputs=trace_info.workflow_run_inputs.get("sys.query") or "",
                        outputs=outputs_json,
                    ),
                    DIFY_APP_ID: app_id,
                },
                status=status,
                links=trace_metadata.links,
                span_kind=SpanKind.SERVER,
            )
            self.trace_client.add_span(message_span)

        workflow_span = SpanData(
            trace_id=trace_metadata.trace_id,
            parent_span_id=message_span_id,
            span_id=trace_metadata.workflow_span_id,
            name="workflow",
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                **create_common_span_attributes(
                    session_id=trace_metadata.session_id,
                    user_id=trace_metadata.user_id,
                    span_kind=GenAISpanKind.CHAIN,
                    inputs=inputs_json,
                    outputs=outputs_json,
                ),
                **({DIFY_APP_ID: app_id} if message_span_id is None else {}),
            },
            status=status,
            links=trace_metadata.links,
            span_kind=SpanKind.SERVER if message_span_id is None else SpanKind.INTERNAL,
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
