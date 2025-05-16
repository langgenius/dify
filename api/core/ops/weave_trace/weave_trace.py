import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional, cast

import wandb
import weave
from sqlalchemy.orm import Session, sessionmaker

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import WeaveConfig
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
from core.ops.weave_trace.entities.weave_trace_entity import WeaveTraceModel
from core.repositories import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.entities.node_entities import NodeRunMetadataKey
from core.workflow.nodes.enums import NodeType
from extensions.ext_database import db
from models import Account, App, EndUser, MessageFile, WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


class WeaveDataTrace(BaseTraceInstance):
    def __init__(
        self,
        weave_config: WeaveConfig,
    ):
        super().__init__(weave_config)
        self.weave_api_key = weave_config.api_key
        self.project_name = weave_config.project
        self.entity = weave_config.entity

        # Login with API key first
        login_status = wandb.login(key=self.weave_api_key, verify=True, relogin=True)
        if not login_status:
            logger.error("Failed to login to Weights & Biases with the provided API key")
            raise ValueError("Weave login failed")

        # Then initialize weave client
        self.weave_client = weave.init(
            project_name=(f"{self.entity}/{self.project_name}" if self.entity else self.project_name)
        )
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")
        self.calls: dict[str, Any] = {}

    def get_project_url(
        self,
    ):
        try:
            project_url = f"https://wandb.ai/{self.weave_client._project_id()}"
            return project_url
        except Exception as e:
            logger.debug(f"Weave get run url failed: {str(e)}")
            raise ValueError(f"Weave get run url failed: {str(e)}")

    def trace(self, trace_info: BaseTraceInfo):
        logger.debug(f"Trace info: {trace_info}")
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
        trace_id = trace_info.message_id or trace_info.workflow_run_id
        if trace_info.start_time is None:
            trace_info.start_time = datetime.now()

        if trace_info.message_id:
            message_attributes = trace_info.metadata
            message_attributes["workflow_app_log_id"] = trace_info.workflow_app_log_id

            message_attributes["message_id"] = trace_info.message_id
            message_attributes["workflow_run_id"] = trace_info.workflow_run_id
            message_attributes["trace_id"] = trace_id
            message_attributes["start_time"] = trace_info.start_time
            message_attributes["end_time"] = trace_info.end_time
            message_attributes["tags"] = ["message", "workflow"]

            message_run = WeaveTraceModel(
                id=trace_info.message_id,
                op=str(TraceTaskName.MESSAGE_TRACE.value),
                inputs=dict(trace_info.workflow_run_inputs),
                outputs=dict(trace_info.workflow_run_outputs),
                total_tokens=trace_info.total_tokens,
                attributes=message_attributes,
                exception=trace_info.error,
                file_list=[],
            )
            self.start_call(message_run, parent_run_id=trace_info.workflow_run_id)
            self.finish_call(message_run)

        workflow_attributes = trace_info.metadata
        workflow_attributes["workflow_run_id"] = trace_info.workflow_run_id
        workflow_attributes["trace_id"] = trace_id
        workflow_attributes["start_time"] = trace_info.start_time
        workflow_attributes["end_time"] = trace_info.end_time
        workflow_attributes["tags"] = ["workflow"]

        workflow_run = WeaveTraceModel(
            file_list=trace_info.file_list,
            total_tokens=trace_info.total_tokens,
            id=trace_info.workflow_run_id,
            op=str(TraceTaskName.WORKFLOW_TRACE.value),
            inputs=dict(trace_info.workflow_run_inputs),
            outputs=dict(trace_info.workflow_run_outputs),
            attributes=workflow_attributes,
            exception=trace_info.error,
        )

        self.start_call(workflow_run, parent_run_id=trace_info.message_id)

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
            node_total_tokens = execution_metadata.get(NodeRunMetadataKey.TOTAL_TOKENS) or 0
            attributes = {str(k): v for k, v in execution_metadata.items()}
            attributes.update(
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
            if process_data and process_data.get("model_mode") == "chat":
                attributes.update(
                    {
                        "ls_provider": process_data.get("model_provider", ""),
                        "ls_model_name": process_data.get("model_name", ""),
                    }
                )
            attributes["tags"] = ["node_execution"]
            attributes["start_time"] = created_at
            attributes["end_time"] = finished_at
            attributes["elapsed_time"] = elapsed_time
            attributes["workflow_run_id"] = trace_info.workflow_run_id
            attributes["trace_id"] = trace_id
            node_run = WeaveTraceModel(
                total_tokens=node_total_tokens,
                op=node_type,
                inputs=inputs,
                outputs=outputs,
                file_list=trace_info.file_list,
                attributes=attributes,
                id=node_execution_id,
                exception=None,
            )

            self.start_call(node_run, parent_run_id=trace_info.workflow_run_id)
            self.finish_call(node_run)

        self.finish_call(workflow_run)

    def message_trace(self, trace_info: MessageTraceInfo):
        # get message file data
        file_list = cast(list[str], trace_info.file_list) or []
        message_file_data: Optional[MessageFile] = trace_info.message_file_data
        file_url = f"{self.file_base_url}/{message_file_data.url}" if message_file_data else ""
        file_list.append(file_url)
        attributes = trace_info.metadata
        message_data = trace_info.message_data
        if message_data is None:
            return
        message_id = message_data.id

        user_id = message_data.from_account_id
        attributes["user_id"] = user_id

        if message_data.from_end_user_id:
            end_user_data: Optional[EndUser] = (
                db.session.query(EndUser).filter(EndUser.id == message_data.from_end_user_id).first()
            )
            if end_user_data is not None:
                end_user_id = end_user_data.session_id
                attributes["end_user_id"] = end_user_id

        attributes["message_id"] = message_id
        attributes["start_time"] = trace_info.start_time
        attributes["end_time"] = trace_info.end_time
        attributes["tags"] = ["message", str(trace_info.conversation_mode)]
        message_run = WeaveTraceModel(
            id=message_id,
            op=str(TraceTaskName.MESSAGE_TRACE.value),
            input_tokens=trace_info.message_tokens,
            output_tokens=trace_info.answer_tokens,
            total_tokens=trace_info.total_tokens,
            inputs=trace_info.inputs,
            outputs=trace_info.outputs,
            exception=trace_info.error,
            file_list=file_list,
            attributes=attributes,
        )
        self.start_call(message_run)

        # create llm run parented to message run
        llm_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            input_tokens=trace_info.message_tokens,
            output_tokens=trace_info.answer_tokens,
            total_tokens=trace_info.total_tokens,
            op="llm",
            inputs=trace_info.inputs,
            outputs=trace_info.outputs,
            attributes=attributes,
            file_list=[],
            exception=None,
        )
        self.start_call(
            llm_run,
            parent_run_id=message_id,
        )
        self.finish_call(llm_run)
        self.finish_call(message_run)

    def moderation_trace(self, trace_info: ModerationTraceInfo):
        if trace_info.message_data is None:
            return

        attributes = trace_info.metadata
        attributes["tags"] = ["moderation"]
        attributes["message_id"] = trace_info.message_id
        attributes["start_time"] = trace_info.start_time or trace_info.message_data.created_at
        attributes["end_time"] = trace_info.end_time or trace_info.message_data.updated_at

        moderation_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            op=str(TraceTaskName.MODERATION_TRACE.value),
            inputs=trace_info.inputs,
            outputs={
                "action": trace_info.action,
                "flagged": trace_info.flagged,
                "preset_response": trace_info.preset_response,
                "inputs": trace_info.inputs,
            },
            attributes=attributes,
            exception=getattr(trace_info, "error", None),
            file_list=[],
        )
        self.start_call(moderation_run, parent_run_id=trace_info.message_id)
        self.finish_call(moderation_run)

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        message_data = trace_info.message_data
        if message_data is None:
            return
        attributes = trace_info.metadata
        attributes["message_id"] = trace_info.message_id
        attributes["tags"] = ["suggested_question"]
        attributes["start_time"] = (trace_info.start_time or message_data.created_at,)
        attributes["end_time"] = (trace_info.end_time or message_data.updated_at,)

        suggested_question_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            op=str(TraceTaskName.SUGGESTED_QUESTION_TRACE.value),
            inputs=trace_info.inputs,
            outputs=trace_info.suggested_question,
            attributes=attributes,
            exception=trace_info.error,
            file_list=[],
        )

        self.start_call(suggested_question_run, parent_run_id=trace_info.message_id)
        self.finish_call(suggested_question_run)

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            return
        attributes = trace_info.metadata
        attributes["message_id"] = trace_info.message_id
        attributes["tags"] = ["dataset_retrieval"]
        attributes["start_time"] = (trace_info.start_time or trace_info.message_data.created_at,)
        attributes["end_time"] = (trace_info.end_time or trace_info.message_data.updated_at,)

        dataset_retrieval_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            op=str(TraceTaskName.DATASET_RETRIEVAL_TRACE.value),
            inputs=trace_info.inputs,
            outputs={"documents": trace_info.documents},
            attributes=attributes,
            exception=getattr(trace_info, "error", None),
            file_list=[],
        )

        self.start_call(dataset_retrieval_run, parent_run_id=trace_info.message_id)
        self.finish_call(dataset_retrieval_run)

    def tool_trace(self, trace_info: ToolTraceInfo):
        attributes = trace_info.metadata
        attributes["tags"] = ["tool", trace_info.tool_name]
        attributes["start_time"] = trace_info.start_time
        attributes["end_time"] = trace_info.end_time

        tool_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            op=trace_info.tool_name,
            inputs=trace_info.tool_inputs,
            outputs=trace_info.tool_outputs,
            file_list=[cast(str, trace_info.file_url)] if trace_info.file_url else [],
            attributes=attributes,
            exception=trace_info.error,
        )
        message_id = trace_info.message_id or getattr(trace_info, "conversation_id", None)
        message_id = message_id or None
        self.start_call(tool_run, parent_run_id=message_id)
        self.finish_call(tool_run)

    def generate_name_trace(self, trace_info: GenerateNameTraceInfo):
        attributes = trace_info.metadata
        attributes["tags"] = ["generate_name"]
        attributes["start_time"] = trace_info.start_time
        attributes["end_time"] = trace_info.end_time

        name_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            op=str(TraceTaskName.GENERATE_NAME_TRACE.value),
            inputs=trace_info.inputs,
            outputs=trace_info.outputs,
            attributes=attributes,
            exception=getattr(trace_info, "error", None),
            file_list=[],
        )

        self.start_call(name_run)
        self.finish_call(name_run)

    def api_check(self):
        try:
            login_status = wandb.login(key=self.weave_api_key, verify=True, relogin=True)
            if not login_status:
                raise ValueError("Weave login failed")
            else:
                print("Weave login successful")
                return True
        except Exception as e:
            logger.debug(f"Weave API check failed: {str(e)}")
            raise ValueError(f"Weave API check failed: {str(e)}")

    def start_call(self, run_data: WeaveTraceModel, parent_run_id: Optional[str] = None):
        call = self.weave_client.create_call(op=run_data.op, inputs=run_data.inputs, attributes=run_data.attributes)
        self.calls[run_data.id] = call
        if parent_run_id:
            self.calls[run_data.id].parent_id = parent_run_id

    def finish_call(self, run_data: WeaveTraceModel):
        call = self.calls.get(run_data.id)
        if call:
            self.weave_client.finish_call(call=call, output=run_data.outputs, exception=run_data.exception)
        else:
            raise ValueError(f"Call with id {run_data.id} not found")
