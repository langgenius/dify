import logging
import os
from datetime import datetime, timedelta
from typing import Optional

from langfuse import Langfuse  # type: ignore
from sqlalchemy.orm import sessionmaker

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import LangfuseConfig
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
from core.ops.langfuse_trace.entities.langfuse_trace_entity import (
    GenerationUsage,
    LangfuseGeneration,
    LangfuseSpan,
    LangfuseTrace,
    LevelEnum,
    UnitEnum,
)
from core.ops.utils import filter_none_values
from core.repositories import DifyCoreRepositoryFactory
from core.workflow.nodes.enums import NodeType
from extensions.ext_database import db
from models import EndUser, WorkflowNodeExecutionTriggeredFrom
from models.enums import MessageStatus

logger = logging.getLogger(__name__)


class LangFuseDataTrace(BaseTraceInstance):
    def __init__(
        self,
        langfuse_config: LangfuseConfig,
    ):
        super().__init__(langfuse_config)
        self.langfuse_client = Langfuse(
            public_key=langfuse_config.public_key,
            secret_key=langfuse_config.secret_key,
            host=langfuse_config.host,
        )
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
        trace_id = trace_info.workflow_run_id
        user_id = trace_info.metadata.get("user_id")
        metadata = trace_info.metadata
        metadata["workflow_app_log_id"] = trace_info.workflow_app_log_id

        if trace_info.message_id:
            trace_id = trace_info.message_id
            name = TraceTaskName.MESSAGE_TRACE.value
            trace_data = LangfuseTrace(
                id=trace_id,
                user_id=user_id,
                name=name,
                input=dict(trace_info.workflow_run_inputs),
                output=dict(trace_info.workflow_run_outputs),
                metadata=metadata,
                session_id=trace_info.conversation_id,
                tags=["message", "workflow"],
                version=trace_info.workflow_run_version,
            )
            self.add_trace(langfuse_trace_data=trace_data)
            workflow_span_data = LangfuseSpan(
                id=trace_info.workflow_run_id,
                name=TraceTaskName.WORKFLOW_TRACE.value,
                input=dict(trace_info.workflow_run_inputs),
                output=dict(trace_info.workflow_run_outputs),
                trace_id=trace_id,
                start_time=trace_info.start_time,
                end_time=trace_info.end_time,
                metadata=metadata,
                level=LevelEnum.DEFAULT if trace_info.error == "" else LevelEnum.ERROR,
                status_message=trace_info.error or "",
            )
            self.add_span(langfuse_span_data=workflow_span_data)
        else:
            trace_data = LangfuseTrace(
                id=trace_id,
                user_id=user_id,
                name=TraceTaskName.WORKFLOW_TRACE.value,
                input=dict(trace_info.workflow_run_inputs),
                output=dict(trace_info.workflow_run_outputs),
                metadata=metadata,
                session_id=trace_info.conversation_id,
                tags=["workflow"],
                version=trace_info.workflow_run_version,
            )
            self.add_trace(langfuse_trace_data=trace_data)

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
                    "node_name": node_name,
                    "node_type": node_type,
                    "status": status,
                }
            )
            process_data = node_execution.process_data if node_execution.process_data else {}
            model_provider = process_data.get("model_provider", None)
            model_name = process_data.get("model_name", None)
            if model_provider is not None and model_name is not None:
                metadata.update(
                    {
                        "model_provider": model_provider,
                        "model_name": model_name,
                    }
                )

            # add generation span
            if process_data and process_data.get("model_mode") == "chat":
                total_token = metadata.get("total_tokens", 0)
                prompt_tokens = 0
                completion_tokens = 0
                try:
                    usage_data = process_data.get("usage", {}) if "usage" in process_data else outputs.get("usage", {})
                    prompt_tokens = usage_data.get("prompt_tokens", 0)
                    completion_tokens = usage_data.get("completion_tokens", 0)
                except Exception:
                    logger.error("Failed to extract usage", exc_info=True)

                # add generation
                generation_usage = GenerationUsage(
                    input=prompt_tokens,
                    output=completion_tokens,
                    total=total_token,
                    unit=UnitEnum.TOKENS,
                )

                node_generation_data = LangfuseGeneration(
                    id=node_execution_id,
                    name=node_name,
                    trace_id=trace_id,
                    model=process_data.get("model_name"),
                    start_time=created_at,
                    end_time=finished_at,
                    input=inputs,
                    output=outputs,
                    metadata=metadata,
                    level=(LevelEnum.DEFAULT if status == "succeeded" else LevelEnum.ERROR),
                    status_message=trace_info.error or "",
                    parent_observation_id=trace_info.workflow_run_id if trace_info.message_id else None,
                    usage=generation_usage,
                )

                self.add_generation(langfuse_generation_data=node_generation_data)

            # add normal span
            else:
                span_data = LangfuseSpan(
                    id=node_execution_id,
                    name=node_name,
                    input=inputs,
                    output=outputs,
                    trace_id=trace_id,
                    start_time=created_at,
                    end_time=finished_at,
                    metadata=metadata,
                    level=(LevelEnum.DEFAULT if status == "succeeded" else LevelEnum.ERROR),
                    status_message=trace_info.error or "",
                    parent_observation_id=trace_info.workflow_run_id if trace_info.message_id else None,
                )

                self.add_span(langfuse_span_data=span_data)

    def message_trace(self, trace_info: MessageTraceInfo, **kwargs):
        # get message file data
        file_list = trace_info.file_list
        metadata = trace_info.metadata
        message_data = trace_info.message_data
        if message_data is None:
            return
        message_id = message_data.id

        user_id = message_data.from_account_id
        if message_data.from_end_user_id:
            end_user_data: Optional[EndUser] = (
                db.session.query(EndUser).filter(EndUser.id == message_data.from_end_user_id).first()
            )
            if end_user_data is not None:
                user_id = end_user_data.session_id
                metadata["user_id"] = user_id

        trace_data = LangfuseTrace(
            id=message_id,
            user_id=user_id,
            name=TraceTaskName.MESSAGE_TRACE.value,
            input={
                "message": trace_info.inputs,
                "files": file_list,
                "message_tokens": trace_info.message_tokens,
                "answer_tokens": trace_info.answer_tokens,
                "total_tokens": trace_info.total_tokens,
                "error": trace_info.error,
                "provider_response_latency": message_data.provider_response_latency,
                "created_at": trace_info.start_time,
            },
            output=trace_info.outputs,
            metadata=metadata,
            session_id=message_data.conversation_id,
            tags=["message", str(trace_info.conversation_mode)],
            version=None,
            release=None,
            public=None,
        )
        self.add_trace(langfuse_trace_data=trace_data)

        # add generation
        generation_usage = GenerationUsage(
            input=trace_info.message_tokens,
            output=trace_info.answer_tokens,
            total=trace_info.total_tokens,
            unit=UnitEnum.TOKENS,
            totalCost=message_data.total_price,
        )

        langfuse_generation_data = LangfuseGeneration(
            name="llm",
            trace_id=message_id,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
            model=message_data.model_id,
            input=trace_info.inputs,
            output=message_data.answer,
            metadata=metadata,
            level=(LevelEnum.DEFAULT if message_data.status != MessageStatus.ERROR else LevelEnum.ERROR),
            status_message=message_data.error or "",
            usage=generation_usage,
        )

        self.add_generation(langfuse_generation_data)

    def moderation_trace(self, trace_info: ModerationTraceInfo):
        if trace_info.message_data is None:
            return
        span_data = LangfuseSpan(
            name=TraceTaskName.MODERATION_TRACE.value,
            input=trace_info.inputs,
            output={
                "action": trace_info.action,
                "flagged": trace_info.flagged,
                "preset_response": trace_info.preset_response,
                "inputs": trace_info.inputs,
            },
            trace_id=trace_info.message_id,
            start_time=trace_info.start_time or trace_info.message_data.created_at,
            end_time=trace_info.end_time or trace_info.message_data.created_at,
            metadata=trace_info.metadata,
        )

        self.add_span(langfuse_span_data=span_data)

    def suggested_question_trace(self, trace_info: SuggestedQuestionTraceInfo):
        message_data = trace_info.message_data
        if message_data is None:
            return
        generation_usage = GenerationUsage(
            total=len(str(trace_info.suggested_question)),
            input=len(trace_info.inputs) if trace_info.inputs else 0,
            output=len(trace_info.suggested_question),
            unit=UnitEnum.CHARACTERS,
        )

        generation_data = LangfuseGeneration(
            name=TraceTaskName.SUGGESTED_QUESTION_TRACE.value,
            input=trace_info.inputs,
            output=str(trace_info.suggested_question),
            trace_id=trace_info.message_id,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
            metadata=trace_info.metadata,
            level=(LevelEnum.DEFAULT if message_data.status != MessageStatus.ERROR else LevelEnum.ERROR),
            status_message=message_data.error or "",
            usage=generation_usage,
        )

        self.add_generation(langfuse_generation_data=generation_data)

    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            return
        dataset_retrieval_span_data = LangfuseSpan(
            name=TraceTaskName.DATASET_RETRIEVAL_TRACE.value,
            input=trace_info.inputs,
            output={"documents": trace_info.documents},
            trace_id=trace_info.message_id,
            start_time=trace_info.start_time or trace_info.message_data.created_at,
            end_time=trace_info.end_time or trace_info.message_data.updated_at,
            metadata=trace_info.metadata,
        )

        self.add_span(langfuse_span_data=dataset_retrieval_span_data)

    def tool_trace(self, trace_info: ToolTraceInfo):
        tool_span_data = LangfuseSpan(
            name=trace_info.tool_name,
            input=trace_info.tool_inputs,
            output=trace_info.tool_outputs,
            trace_id=trace_info.message_id,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
            metadata=trace_info.metadata,
            level=(LevelEnum.DEFAULT if trace_info.error == "" or trace_info.error is None else LevelEnum.ERROR),
            status_message=trace_info.error,
        )

        self.add_span(langfuse_span_data=tool_span_data)

    def generate_name_trace(self, trace_info: GenerateNameTraceInfo):
        name_generation_trace_data = LangfuseTrace(
            name=TraceTaskName.GENERATE_NAME_TRACE.value,
            input=trace_info.inputs,
            output=trace_info.outputs,
            user_id=trace_info.tenant_id,
            metadata=trace_info.metadata,
            session_id=trace_info.conversation_id,
        )

        self.add_trace(langfuse_trace_data=name_generation_trace_data)

        name_generation_span_data = LangfuseSpan(
            name=TraceTaskName.GENERATE_NAME_TRACE.value,
            input=trace_info.inputs,
            output=trace_info.outputs,
            trace_id=trace_info.conversation_id,
            start_time=trace_info.start_time,
            end_time=trace_info.end_time,
            metadata=trace_info.metadata,
        )
        self.add_span(langfuse_span_data=name_generation_span_data)

    def add_trace(self, langfuse_trace_data: Optional[LangfuseTrace] = None):
        format_trace_data = filter_none_values(langfuse_trace_data.model_dump()) if langfuse_trace_data else {}
        try:
            self.langfuse_client.trace(**format_trace_data)
            logger.debug("LangFuse Trace created successfully")
        except Exception as e:
            raise ValueError(f"LangFuse Failed to create trace: {str(e)}")

    def add_span(self, langfuse_span_data: Optional[LangfuseSpan] = None):
        format_span_data = filter_none_values(langfuse_span_data.model_dump()) if langfuse_span_data else {}
        try:
            self.langfuse_client.span(**format_span_data)
            logger.debug("LangFuse Span created successfully")
        except Exception as e:
            raise ValueError(f"LangFuse Failed to create span: {str(e)}")

    def update_span(self, span, langfuse_span_data: Optional[LangfuseSpan] = None):
        format_span_data = filter_none_values(langfuse_span_data.model_dump()) if langfuse_span_data else {}

        span.end(**format_span_data)

    def add_generation(self, langfuse_generation_data: Optional[LangfuseGeneration] = None):
        format_generation_data = (
            filter_none_values(langfuse_generation_data.model_dump()) if langfuse_generation_data else {}
        )
        try:
            self.langfuse_client.generation(**format_generation_data)
            logger.debug("LangFuse Generation created successfully")
        except Exception as e:
            raise ValueError(f"LangFuse Failed to create generation: {str(e)}")

    def update_generation(self, generation, langfuse_generation_data: Optional[LangfuseGeneration] = None):
        format_generation_data = (
            filter_none_values(langfuse_generation_data.model_dump()) if langfuse_generation_data else {}
        )

        generation.end(**format_generation_data)

    def api_check(self):
        try:
            return self.langfuse_client.auth_check()
        except Exception as e:
            logger.debug(f"LangFuse API check failed: {str(e)}")
            raise ValueError(f"LangFuse API check failed: {str(e)}")

    def get_project_key(self):
        try:
            projects = self.langfuse_client.client.projects.get()
            return projects.data[0].id
        except Exception as e:
            logger.debug(f"LangFuse get project key failed: {str(e)}")
            raise ValueError(f"LangFuse get project key failed: {str(e)}")
