import json
import os
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Optional, Union

from langfuse import Langfuse
from pydantic import BaseModel, Field, field_validator
from pydantic_core.core_schema import ValidationInfo

from core.moderation.base import ModerationInputsResult
from extensions.ext_database import db
from models.dataset import Document
from models.model import Message, MessageAgentThought, MessageFile
from models.workflow import WorkflowNodeExecution, WorkflowRun
from services.ops_trace.base_trace_instance import BaseTraceInstance
from services.ops_trace.utils import filter_none_values, replace_text_with_content


def validate_input_output(v, field_name):
    """
    Validate input output
    :param v:
    :param field_name:
    :return:
    """
    if v == {} or v is None:
        return v
    if isinstance(v, str):
        return [
            {
                "role": "assistant" if field_name == "output" else "user",
                "content": v,
            }
        ]
    elif isinstance(v, list):
        if len(v) > 0 and isinstance(v[0], dict):
            v = replace_text_with_content(data=v)
            return v
        else:
            return [
                {
                    "role": "assistant" if field_name == "output" else "user",
                    "content": str(v),
                }
            ]

    return v


class LevelEnum(str, Enum):
    DEBUG = "DEBUG"
    WARNING = "WARNING"
    ERROR = "ERROR"
    DEFAULT = "DEFAULT"


class LangfuseTrace(BaseModel):
    """
    Langfuse trace model
    """
    id: Optional[str] = Field(
        default=None,
        description="The id of the trace can be set, defaults to a random id. Used to link traces to external systems "
                    "or when creating a distributed trace. Traces are upserted on id.",
    )
    name: Optional[str] = Field(
        default=None,
        description="Identifier of the trace. Useful for sorting/filtering in the UI.",
    )
    input: Optional[Union[str, dict[str, Any], list, None]] = Field(
        default=None, description="The input of the trace. Can be any JSON object."
    )
    output: Optional[Union[str, dict[str, Any], list, None]] = Field(
        default=None, description="The output of the trace. Can be any JSON object."
    )
    metadata: Optional[dict[str, Any]] = Field(
        default=None,
        description="Additional metadata of the trace. Can be any JSON object. Metadata is merged when being updated "
                    "via the API.",
    )
    user_id: Optional[str] = Field(
        default=None,
        description="The id of the user that triggered the execution. Used to provide user-level analytics.",
    )
    session_id: Optional[str] = Field(
        default=None,
        description="Used to group multiple traces into a session in Langfuse. Use your own session/thread identifier.",
    )
    version: Optional[str] = Field(
        default=None,
        description="The version of the trace type. Used to understand how changes to the trace type affect metrics. "
                    "Useful in debugging.",
    )
    release: Optional[str] = Field(
        default=None,
        description="The release identifier of the current deployment. Used to understand how changes of different "
                    "deployments affect metrics. Useful in debugging.",
    )
    tags: Optional[list[str]] = Field(
        default=None,
        description="Tags are used to categorize or label traces. Traces can be filtered by tags in the UI and GET "
                    "API. Tags can also be changed in the UI. Tags are merged and never deleted via the API.",
    )
    public: Optional[bool] = Field(
        default=None,
        description="You can make a trace public to share it via a public link. This allows others to view the trace "
                    "without needing to log in or be members of your Langfuse project.",
    )

    @field_validator("input", "output")
    def ensure_dict(cls, v, info: ValidationInfo):
        field_name = info.field_name
        return validate_input_output(v, field_name)


class LangfuseSpan(BaseModel):
    """
    Langfuse span model
    """
    id: Optional[str] = Field(
        default=None,
        description="The id of the span can be set, otherwise a random id is generated. Spans are upserted on id.",
    )
    session_id: Optional[str] = Field(
        default=None,
        description="Used to group multiple spans into a session in Langfuse. Use your own session/thread identifier.",
    )
    trace_id: Optional[str] = Field(
        default=None,
        description="The id of the trace the span belongs to. Used to link spans to traces.",
    )
    user_id: Optional[str] = Field(
        default=None,
        description="The id of the user that triggered the execution. Used to provide user-level analytics.",
    )
    start_time: Optional[datetime | str] = Field(
        default_factory=datetime.now,
        description="The time at which the span started, defaults to the current time.",
    )
    end_time: Optional[datetime | str] = Field(
        default=None,
        description="The time at which the span ended. Automatically set by span.end().",
    )
    name: Optional[str] = Field(
        default=None,
        description="Identifier of the span. Useful for sorting/filtering in the UI.",
    )
    metadata: Optional[dict[str, Any]] = Field(
        default=None,
        description="Additional metadata of the span. Can be any JSON object. Metadata is merged when being updated "
                    "via the API.",
    )
    level: Optional[str] = Field(
        default=None,
        description="The level of the span. Can be DEBUG, DEFAULT, WARNING or ERROR. Used for sorting/filtering of "
                    "traces with elevated error levels and for highlighting in the UI.",
    )
    status_message: Optional[str] = Field(
        default=None,
        description="The status message of the span. Additional field for context of the event. E.g. the error "
                    "message of an error event.",
    )
    input: Optional[Union[str, dict[str, Any], list, None]] = Field(
        default=None, description="The input of the span. Can be any JSON object."
    )
    output: Optional[Union[str, dict[str, Any], list, None]] = Field(
        default=None, description="The output of the span. Can be any JSON object."
    )
    version: Optional[str] = Field(
        default=None,
        description="The version of the span type. Used to understand how changes to the span type affect metrics. "
                    "Useful in debugging.",
    )

    @field_validator("input", "output")
    def ensure_dict(cls, v, info: ValidationInfo):
        field_name = info.field_name
        return validate_input_output(v, field_name)


class UnitEnum(str, Enum):
    CHARACTERS = "CHARACTERS"
    TOKENS = "TOKENS"
    SECONDS = "SECONDS"
    MILLISECONDS = "MILLISECONDS"
    IMAGES = "IMAGES"


class GenerationUsage(BaseModel):
    promptTokens: Optional[int] = None
    completionTokens: Optional[int] = None
    totalTokens: Optional[int] = None
    input: Optional[int] = None
    output: Optional[int] = None
    total: Optional[int] = None
    unit: Optional[UnitEnum] = None
    inputCost: Optional[float] = None
    outputCost: Optional[float] = None
    totalCost: Optional[float] = None

    @field_validator("input", "output")
    def ensure_dict(cls, v, info: ValidationInfo):
        field_name = info.field_name
        return validate_input_output(v, field_name)


class LangfuseGeneration(BaseModel):
    id: Optional[str] = Field(
        default=None,
        description="The id of the generation can be set, defaults to random id.",
    )
    trace_id: Optional[str] = Field(
        default=None,
        description="The id of the trace the generation belongs to. Used to link generations to traces.",
    )
    parent_observation_id: Optional[str] = Field(
        default=None,
        description="The id of the observation the generation belongs to. Used to link generations to observations.",
    )
    name: Optional[str] = Field(
        default=None,
        description="Identifier of the generation. Useful for sorting/filtering in the UI.",
    )
    start_time: Optional[datetime | str] = Field(
        default_factory=datetime.now,
        description="The time at which the generation started, defaults to the current time.",
    )
    completion_start_time: Optional[datetime | str] = Field(
        default=None,
        description="The time at which the completion started (streaming). Set it to get latency analytics broken "
                    "down into time until completion started and completion duration.",
    )
    end_time: Optional[datetime | str] = Field(
        default=None,
        description="The time at which the generation ended. Automatically set by generation.end().",
    )
    model: Optional[str] = Field(
        default=None, description="The name of the model used for the generation."
    )
    model_parameters: Optional[dict[str, Any]] = Field(
        default=None,
        description="The parameters of the model used for the generation; can be any key-value pairs.",
    )
    input: Optional[Any] = Field(
        default=None,
        description="The prompt used for the generation. Can be any string or JSON object.",
    )
    output: Optional[Any] = Field(
        default=None,
        description="The completion generated by the model. Can be any string or JSON object.",
    )
    usage: Optional[GenerationUsage] = Field(
        default=None,
        description="The usage object supports the OpenAi structure with tokens and a more generic version with "
                    "detailed costs and units.",
    )
    metadata: Optional[dict[str, Any]] = Field(
        default=None,
        description="Additional metadata of the generation. Can be any JSON object. Metadata is merged when being "
                    "updated via the API.",
    )
    level: Optional[LevelEnum] = Field(
        default=None,
        description="The level of the generation. Can be DEBUG, DEFAULT, WARNING or ERROR. Used for sorting/filtering "
                    "of traces with elevated error levels and for highlighting in the UI.",
    )
    status_message: Optional[str] = Field(
        default=None,
        description="The status message of the generation. Additional field for context of the event. E.g. the error "
                    "message of an error event.",
    )
    version: Optional[str] = Field(
        default=None,
        description="The version of the generation type. Used to understand how changes to the span type affect "
                    "metrics. Useful in debugging.",
    )

    @field_validator("input", "output")
    def ensure_dict(cls, v, info: ValidationInfo):
        field_name = info.field_name
        return validate_input_output(v, field_name)


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
            print("LangFuse Trace created successfully")
        except Exception as e:
            raise f"LangFuse Failed to create trace: {str(e)}"

    def add_span(self, langfuse_span_data: Optional[LangfuseSpan] = None):
        format_span_data = (
            filter_none_values(langfuse_span_data.model_dump()) if langfuse_span_data else {}
        )
        try:
            self.langfuse_client.span(**format_span_data)
            print("LangFuse Span created successfully")
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
            print("LangFuse Generation created successfully")
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
            print(f"LangFuse API check failed: {str(e)}")
            return False
