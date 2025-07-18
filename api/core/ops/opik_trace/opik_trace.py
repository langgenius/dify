import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional, cast

from opik import Opik, Trace
from opik.id_helpers import uuid4_to_uuid7
from sqlalchemy.orm import sessionmaker

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import OpikConfig
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
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey
from core.workflow.nodes.enums import NodeType
from extensions.ext_database import db
from models import EndUser, MessageFile, WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


def wrap_dict(key_name, data):
    """Make sure that the input data is a dict"""
    if not isinstance(data, dict):
        return {key_name: data}

    return data


def wrap_metadata(metadata, **kwargs):
    """Add common metatada to all Traces and Spans"""
    metadata["created_from"] = "dify"

    metadata.update(kwargs)

    return metadata


def prepare_opik_uuid(user_datetime: Optional[datetime], user_uuid: Optional[str]):
    """Opik needs UUIDv7 while Dify uses UUIDv4 for identifier of most
    messages and objects. The type-hints of BaseTraceInfo indicates that
    objects start_time and message_id could be null which means we cannot map
    it to a UUIDv7. Given that we have no way to identify that object
    uniquely, generate a new random one UUIDv7 in that case.
    """

    if user_datetime is None:
        user_datetime = datetime.now()

    if user_uuid is None:
        user_uuid = str(uuid.uuid4())

    return uuid4_to_uuid7(user_datetime, user_uuid)


class OpikDataTrace(BaseTraceInstance):
    def __init__(
        self,
        opik_config: OpikConfig,
    ):
        super().__init__(opik_config)
        self.opik_client = Opik(
            project_name=opik_config.project,
            workspace=opik_config.workspace,
            host=opik_config.url,
            api_key=opik_config.api_key,
        )
        self.project = opik_config.project
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")

    def trace(self, trace_info: BaseTraceInfo):
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

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        dify_trace_id = trace_info.workflow_run_id
        opik_trace_id = prepare_opik_uuid(trace_info.start_time, dify_trace_id)
        workflow_metadata = wrap_metadata(
            trace_info.metadata, message_id=trace_info.message_id, workflow_app_log_id=trace_info.workflow_app_log_id
        )
        root_span_id = None

        if trace_info.message_id:
            dify_trace_id = trace_info.message_id
            opik_trace_id = prepare_opik_uuid(trace_info.start_time, dify_trace_id)

            trace_data = {
                "id": opik_trace_id,
                "name": TraceTaskName.MESSAGE_TRACE.value,
                "start_time": trace_info.start_time,
                "end_time": trace_info.end_time,
                "metadata": workflow_metadata,
                "input": wrap_dict("input", trace_info.workflow_run_inputs),
                "output": wrap_dict("output", trace_info.workflow_run_outputs),
                "thread_id": trace_info.conversation_id,
                "tags": ["message", "workflow"],
                "project_name": self.project,
            }
            self.add_trace(trace_data)

            root_span_id = prepare_opik_uuid(trace_info.start_time, trace_info.workflow_run_id)
            span_data = {
                "id": root_span_id,
                "parent_span_id": None,
                "trace_id": opik_trace_id,
                "name": TraceTaskName.WORKFLOW_TRACE.value,
                "input": wrap_dict("input", trace_info.workflow_run_inputs),
                "output": wrap_dict("output", trace_info.workflow_run_outputs),
                "start_time": trace_info.start_time,
                "end_time": trace_info.end_time,
                "metadata": workflow_metadata,
                "tags": ["workflow"],
                "project_name": self.project,
            }
            self.add_span(span_data)
        else:
            trace_data = {
                "id": opik_trace_id,
                "name": TraceTaskName.MESSAGE_TRACE.value,
                "start_time": trace_info.start_time,
                "end_time": trace_info.end_time,
                "metadata": workflow_metadata,
                "input": wrap_dict("input", trace_info.workflow_run_inputs),
                "output": wrap_dict("output", trace_info.workflow_run_outputs),
                "thread_id": trace_info.conversation_id,
                "tags": ["workflow"],
                "project_name": self.project,
            }
            self.add_trace(trace_data)

        # through workflow_run_id get all_nodes_execution using repository
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

        for node_execution in workflow_node_executions:
            node_execution_id = node_execution.id
            tenant_id = trace_info.tenant_id  # Use from trace_info instead
            app_id = trace_info.metadata.get("app_id")  # Use from trace_info instead
            node_name = node_execution.title
            node_type = node_execution.node_type
            status = node_execution.status
            if node_type == NodeType.LLM:
                inputs = node_execution.process_data.get("prompts", {}) if node_execution.process_data else {}
            else:
                inputs = node_execution.inputs if node_execution.inputs else {}
            outputs = node_execution.outputs if node_execution.outputs else {}
            created_at = node_execution.created_at or datetime.now()
            elapsed_time = node_execution.elapsed_time
            finished_at = created_at + timedelta(seconds=elapsed_time)

            execution_metadata = node_execution.metadata if node_execution.metadata else {}
            metadata = {str(k): v for k, v in execution_metadata.items()}
            metadata.update(
                {
                    "workflow_run_id": trace_info.workflow_run_id,
                    "node_execution_id": node_execution_id,
                    "tenant_id": tenant_id,
                    "app_id": app_id,
                    "app_name": node_name,
                    "node_type": node_type,
                    "status": status,
                }
            )

            process_data = node_execution.process_data if node_execution.process_data else {}

            provider = None
            model = None
            total_tokens = 0
            completion_tokens = 0
            prompt_tokens = 0

            if process_data and process_data.get("model_mode") == "chat":
                run_type = "llm"
                provider = process_data.get("model_provider", None)
                model = process_data.get("model_name", "")
                metadata.update(
                    {
                        "ls_provider": provider,
                        "ls_model_name": model,
                    }
                )

                try:
                    usage_data = process_data.get("usage", {}) if "usage" in process_data else outputs.get("usage", {})
                    total_tokens = usage_data.get("total_tokens", 0)
                    prompt_tokens = usage_data.get("prompt_tokens", 0)
                    completion_tokens = usage_data.get("completion_tokens", 0)
                except Exception:
                    logger.error("Failed to extract usage", exc_info=True)

            else:
                run_type = "tool"

            parent_span_id = trace_info.workflow_app_log_id or trace_info.workflow_run_id

            if not total_tokens:
                total_tokens = execution_metadata.get(WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS) or 0

            span_data = {
                "trace_id": opik_trace_id,
                "id": prepare_opik_uuid(created_at, node_execution_id),
                "parent_span_id": prepare_opik_uuid(trace_info.start_time, parent_span_id),
                "name": node_name,
                "type": run_type,
                "start_time": created_at,
                "end_time": finished_at,
                "metadata": wrap_metadata(metadata),
                "input": wrap_dict("input", inputs),
                "output": wrap_dict("output", outputs),
                "tags": ["node_execution"],
                "project_name": self.project,
                "usage": {
                    "total_tokens": total_tokens,
                    "completion_tokens": completion_tokens,
                    "prompt_tokens": prompt_tokens,
                },
                "model": model,
                "provider": provider,
            }

            self.add_span(span_data)

    def message_trace(self, trace_info: MessageTraceInfo):
        # get message file data
        file_list = cast(list[str], trace_info.file_list) or []
        message_file_data: Optional[MessageFile] = trace_info.message_file_data

        if message_file_data is not None:
            file_url = f"{self.file_base_url}/{message_file_data.url}" if message_file_data else ""
            file_list.append(file_url)

        message_data = trace_info.message_data
        if message_data is None:
            return

        metadata = trace_info.metadata
        message_id = trace_info.message_id

        user_id = message_data.from_account_id
        metadata["user_id"] = user_id
        metadata["file_list"] = file_list

        if message_data.from_end_user_id:
            end_user_data: Optional[EndUser] = (
                db.session.query(EndUser).filter(EndUser.id == message_data.from_end_user_id).first()
            )
            if end_user_data is not None:
                end_user_id = end_user_data.session_id
                metadata["end_user_id"] = end_user_id

        trace_data = {
            "id": prepare_opik_uuid(trace_info.start_time, message_id),
            "name": TraceTaskName.MESSAGE_TRACE.value,
            "start_time": trace_info.start_time,
            "end_time": trace_info.end_time,
            "metadata": wrap_metadata(metadata),
            "input": trace_info.inputs,
            "output": message_data.answer,
            "thread_id": message_data.conversation_id,
            "tags": ["message", str(trace_info.conversation_mode)],
            "project_name": self.project,
        }
        trace = self.add_trace(trace_data)

        span_data = {
            "trace_id": trace.id,
            "name": "llm",
            "type": "llm",
            "start_time": trace_info.start_time,
            "end_time": trace_info.end_time,
            "metadata": wrap_metadata(metadata),
            "input": {"input": trace_info.inputs},
            "output": {"output": message_data.answer},
            "tags": ["llm", str(trace_info.conversation_mode)],
            "usage": {
                "completion_tokens": trace_info.answer_tokens,
                "prompt_tokens": trace_info.message_tokens,
                "total_tokens": trace_info.total_tokens,
            },
            "project_name": self.project,
        }
        self.add_span(span_data)

    def moderation_trace(self, trace_info: ModerationTraceInfo):
        if trace_info.message_data is None:
            return

        start_time = trace_info.start_time or trace_info.message_data.created_at

        span_data = {
            "trace_id": prepare_opik_uuid(start_time, trace_info.message_id),
            "name": TraceTaskName.MODERATION_TRACE.value,
            "type": "tool",
            "start_time": start_time,
            "end_time": trace_info.end_time or trace_info.message_data.updated_at,
            "metadata": wrap_metadata(trace_info.metadata),
            "input": wrap_dict("input", trace_info.inputs),
            "output": {
                "action": trace_info.action,
                "flagged": trace_info.flagged,
                "preset_response": trace_info.preset_response,
                "inputs": trace_info.inputs,
            },
            "tags": ["moderation"],
        }

        self.add_span(span_data)

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        message_data = trace_info.message_data
        if message_data is None:
            return

        start_time = trace_info.start_time or message_data.created_at

        span_data = {
            "trace_id": prepare_opik_uuid(start_time, trace_info.message_id),
            "name": TraceTaskName.SUGGESTED_QUESTION_TRACE.value,
            "type": "tool",
            "start_time": start_time,
            "end_time": trace_info.end_time or message_data.updated_at,
            "metadata": wrap_metadata(trace_info.metadata),
            "input": wrap_dict("input", trace_info.inputs),
            "output": wrap_dict("output", trace_info.suggested_question),
            "tags": ["suggested_question"],
        }

        self.add_span(span_data)

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            return

        start_time = trace_info.start_time or trace_info.message_data.created_at

        span_data = {
            "trace_id": prepare_opik_uuid(start_time, trace_info.message_id),
            "name": TraceTaskName.DATASET_RETRIEVAL_TRACE.value,
            "type": "tool",
            "start_time": start_time,
            "end_time": trace_info.end_time or trace_info.message_data.updated_at,
            "metadata": wrap_metadata(trace_info.metadata),
            "input": wrap_dict("input", trace_info.inputs),
            "output": {"documents": trace_info.documents},
            "tags": ["dataset_retrieval"],
        }

        self.add_span(span_data)

    def tool_trace(self, trace_info: ToolTraceInfo):
        span_data = {
            "trace_id": prepare_opik_uuid(trace_info.start_time, trace_info.message_id),
            "name": trace_info.tool_name,
            "type": "tool",
            "start_time": trace_info.start_time,
            "end_time": trace_info.end_time,
            "metadata": wrap_metadata(trace_info.metadata),
            "input": wrap_dict("input", trace_info.tool_inputs),
            "output": wrap_dict("output", trace_info.tool_outputs),
            "tags": ["tool", trace_info.tool_name],
        }

        self.add_span(span_data)

    def generate_name_trace(self, trace_info: GenerateNameTraceInfo):
        trace_data = {
            "id": prepare_opik_uuid(trace_info.start_time, trace_info.message_id),
            "name": TraceTaskName.GENERATE_NAME_TRACE.value,
            "start_time": trace_info.start_time,
            "end_time": trace_info.end_time,
            "metadata": wrap_metadata(trace_info.metadata),
            "input": trace_info.inputs,
            "output": trace_info.outputs,
            "thread_id": trace_info.conversation_id,
            "tags": ["generate_name"],
            "project_name": self.project,
        }

        trace = self.add_trace(trace_data)

        span_data = {
            "trace_id": trace.id,
            "name": TraceTaskName.GENERATE_NAME_TRACE.value,
            "start_time": trace_info.start_time,
            "end_time": trace_info.end_time,
            "metadata": wrap_metadata(trace_info.metadata),
            "input": wrap_dict("input", trace_info.inputs),
            "output": wrap_dict("output", trace_info.outputs),
            "tags": ["generate_name"],
        }

        self.add_span(span_data)

    def add_trace(self, opik_trace_data: dict) -> Trace:
        try:
            trace = self.opik_client.trace(**opik_trace_data)
            logger.debug("Opik Trace created successfully")
            return trace
        except Exception as e:
            raise ValueError(f"Opik Failed to create trace: {str(e)}")

    def add_span(self, opik_span_data: dict):
        try:
            self.opik_client.span(**opik_span_data)
            logger.debug("Opik Span created successfully")
        except Exception as e:
            raise ValueError(f"Opik Failed to create span: {str(e)}")

    def api_check(self):
        try:
            self.opik_client.auth_check()
            return True
        except Exception as e:
            logger.info(f"Opik API check failed: {str(e)}", exc_info=True)
            raise ValueError(f"Opik API check failed: {str(e)}")

    def get_project_url(self):
        try:
            return self.opik_client.get_project_url(project_name=self.project)
        except Exception as e:
            logger.info(f"Opik get run url failed: {str(e)}", exc_info=True)
            raise ValueError(f"Opik get run url failed: {str(e)}")
