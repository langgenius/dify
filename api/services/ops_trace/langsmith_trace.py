import json
import os
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Optional, Union

from langsmith import Client
from pydantic import BaseModel, Field, field_validator
from pydantic_core.core_schema import ValidationInfo

from core.moderation.base import ModerationInputsResult
from extensions.ext_database import db
from models.dataset import Document
from models.model import Message, MessageAgentThought, MessageFile
from models.workflow import WorkflowNodeExecution, WorkflowRun
from services.ops_trace.base_trace_instance import BaseTraceInstance
from services.ops_trace.utils import filter_none_values


class LangSmithRunType(str, Enum):
    tool = "tool"
    chain = "chain"
    llm = "llm"
    retriever = "retriever"
    embedding = "embedding"
    prompt = "prompt"
    parser = "parser"


class LangSmithTokenUsage(BaseModel):
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None


class LangSmithMultiModel(BaseModel):
    file_list: Optional[list[str]] = Field(None, description="List of files")


class LangSmithRunModel(LangSmithTokenUsage, LangSmithMultiModel):
    name: Optional[str] = Field(..., description="Name of the run")
    inputs: Optional[Union[str, dict[str, Any], list, None]] = Field(None, description="Inputs of the run")
    outputs: Optional[Union[str, dict[str, Any], list, None]] = Field(None, description="Outputs of the run")
    run_type: LangSmithRunType = Field(..., description="Type of the run")
    start_time: Optional[datetime | str] = Field(None, description="Start time of the run")
    end_time: Optional[datetime | str] = Field(None, description="End time of the run")
    extra: Optional[dict[str, Any]] = Field(
        None, description="Extra information of the run"
    )
    error: Optional[str] = Field(None, description="Error message of the run")
    serialized: Optional[dict[str, Any]] = Field(
        None, description="Serialized data of the run"
    )
    parent_run_id: Optional[str] = Field(None, description="Parent run ID")
    events: Optional[list[dict[str, Any]]] = Field(
        None, description="Events associated with the run"
    )
    tags: Optional[list[str]] = Field(None, description="Tags associated with the run")
    trace_id: Optional[str] = Field(
        None, description="Trace ID associated with the run"
    )
    dotted_order: Optional[str] = Field(None, description="Dotted order of the run")
    id: Optional[str] = Field(None, description="ID of the run")
    session_id: Optional[str] = Field(
        None, description="Session ID associated with the run"
    )
    session_name: Optional[str] = Field(
        None, description="Session name associated with the run"
    )
    reference_example_id: Optional[str] = Field(
        None, description="Reference example ID associated with the run"
    )
    input_attachments: Optional[dict[str, Any]] = Field(
        None, description="Input attachments of the run"
    )
    output_attachments: Optional[dict[str, Any]] = Field(
        None, description="Output attachments of the run"
    )

    @field_validator("inputs", "outputs")
    def ensure_dict(cls, v, info: ValidationInfo):
        field_name = info.field_name
        values = info.data
        if v == {} or v is None:
            return v
        usage_metadata = {
            "input_tokens": values.get('input_tokens', 0),
            "output_tokens": values.get('output_tokens', 0),
            "total_tokens": values.get('total_tokens', 0),
        }
        file_list = values.get("file_list", [])
        if isinstance(v, str):
            return {
                field_name: v,
                "file_list": file_list,
                "usage_metadata": usage_metadata,
            }
        elif isinstance(v, list):
            if len(v) > 0 and isinstance(v[0], dict):
                data = {
                    "message": v,
                    "usage_metadata": usage_metadata,
                    "file_list": file_list,
                }
                return data
            else:
                return {field_name: v}
        if isinstance(v, dict):
            v["usage_metadata"] = usage_metadata
            v["file_list"] = file_list
            return v
        return v

    @field_validator("start_time", "end_time")
    def format_time(cls, v, info: ValidationInfo):
        if not isinstance(v, datetime):
            raise ValueError(f"{info.field_name} must be a datetime object")
        else:
            return v.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class LangSmithRunUpdateModel(BaseModel):
    run_id: str = Field(..., description="ID of the run")
    trace_id: Optional[str] = Field(
        None, description="Trace ID associated with the run"
    )
    dotted_order: Optional[str] = Field(None, description="Dotted order of the run")
    parent_run_id: Optional[str] = Field(None, description="Parent run ID")
    end_time: Optional[datetime | str] = Field(None, description="End time of the run")
    error: Optional[str] = Field(None, description="Error message of the run")
    inputs: Optional[dict[str, Any]] = Field(None, description="Inputs of the run")
    outputs: Optional[dict[str, Any]] = Field(None, description="Outputs of the run")
    events: Optional[list[dict[str, Any]]] = Field(
        None, description="Events associated with the run"
    )
    tags: Optional[list[str]] = Field(None, description="Tags associated with the run")
    extra: Optional[dict[str, Any]] = Field(
        None, description="Extra information of the run"
    )
    input_attachments: Optional[dict[str, Any]] = Field(
        None, description="Input attachments of the run"
    )
    output_attachments: Optional[dict[str, Any]] = Field(
        None, description="Output attachments of the run"
    )


class LangSmithDataTrace(BaseTraceInstance):
    def __init__(
        self,
        langsmith_key: str = None,
        project_name: str = None,
        endpoint: str = "https://api.smith.langchain.com"
    ):
        super().__init__()
        self.langsmith_key = langsmith_key
        self.project_name = project_name
        self.project_id = None
        self.langsmith_client = Client(
            api_key=langsmith_key, api_url=endpoint
        )
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")

    def workflow_trace(self, workflow_run: WorkflowRun, **kwargs):
        conversion_id = kwargs.get("conversation_id")
        workflow_id = workflow_run.workflow_id
        tenant_id = workflow_run.tenant_id
        workflow_run_id = workflow_run.id
        workflow_run_created_at = workflow_run.created_at
        workflow_run_finished_at = workflow_run.finished_at
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
        }

        langsmith_run = LangSmithRunModel(
            file_list=file_list,
            total_tokens=total_tokens,
            id=workflow_run_id,
            name=f"workflow_run_{workflow_run_id}",
            inputs=query,
            run_type=LangSmithRunType.tool,
            start_time=workflow_run_created_at,
            end_time=workflow_run_finished_at,
            outputs=workflow_run_outputs,
            extra={
                "metadata": metadata,
            },
            error=error,
            tags=["workflow"],
        )

        self.add_run(langsmith_run)

        # through workflow_run_id get all_nodes_execution
        workflow_nodes_executions = (
            db.session.query(WorkflowNodeExecution)
            .filter(WorkflowNodeExecution.workflow_run_id == workflow_run_id)
            .order_by(WorkflowNodeExecution.created_at)
            .all()
        )

        for node_execution in workflow_nodes_executions:
            node_execution_id = node_execution.id
            tenant_id = node_execution.tenant_id
            app_id = node_execution.app_id
            node_name = node_execution.title
            node_type = node_execution.node_type
            status = node_execution.status
            inputs = json.loads(node_execution.inputs) if node_execution.inputs else {}
            outputs = (
                json.loads(node_execution.outputs) if node_execution.outputs else {}
            )
            created_at = node_execution.created_at if node_execution.created_at else datetime.now()
            finished_at = node_execution.finished_at if node_execution.finished_at else datetime.now()
            execution_metadata = (
                json.loads(node_execution.execution_metadata)
                if node_execution.execution_metadata
                else {}
            )
            node_total_tokens = execution_metadata.get("total_tokens", 0)

            metadata = json.loads(node_execution.execution_metadata) if node_execution.execution_metadata else {}
            metadata.update(
                {
                    "node_execution_id": node_execution_id,
                    "tenant_id": tenant_id,
                    "app_id": app_id,
                    "app_name": node_name,
                    "node_type": node_type,
                    "status": status,
                }
            )

            process_data = json.loads(node_execution.process_data) if node_execution.process_data else {}
            if process_data and process_data.get("model_mode") == "chat":
                run_type = LangSmithRunType.llm
            elif node_type == "knowledge-retrieval":
                run_type = LangSmithRunType.retriever
            else:
                run_type = LangSmithRunType.tool

            langsmith_run = LangSmithRunModel(
                total_tokens=node_total_tokens,
                name=f"{node_name}_{node_execution_id}",
                inputs=inputs,
                run_type=run_type,
                start_time=created_at,
                end_time=finished_at,
                outputs=outputs,
                file_list=file_list,
                extra={
                    "metadata": metadata,
                },
                parent_run_id=workflow_run_id,
                tags=["node_execution"],
            )

            self.add_run(langsmith_run)

    def message_trace(self, message_id: str, conversation_id: str, **kwargs):
        message_data = kwargs.get("message_data")
        conversation_mode = kwargs.get("conversation_mode")
        message_tokens = message_data.message_tokens
        answer_tokens = message_data.answer_tokens
        total_tokens = message_tokens + answer_tokens
        error = message_data.error if message_data.error else ""
        inputs = message_data.message
        file_list = inputs[0].get("files", [])
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
        message_run = LangSmithRunModel(
            input_tokens=message_tokens,
            output_tokens=answer_tokens,
            total_tokens=total_tokens,
            id=message_id,
            name=f"message_{message_id}",
            inputs=inputs,
            run_type=LangSmithRunType.llm,
            start_time=created_at,
            end_time=end_time,
            outputs=message_data.answer,
            extra={
                "metadata": metadata,
            },
            tags=["message", str(conversation_mode)],
            error=error,
            file_list=file_list,
        )
        self.add_run(message_run)

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

        langsmith_run = LangSmithRunModel(
            name="moderation",
            inputs=inputs,
            outputs={
                "action": action,
                "flagged": flagged,
                "preset_response": preset_response,
                "inputs": inputs,
            },
            run_type=LangSmithRunType.tool,
            extra={
                "metadata": metadata,
            },
            tags=["moderation"],
            parent_run_id=message_id,
            start_time=start_time or message_data.created_at,
            end_time=end_time or message_data.updated_at,
        )

        self.add_run(langsmith_run)

    def suggested_question_trace(self, message_id: str, suggested_question: str, **kwargs):
        message_data = kwargs.get("message_data")
        timer = kwargs.get("timer")
        start_time = timer.get("start")
        end_time = timer.get("end")
        inputs = message_data.query

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

        suggested_question_run = LangSmithRunModel(
            name="suggested_question",
            inputs=inputs,
            outputs=suggested_question,
            run_type=LangSmithRunType.tool,
            extra={
                "metadata": metadata,
            },
            tags=["suggested_question"],
            parent_run_id=message_id,
            start_time=start_time or message_data.created_at,
            end_time=end_time or message_data.updated_at,
        )

        self.add_run(suggested_question_run)

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

        dataset_retrieval_run = LangSmithRunModel(
            name="dataset_retrieval",
            inputs=inputs,
            outputs={"documents": documents},
            run_type=LangSmithRunType.retriever,
            extra={
                "metadata": metadata,
            },
            tags=["dataset_retrieval"],
            parent_run_id=message_id,
            start_time=start_time or message_data.created_at,
            end_time=end_time or message_data.updated_at,
        )

        self.add_run(dataset_retrieval_run)

    def tool_trace(self, message_id: str, tool_name: str, tool_inputs: dict[str, Any], tool_outputs: str, **kwargs):
        message_data: Message = kwargs.get("message_data")
        created_time = message_data.created_at
        end_time = message_data.updated_at
        tool_config = {}
        time_cost = 0
        error = ""
        tool_parameters = {}
        file_url = ""

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
            file_url = f"{self.file_base_url}/{message_file_data.url}"

            metadata.update(
                {
                    "message_file_id": message_file_id,
                    "created_by_role": created_by_role,
                    "created_user_id": created_user_id,
                    "type": type,
                }
            )

        tool_run = LangSmithRunModel(
            name=tool_name,
            inputs=tool_inputs,
            outputs=tool_outputs,
            run_type=LangSmithRunType.tool,
            extra={
                "metadata": metadata,
            },
            tags=["tool", tool_name],
            parent_run_id=message_id,
            start_time=created_time,
            end_time=end_time,
            file_list=[file_url],
        )

        self.add_run(tool_run)

    def generate_name_trace(self, conversation_id: str, inputs: str, generate_conversation_name: str, **kwargs):
        timer = kwargs.get("timer")
        start_time = timer.get("start")
        end_time = timer.get("end")

        metadata = {
            "conversation_id": conversation_id,
        }

        name_run = LangSmithRunModel(
            name="generate_name",
            inputs=inputs,
            outputs=generate_conversation_name,
            run_type=LangSmithRunType.tool,
            extra={
                "metadata": metadata,
            },
            tags=["generate_name"],
            start_time=start_time or datetime.now(),
            end_time=end_time or datetime.now(),
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
            print("LangSmith Run created successfully.")
        except Exception as e:
            raise f"LangSmith Failed to create run: {str(e)}"

    def update_run(self, update_run_data: LangSmithRunUpdateModel):
        data = update_run_data.model_dump()
        data = filter_none_values(data)
        try:
            self.langsmith_client.update_run(**data)
            print("LangSmith Run updated successfully.")
        except Exception as e:
            raise f"LangSmith Failed to update run: {str(e)}"
