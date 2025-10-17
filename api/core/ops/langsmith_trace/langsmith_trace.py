import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import cast

from langsmith import Client
from langsmith.schemas import RunBase
from sqlalchemy.orm import sessionmaker

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import LangSmithConfig
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
from core.ops.langsmith_trace.entities.langsmith_trace_entity import (
    LangSmithRunModel,
    LangSmithRunType,
    LangSmithRunUpdateModel,
)
from core.ops.utils import filter_none_values, generate_dotted_order
from core.repositories import DifyCoreRepositoryFactory
from core.workflow.enums import NodeType, WorkflowNodeExecutionMetadataKey
from extensions.ext_database import db
from models import EndUser, MessageFile, WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


class LangSmithDataTrace(BaseTraceInstance):
    def __init__(
        self,
        langsmith_config: LangSmithConfig,
    ):
        super().__init__(langsmith_config)
        self.langsmith_key = langsmith_config.api_key
        self.project_name = langsmith_config.project
        self.project_id = None
        self.langsmith_client = Client(api_key=langsmith_config.api_key, api_url=langsmith_config.endpoint)
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
        trace_id = trace_info.trace_id or trace_info.message_id or trace_info.workflow_run_id
        if trace_info.start_time is None:
            trace_info.start_time = datetime.now()
        message_dotted_order = (
            generate_dotted_order(trace_info.message_id, trace_info.start_time) if trace_info.message_id else None
        )
        workflow_dotted_order = generate_dotted_order(
            trace_info.workflow_run_id,
            trace_info.workflow_data.created_at,
            message_dotted_order,
        )
        metadata = trace_info.metadata
        metadata["workflow_app_log_id"] = trace_info.workflow_app_log_id

        if trace_info.message_id:
            message_run = LangSmithRunModel(
                id=trace_info.message_id,
                name=TraceTaskName.MESSAGE_TRACE,
                inputs=dict(trace_info.workflow_run_inputs),
                outputs=dict(trace_info.workflow_run_outputs),
                run_type=LangSmithRunType.chain,
                start_time=trace_info.start_time,
                end_time=trace_info.end_time,
                extra={
                    "metadata": metadata,
                },
                tags=["message", "workflow"],
                error=trace_info.error,
                trace_id=trace_id,
                dotted_order=message_dotted_order,
                file_list=[],
                serialized=None,
                parent_run_id=None,
                events=[],
                session_id=None,
                session_name=None,
                reference_example_id=None,
                input_attachments={},
                output_attachments={},
            )
            self.add_run(message_run)

        langsmith_run = LangSmithRunModel(
            file_list=trace_info.file_list,
            total_tokens=trace_info.total_tokens,
            id=trace_info.workflow_run_id,
            name=TraceTaskName.WORKFLOW_TRACE,
            inputs=dict(trace_info.workflow_run_inputs),
            run_type=LangSmithRunType.tool,
            start_time=trace_info.workflow_data.created_at,
            end_time=trace_info.workflow_data.finished_at,
            outputs=dict(trace_info.workflow_run_outputs),
            extra={
                "metadata": metadata,
            },
            error=trace_info.error,
            tags=["workflow"],
            parent_run_id=trace_info.message_id or None,
            trace_id=trace_id,
            dotted_order=workflow_dotted_order,
            serialized=None,
            events=[],
            session_id=None,
            session_name=None,
            reference_example_id=None,
            input_attachments={},
            output_attachments={},
        )

        self.add_run(langsmith_run)

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
                inputs = node_execution.inputs or {}
            outputs = node_execution.outputs or {}
            created_at = node_execution.created_at or datetime.now()
            elapsed_time = node_execution.elapsed_time
            finished_at = created_at + timedelta(seconds=elapsed_time)

            execution_metadata = node_execution.metadata or {}
            node_total_tokens = execution_metadata.get(WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS) or 0
            metadata = {str(key): value for key, value in execution_metadata.items()}
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

            process_data = node_execution.process_data or {}

            if process_data and process_data.get("model_mode") == "chat":
                run_type = LangSmithRunType.llm
                metadata.update(
                    {
                        "ls_provider": process_data.get("model_provider", ""),
                        "ls_model_name": process_data.get("model_name", ""),
                    }
                )
            elif node_type == NodeType.KNOWLEDGE_RETRIEVAL:
                run_type = LangSmithRunType.retriever
            else:
                run_type = LangSmithRunType.tool

            prompt_tokens = 0
            completion_tokens = 0
            try:
                usage_data = process_data.get("usage", {}) if "usage" in process_data else outputs.get("usage", {})
                prompt_tokens = usage_data.get("prompt_tokens", 0)
                completion_tokens = usage_data.get("completion_tokens", 0)
            except Exception:
                logger.error("Failed to extract usage", exc_info=True)

            node_dotted_order = generate_dotted_order(node_execution_id, created_at, workflow_dotted_order)
            langsmith_run = LangSmithRunModel(
                total_tokens=node_total_tokens,
                input_tokens=prompt_tokens,
                output_tokens=completion_tokens,
                name=node_type,
                inputs=inputs,
                run_type=run_type,
                start_time=created_at,
                end_time=finished_at,
                outputs=outputs,
                file_list=trace_info.file_list,
                extra={
                    "metadata": metadata,
                },
                parent_run_id=trace_info.workflow_run_id,
                tags=["node_execution"],
                id=node_execution_id,
                trace_id=trace_id,
                dotted_order=node_dotted_order,
                error="",
                serialized=None,
                events=[],
                session_id=None,
                session_name=None,
                reference_example_id=None,
                input_attachments={},
                output_attachments={},
            )

            self.add_run(langsmith_run)

    def message_trace(self, trace_info: MessageTraceInfo):
        # get message file data
        file_list = cast(list[str], trace_info.file_list) or []
        message_file_data: MessageFile | None = trace_info.message_file_data
        file_url = f"{self.file_base_url}/{message_file_data.url}" if message_file_data else ""
        file_list.append(file_url)
        metadata = trace_info.metadata
        message_data = trace_info.message_data
        if message_data is None:
            return
        message_id = message_data.id

        user_id = message_data.from_account_id
        metadata["user_id"] = user_id

        if message_data.from_end_user_id:
            end_user_data: EndUser | None = (
                db.session.query(EndUser).where(EndUser.id == message_data.from_end_user_id).first()
            )
            if end_user_data is not None:
                end_user_id = end_user_data.session_id
                metadata["end_user_id"] = end_user_id

        message_run = LangSmithRunModel(
            input_tokens=trace_info.message_tokens,
            output_tokens=trace_info.answer_tokens,
            total_tokens=trace_info.total_tokens,
            id=message_id,
            name=TraceTaskName.MESSAGE_TRACE,
            inputs=trace_info.inputs,
            run_type=LangSmithRunType.chain,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
            outputs=message_data.answer,
            extra={"metadata": metadata},
            tags=["message", str(trace_info.conversation_mode)],
            error=trace_info.error,
            file_list=file_list,
            serialized=None,
            events=[],
            session_id=None,
            session_name=None,
            reference_example_id=None,
            input_attachments={},
            output_attachments={},
            trace_id=trace_info.trace_id,
            dotted_order=None,
            parent_run_id=None,
        )
        self.add_run(message_run)

        # create llm run parented to message run
        llm_run = LangSmithRunModel(
            input_tokens=trace_info.message_tokens,
            output_tokens=trace_info.answer_tokens,
            total_tokens=trace_info.total_tokens,
            name="llm",
            inputs=trace_info.inputs,
            run_type=LangSmithRunType.llm,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
            outputs=message_data.answer,
            extra={"metadata": metadata},
            parent_run_id=message_id,
            tags=["llm", str(trace_info.conversation_mode)],
            error=trace_info.error,
            file_list=file_list,
            serialized=None,
            events=[],
            session_id=None,
            session_name=None,
            reference_example_id=None,
            input_attachments={},
            output_attachments={},
            trace_id=trace_info.trace_id,
            dotted_order=None,
            id=str(uuid.uuid4()),
        )
        self.add_run(llm_run)

    def moderation_trace(self, trace_info: ModerationTraceInfo):
        if trace_info.message_data is None:
            return
        langsmith_run = LangSmithRunModel(
            name=TraceTaskName.MODERATION_TRACE,
            inputs=trace_info.inputs,
            outputs={
                "action": trace_info.action,
                "flagged": trace_info.flagged,
                "preset_response": trace_info.preset_response,
                "inputs": trace_info.inputs,
            },
            run_type=LangSmithRunType.tool,
            extra={"metadata": trace_info.metadata},
            tags=["moderation"],
            parent_run_id=trace_info.message_id,
            start_time=trace_info.start_time or trace_info.message_data.created_at,
            end_time=trace_info.end_time or trace_info.message_data.updated_at,
            id=str(uuid.uuid4()),
            serialized=None,
            events=[],
            session_id=None,
            session_name=None,
            reference_example_id=None,
            input_attachments={},
            output_attachments={},
            trace_id=trace_info.trace_id,
            dotted_order=None,
            error="",
            file_list=[],
        )

        self.add_run(langsmith_run)

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        message_data = trace_info.message_data
        if message_data is None:
            return
        suggested_question_run = LangSmithRunModel(
            name=TraceTaskName.SUGGESTED_QUESTION_TRACE,
            inputs=trace_info.inputs,
            outputs=trace_info.suggested_question,
            run_type=LangSmithRunType.tool,
            extra={"metadata": trace_info.metadata},
            tags=["suggested_question"],
            parent_run_id=trace_info.message_id,
            start_time=trace_info.start_time or message_data.created_at,
            end_time=trace_info.end_time or message_data.updated_at,
            id=str(uuid.uuid4()),
            serialized=None,
            events=[],
            session_id=None,
            session_name=None,
            reference_example_id=None,
            input_attachments={},
            output_attachments={},
            trace_id=trace_info.trace_id,
            dotted_order=None,
            error="",
            file_list=[],
        )

        self.add_run(suggested_question_run)

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            return
        dataset_retrieval_run = LangSmithRunModel(
            name=TraceTaskName.DATASET_RETRIEVAL_TRACE,
            inputs=trace_info.inputs,
            outputs={"documents": trace_info.documents},
            run_type=LangSmithRunType.retriever,
            extra={"metadata": trace_info.metadata},
            tags=["dataset_retrieval"],
            parent_run_id=trace_info.message_id,
            start_time=trace_info.start_time or trace_info.message_data.created_at,
            end_time=trace_info.end_time or trace_info.message_data.updated_at,
            id=str(uuid.uuid4()),
            serialized=None,
            events=[],
            session_id=None,
            session_name=None,
            reference_example_id=None,
            input_attachments={},
            output_attachments={},
            trace_id=trace_info.trace_id,
            dotted_order=None,
            error="",
            file_list=[],
        )

        self.add_run(dataset_retrieval_run)

    def tool_trace(self, trace_info: ToolTraceInfo):
        tool_run = LangSmithRunModel(
            name=trace_info.tool_name,
            inputs=trace_info.tool_inputs,
            outputs=trace_info.tool_outputs,
            run_type=LangSmithRunType.tool,
            extra={
                "metadata": trace_info.metadata,
            },
            tags=["tool", trace_info.tool_name],
            parent_run_id=trace_info.message_id,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
            file_list=[cast(str, trace_info.file_url)],
            id=str(uuid.uuid4()),
            serialized=None,
            events=[],
            session_id=None,
            session_name=None,
            reference_example_id=None,
            input_attachments={},
            output_attachments={},
            trace_id=trace_info.trace_id,
            dotted_order=None,
            error=trace_info.error or "",
        )

        self.add_run(tool_run)

    def generate_name_trace(self, trace_info: GenerateNameTraceInfo):
        name_run = LangSmithRunModel(
            name=TraceTaskName.GENERATE_NAME_TRACE,
            inputs=trace_info.inputs,
            outputs=trace_info.outputs,
            run_type=LangSmithRunType.tool,
            extra={"metadata": trace_info.metadata},
            tags=["generate_name"],
            start_time=trace_info.start_time or datetime.now(),
            end_time=trace_info.end_time or datetime.now(),
            id=str(uuid.uuid4()),
            serialized=None,
            events=[],
            session_id=None,
            session_name=None,
            reference_example_id=None,
            input_attachments={},
            output_attachments={},
            trace_id=trace_info.trace_id,
            dotted_order=None,
            error="",
            file_list=[],
            parent_run_id=None,
        )

        self.add_run(name_run)

    def add_run(self, run_data: LangSmithRunModel):
        data = run_data.model_dump()
        if self.project_id:
            data["session_id"] = self.project_id
        elif self.project_name:
            data["session_name"] = self.project_name

        data = filter_none_values(data)
        try:
            self.langsmith_client.create_run(**data)
            logger.debug("LangSmith Run created successfully.")
        except Exception as e:
            raise ValueError(f"LangSmith Failed to create run: {str(e)}")

    def update_run(self, update_run_data: LangSmithRunUpdateModel):
        data = update_run_data.model_dump()
        data = filter_none_values(data)
        try:
            self.langsmith_client.update_run(**data)
            logger.debug("LangSmith Run updated successfully.")
        except Exception as e:
            raise ValueError(f"LangSmith Failed to update run: {str(e)}")

    def api_check(self):
        try:
            random_project_name = f"test_project_{datetime.now().strftime('%Y%m%d%H%M%S')}"
            self.langsmith_client.create_project(project_name=random_project_name)
            self.langsmith_client.delete_project(project_name=random_project_name)
            return True
        except Exception as e:
            logger.debug("LangSmith API check failed: %s", str(e))
            raise ValueError(f"LangSmith API check failed: {str(e)}")

    def get_project_url(self):
        try:
            run_data = RunBase(
                id=uuid.uuid4(),
                name="tool",
                inputs={"input": "test"},
                outputs={"output": "test"},
                run_type=LangSmithRunType.tool,
                start_time=datetime.now(),
            )

            project_url = self.langsmith_client.get_run_url(
                run=run_data, project_id=self.project_id, project_name=self.project_name
            )
            return project_url.split("/r/")[0]
        except Exception as e:
            logger.debug("LangSmith get run url failed: %s", str(e))
            raise ValueError(f"LangSmith get run url failed: {str(e)}")
