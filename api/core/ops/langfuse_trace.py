import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Optional

from langfuse import Langfuse

from core.helper.encrypter import decrypt_token, encrypt_token, obfuscated_token
from core.moderation.base import ModerationInputsResult
from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.langfuse_trace_entity import (
    GenerationUsage,
    LangfuseGeneration,
    LangfuseSpan,
    LangfuseTrace,
    LevelEnum,
    UnitEnum,
)
from core.ops.model import LangfuseConfig
from core.ops.utils import filter_none_values
from extensions.ext_database import db
from models.dataset import Document
from models.model import Message, MessageAgentThought, MessageFile
from models.workflow import WorkflowNodeExecution, WorkflowRun

logger = logging.getLogger(__name__)


class LangFuseDataTrace(BaseTraceInstance):
    def __init__(
        self,
        langfuse_client_public_key: str = None,
        langfuse_client_secret_key: str = None,
        langfuse_client_host: str = "https://cloud.langfuse.com",
    ):
        super().__init__()
        self.langfuse_client = Langfuse(
            public_key=langfuse_client_public_key,
            secret_key=langfuse_client_secret_key,
            host=langfuse_client_host,
        )
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")

    def workflow_trace(self, workflow_run: WorkflowRun, **kwargs):
        conversion_id = kwargs.get("conversation_id")
        workflow_id = workflow_run.workflow_id
        tenant_id = workflow_run.tenant_id
        workflow_run_id = workflow_run.id
        workflow_run_elapsed_time = workflow_run.elapsed_time
        workflow_run_status = workflow_run.status
        workflow_run_inputs = (
            json.loads(workflow_run.inputs) if workflow_run.inputs else {}
        )
        workflow_run_outputs = (
            json.loads(workflow_run.outputs) if workflow_run.outputs else {}
        )
        workflow_run_version = workflow_run.version
        error = workflow_run.error if workflow_run.error else ""

        total_tokens = workflow_run.total_tokens

        file_list = workflow_run_inputs.get("sys.file") if workflow_run_inputs.get("sys.file") else []
        query = workflow_run_inputs.get("query") or workflow_run_inputs.get("sys.query") or ""

        metadata = {
            "workflow_id": workflow_id,
            "conversation_id": conversion_id,
            "workflow_run_id": workflow_run_id,
            "tenant_id": tenant_id,
            "elapsed_time": workflow_run_elapsed_time,
            "status": workflow_run_status,
            "version": workflow_run_version,
            "total_tokens": total_tokens,
            "file_list": file_list,
        }

        trace_data = LangfuseTrace(
            id=workflow_run_id,
            name=f"workflow_{workflow_run_id}",
            user_id=tenant_id,
            input=query,
            output=workflow_run_outputs,
            metadata=metadata,
            session_id=conversion_id if conversion_id else workflow_run_id,
            tags=["workflow"],
        )

        self.add_trace(langfuse_trace_data=trace_data)

        # through workflow_run_id get all_nodes_execution
        workflow_nodes_executions = (
            db.session.query(WorkflowNodeExecution)
            .filter(WorkflowNodeExecution.workflow_run_id == workflow_run_id)
            .order_by(WorkflowNodeExecution.index.desc())
            .all()
        )

        for node_execution in workflow_nodes_executions:
            node_execution_id = node_execution.id
            tenant_id = node_execution.tenant_id
            app_id = node_execution.app_id
            node_name = node_execution.title
            node_type = node_execution.node_type
            status = node_execution.status
            if node_type == "llm":
                inputs = json.loads(node_execution.process_data).get("prompts", {})
            else:
                inputs = json.loads(node_execution.inputs) if node_execution.inputs else {}
            outputs = (
                json.loads(node_execution.outputs) if node_execution.outputs else {}
            )
            created_at = node_execution.created_at if node_execution.created_at else datetime.now()
            elapsed_time = node_execution.elapsed_time
            finished_at = created_at + timedelta(seconds=elapsed_time)

            metadata = json.loads(node_execution.execution_metadata) if node_execution.execution_metadata else {}
            metadata.update(
                {
                    "workflow_run_id": workflow_run_id,
                    "node_execution_id": node_execution_id,
                    "tenant_id": tenant_id,
                    "app_id": app_id,
                    "node_name": node_name,
                    "node_type": node_type,
                    "status": status,
                }
            )

            process_data = json.loads(node_execution.process_data) if node_execution.process_data else {}
            if process_data and process_data.get("model_mode") == "chat":
                # add generation
                node_total_tokens = json.loads(node_execution.execution_metadata).get("total_tokens")
                generation_usage = GenerationUsage(
                    totalTokens=node_total_tokens,
                )

                langfuse_generation_data = LangfuseGeneration(
                    name=f"{node_name}_{node_execution_id}",
                    trace_id=workflow_run_id,
                    start_time=created_at,
                    end_time=finished_at,
                    input=inputs,
                    output=outputs,
                    metadata=metadata,
                    level=LevelEnum.DEFAULT if status == 'succeeded' else LevelEnum.ERROR,
                    status_message=error if error else "",
                    usage=generation_usage,
                )

                self.add_generation(langfuse_generation_data)

            # add span
            span_data = LangfuseSpan(
                name=f"{node_name}_{node_execution_id}",
                input=inputs,
                output=outputs,
                trace_id=workflow_run_id,
                start_time=created_at,
                end_time=finished_at,
                metadata=metadata,
                level=LevelEnum.DEFAULT if status == 'succeeded' else LevelEnum.ERROR,
                status_message=error if error else "",
            )

            self.add_span(langfuse_span_data=span_data)

    def message_trace(self, message_id: str, conversation_id: str, **kwargs):
        message_data = kwargs.get("message_data")
        conversation_mode = kwargs.get("conversation_mode")
        message_tokens = message_data.message_tokens
        answer_tokens = message_data.answer_tokens
        total_tokens = message_tokens + answer_tokens
        error = message_data.error if message_data.error else ""
        input = message_data.message
        file_list = input[0].get("files", [])
        provider_response_latency = message_data.provider_response_latency
        created_at = message_data.created_at
        end_time = created_at + timedelta(seconds=provider_response_latency)

        # get message file data
        message_file_data: MessageFile = kwargs.get("message_file_data")
        file_url = f"{self.file_base_url}/{message_file_data.url}" if message_file_data else ""
        file_list.append(file_url)

        metadata = {
            "conversation_id": conversation_id,
            "ls_provider": message_data.model_provider,
            "ls_model_name": message_data.model_id,
            "status": message_data.status,
            "from_end_user_id": message_data.from_account_id,
            "from_account_id": message_data.from_account_id,
            "agent_based": message_data.agent_based,
            "workflow_run_id": message_data.workflow_run_id,
            "from_source": message_data.from_source,
        }

        trace_data = LangfuseTrace(
            id=message_id,
            user_id=message_data.from_end_user_id if message_data.from_end_user_id else message_data.from_account_id,
            name=f"message_{message_id}",
            input={
                "message": input,
                "files": file_list,
                "message_tokens": message_tokens,
                "answer_tokens": answer_tokens,
                "total_tokens": total_tokens,
                "error": error,
                "provider_response_latency": provider_response_latency,
                "created_at": created_at,
            },
            output=message_data.answer,
            metadata=metadata,
            session_id=conversation_id,
            tags=["message", str(conversation_mode)],
        )
        self.add_trace(langfuse_trace_data=trace_data)

        # start add span
        generation_usage = GenerationUsage(
            totalTokens=total_tokens,
            input=message_tokens,
            output=answer_tokens,
            total=total_tokens,
            unit=UnitEnum.TOKENS,
        )

        langfuse_generation_data = LangfuseGeneration(
            name=f"generation_{message_id}",
            trace_id=message_id,
            start_time=created_at,
            end_time=end_time,
            model=message_data.model_id,
            input=input,
            output=message_data.answer,
            metadata=metadata,
            level=LevelEnum.DEFAULT if message_data.status != 'error' else LevelEnum.ERROR,
            status_message=message_data.error if message_data.error else "",
            usage=generation_usage,
        )

        self.add_generation(langfuse_generation_data)

    def moderation_trace(self, message_id: str, moderation_result: ModerationInputsResult, **kwargs):
        inputs = kwargs.get("inputs")
        message_data = kwargs.get("message_data")
        flagged = moderation_result.flagged
        action = moderation_result.action
        preset_response = moderation_result.preset_response
        query = moderation_result.query
        timer = kwargs.get("timer")
        start_time = timer.get("start")
        end_time = timer.get("end")

        metadata = {
            "message_id": message_id,
            "action": action,
            "preset_response": preset_response,
            "query": query,
        }

        span_data = LangfuseSpan(
            name="moderation",
            input=inputs,
            output={
                "action": action,
                "flagged": flagged,
                "preset_response": preset_response,
                "inputs": inputs,
            },
            trace_id=message_id,
            start_time=start_time or message_data.created_at,
            end_time=end_time or message_data.created_at,
            metadata=metadata,
        )

        self.add_span(langfuse_span_data=span_data)

    def suggested_question_trace(self, message_id: str, suggested_question: str, **kwargs):
        message_data = kwargs.get("message_data")
        timer = kwargs.get("timer")
        start_time = timer.get("start")
        end_time = timer.get("end")
        input = message_data.query

        metadata = {
            "message_id": message_id,
            "ls_provider": message_data.model_provider,
            "ls_model_name": message_data.model_id,
            "status": message_data.status,
            "from_end_user_id": message_data.from_account_id,
            "from_account_id": message_data.from_account_id,
            "agent_based": message_data.agent_based,
            "workflow_run_id": message_data.workflow_run_id,
            "from_source": message_data.from_source,
        }

        generation_usage = GenerationUsage(
            totalTokens=len(suggested_question),
            input=len(input),
            output=len(suggested_question),
            total=len(suggested_question),
            unit=UnitEnum.CHARACTERS,
        )

        generation_data = LangfuseGeneration(
            name="suggested_question",
            input=input,
            output=str(suggested_question),
            trace_id=message_id,
            start_time=start_time,
            end_time=end_time,
            metadata=metadata,
            level=LevelEnum.DEFAULT if message_data.status != 'error' else LevelEnum.ERROR,
            status_message=message_data.error if message_data.error else "",
            usage=generation_usage,
        )

        self.add_generation(langfuse_generation_data=generation_data)

    def dataset_retrieval_trace(self, message_id: str, documents: list[Document], **kwargs):
        message_data = kwargs.get("message_data")
        inputs = message_data.query if message_data.query else message_data.inputs
        metadata = {
            "message_id": message_id,
            "documents": documents
        }
        timer = kwargs.get("timer")
        start_time = timer.get("start")
        end_time = timer.get("end")

        dataset_retrieval_span_data = LangfuseSpan(
            name="dataset_retrieval",
            input=inputs,
            output={"documents": documents},
            trace_id=message_id,
            start_time=start_time,
            end_time=end_time,
            metadata=metadata,
        )

        self.add_span(langfuse_span_data=dataset_retrieval_span_data)

    def tool_trace(self, message_id: str, tool_name: str, tool_inputs: dict[str, Any], tool_outputs: str, **kwargs):
        message_data: Message = kwargs.get("message_data")
        created_time = message_data.created_at
        end_time = message_data.updated_at
        tool_config = {}
        time_cost = 0
        error = None
        tool_parameters = {}

        agent_thoughts: list[MessageAgentThought] = message_data.agent_thoughts
        for agent_thought in agent_thoughts:
            if tool_name in agent_thought.tools:
                created_time = agent_thought.created_at
                tool_meta_data = agent_thought.tool_meta.get(tool_name, {})
                tool_config = tool_meta_data.get('tool_config', {})
                time_cost = tool_meta_data.get('time_cost', 0)
                end_time = created_time + timedelta(seconds=time_cost)
                error = tool_meta_data.get('error', "")
                tool_parameters = tool_meta_data.get('tool_parameters', {})

        metadata = {
            "message_id": message_id,
            "tool_name": tool_name,
            "tool_inputs": tool_inputs,
            "tool_outputs": tool_outputs,
            "tool_config": tool_config,
            "time_cost": time_cost,
            "error": error,
            "tool_parameters": tool_parameters,
        }

        # get message file data
        message_file_data: MessageFile = kwargs.get("message_file_data")
        if message_file_data:
            message_file_id = message_file_data.id if message_file_data else None
            type = message_file_data.type
            created_by_role = message_file_data.created_by_role
            created_user_id = message_file_data.created_by

            metadata.update(
                {
                    "message_file_id": message_file_id,
                    "created_by_role": created_by_role,
                    "created_user_id": created_user_id,
                    "type": type,
                }
            )

        tool_span_data = LangfuseSpan(
            name=tool_name,
            input=tool_inputs,
            output=tool_outputs,
            trace_id=message_id,
            start_time=created_time,
            end_time=end_time,
            metadata=metadata,
            level=LevelEnum.DEFAULT if error == "" else LevelEnum.ERROR,
            status_message=error,
        )

        self.add_span(langfuse_span_data=tool_span_data)

    def generate_name_trace(self, conversation_id: str, inputs: str, generate_conversation_name: str, **kwargs):
        timer = kwargs.get("timer")
        tenant_id = kwargs.get("tenant_id")
        start_time = timer.get("start")
        end_time = timer.get("end")

        metadata = {
            "conversation_id": conversation_id,
        }

        name_generation_trace_data = LangfuseTrace(
            name="generate_name",
            input=inputs,
            output=generate_conversation_name,
            user_id=tenant_id,
            metadata=metadata,
            session_id=conversation_id,
        )

        self.add_trace(langfuse_trace_data=name_generation_trace_data)

        name_generation_span_data = LangfuseSpan(
            name="generate_name",
            input=inputs,
            output=generate_conversation_name,
            trace_id=conversation_id,
            start_time=start_time,
            end_time=end_time,
            metadata=metadata,
        )
        self.add_span(langfuse_span_data=name_generation_span_data)

    def add_trace(self, langfuse_trace_data: Optional[LangfuseTrace] = None):
        format_trace_data = (
            filter_none_values(langfuse_trace_data.model_dump()) if langfuse_trace_data else {}
        )
        try:
            self.langfuse_client.trace(**format_trace_data)
            logger.debug("LangFuse Trace created successfully")
        except Exception as e:
            raise f"LangFuse Failed to create trace: {str(e)}"

    def add_span(self, langfuse_span_data: Optional[LangfuseSpan] = None):
        format_span_data = (
            filter_none_values(langfuse_span_data.model_dump()) if langfuse_span_data else {}
        )
        try:
            self.langfuse_client.span(**format_span_data)
            logger.debug("LangFuse Span created successfully")
        except Exception as e:
            raise f"LangFuse Failed to create span: {str(e)}"

    def update_span(self, span, langfuse_span_data: Optional[LangfuseSpan] = None):
        format_span_data = (
            filter_none_values(langfuse_span_data.model_dump()) if langfuse_span_data else {}
        )

        span.end(**format_span_data)

    def add_generation(
        self, langfuse_generation_data: Optional[LangfuseGeneration] = None
    ):
        format_generation_data = (
            filter_none_values(langfuse_generation_data.model_dump())
            if langfuse_generation_data
            else {}
        )
        try:
            self.langfuse_client.generation(**format_generation_data)
            logger.debug("LangFuse Generation created successfully")
        except Exception as e:
            raise f"LangFuse Failed to create generation: {str(e)}"

    def update_generation(
        self, generation, langfuse_generation_data: Optional[LangfuseGeneration] = None
    ):
        format_generation_data = (
            filter_none_values(langfuse_generation_data.model_dump())
            if langfuse_generation_data
            else {}
        )

        generation.end(**format_generation_data)

    def api_check(self):
        try:
            return self.langfuse_client.auth_check()
        except Exception as e:
            logger.debug(f"LangFuse API check failed: {str(e)}")
            return False

    @classmethod
    def obfuscate_config(cls, config: LangfuseConfig):
        public_key = obfuscated_token(config.public_key)
        secret_key = obfuscated_token(config.secret_key)
        return LangfuseConfig(public_key=public_key, secret_key=secret_key, host=config.host)

    @classmethod
    def encrypt_config(cls, tenant_id, config: LangfuseConfig):
        decrypt_public_key = encrypt_token(tenant_id, config.public_key)
        decrypt_secret_key = encrypt_token(tenant_id, config.secret_key)
        return LangfuseConfig(public_key=decrypt_public_key, secret_key=decrypt_secret_key, host=config.host)

    @classmethod
    def decrypt_config(cls, tenant_id, config: LangfuseConfig):
        decrypt_public_key = decrypt_token(tenant_id, config.public_key)
        decrypt_secret_key = decrypt_token(tenant_id, config.secret_key)
        return LangfuseConfig(public_key=decrypt_public_key, secret_key=decrypt_secret_key, host=config.host)
