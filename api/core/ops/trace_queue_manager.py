import json
import os
import queue
import threading
from datetime import timedelta
from enum import Enum
from typing import Any

from flask import Flask, current_app

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.utils import get_message_data
from extensions.ext_database import db
from models.model import Conversation, MessageAgentThought, MessageFile
from models.workflow import WorkflowRun
from services.ops_trace.ops_trace_service import OpsTraceService


class TraceTaskName(str, Enum):
    CONVERSATION_TRACE = 'conversation_trace'
    WORKFLOW_TRACE = 'workflow_trace'
    MESSAGE_TRACE = 'message_trace'
    MODERATION_TRACE = 'moderation_trace'
    SUGGESTED_QUESTION_TRACE = 'suggested_question_trace'
    DATASET_RETRIEVAL_TRACE = 'dataset_retrieval_trace'
    TOOL_TRACE = 'tool_trace'
    GENERATE_NAME_TRACE = 'generate_name_trace'


class TraceTask:
    def __init__(
        self,
        trace_type: Any,
        message_id: str = None,
        workflow_run: WorkflowRun = None,
        conversation_id: str = None,
        timer: Any = None,
        **kwargs
    ):
        self.trace_type = trace_type
        self.message_id = message_id
        self.workflow_run = workflow_run
        self.conversation_id = conversation_id
        self.timer = timer
        self.kwargs = kwargs
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")

    def execute(self, trace_instance: BaseTraceInstance):
        method_name, trace_info = self.preprocess()
        if trace_instance:
            method = trace_instance.trace
            method(trace_info)

    def preprocess(self):
        if self.trace_type == TraceTaskName.CONVERSATION_TRACE:
            return TraceTaskName.CONVERSATION_TRACE, self.conversation_trace(**self.kwargs)
        if self.trace_type == TraceTaskName.WORKFLOW_TRACE:
            return TraceTaskName.WORKFLOW_TRACE, self.workflow_trace(self.workflow_run, self.conversation_id)
        elif self.trace_type == TraceTaskName.MESSAGE_TRACE:
            return TraceTaskName.MESSAGE_TRACE, self.message_trace(self.message_id)
        elif self.trace_type == TraceTaskName.MODERATION_TRACE:
            return TraceTaskName.MODERATION_TRACE, self.moderation_trace(self.message_id, self.timer, **self.kwargs)
        elif self.trace_type == TraceTaskName.SUGGESTED_QUESTION_TRACE:
            return TraceTaskName.SUGGESTED_QUESTION_TRACE, self.suggested_question_trace(
                self.message_id, self.timer, **self.kwargs
            )
        elif self.trace_type == TraceTaskName.DATASET_RETRIEVAL_TRACE:
            return TraceTaskName.DATASET_RETRIEVAL_TRACE, self.dataset_retrieval_trace(
                self.message_id, self.timer, **self.kwargs
            )
        elif self.trace_type == TraceTaskName.TOOL_TRACE:
            return TraceTaskName.TOOL_TRACE, self.tool_trace(self.message_id, self.timer, **self.kwargs)
        elif self.trace_type == TraceTaskName.GENERATE_NAME_TRACE:
            return TraceTaskName.GENERATE_NAME_TRACE, self.generate_name_trace(
                self.conversation_id, self.timer, **self.kwargs
            )
        else:
            return '', {}

    # process methods for different trace types
    def conversation_trace(self, **kwargs):
        return kwargs

    def workflow_trace(self, workflow_run: WorkflowRun, conversation_id):
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
            "conversation_id": conversation_id,
            "workflow_run_id": workflow_run_id,
            "tenant_id": tenant_id,
            "elapsed_time": workflow_run_elapsed_time,
            "status": workflow_run_status,
            "version": workflow_run_version,
            "total_tokens": total_tokens,
            "file_list": file_list,
            "triggered_form": workflow_run.triggered_from,
        }

        workflow_trace_info = WorkflowTraceInfo(
            workflow_data=workflow_run,
            conversation_id=conversation_id,
            workflow_id=workflow_id,
            tenant_id=tenant_id,
            workflow_run_id=workflow_run_id,
            workflow_run_elapsed_time=workflow_run_elapsed_time,
            workflow_run_status=workflow_run_status,
            workflow_run_inputs=workflow_run_inputs,
            workflow_run_outputs=workflow_run_outputs,
            workflow_run_version=workflow_run_version,
            error=error,
            total_tokens=total_tokens,
            file_list=file_list,
            query=query,
            metadata=metadata,
        )

        return workflow_trace_info

    def message_trace(self, message_id):
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        conversation_mode = db.session.query(Conversation.mode).filter_by(id=message_data.conversation_id).first()
        conversation_mode = conversation_mode[0]
        created_at = message_data.created_at
        inputs = message_data.message

        # get message file data
        message_file_data = db.session.query(MessageFile).filter_by(message_id=message_id).first()
        file_url = f"{self.file_base_url}/{message_file_data.url}" if message_file_data else ""
        file_list = inputs[0].get("files", [])
        file_list.append(file_url)

        metadata = {
            "conversation_id": message_data.conversation_id,
            "ls_provider": message_data.model_provider,
            "ls_model_name": message_data.model_id,
            "status": message_data.status,
            "from_end_user_id": message_data.from_account_id,
            "from_account_id": message_data.from_account_id,
            "agent_based": message_data.agent_based,
            "workflow_run_id": message_data.workflow_run_id,
            "from_source": message_data.from_source,
        }

        message_tokens = message_data.message_tokens

        message_trace_info = MessageTraceInfo(
            message_data=message_data,
            conversation_model=conversation_mode,
            message_tokens=message_tokens,
            answer_tokens=message_data.answer_tokens,
            total_tokens=message_tokens + message_data.answer_tokens,
            error=message_data.error if message_data.error else "",
            inputs=inputs,
            outputs=message_data.answer,
            file_list=message_data.message[0].get("files", []),
            start_time=created_at,
            end_time=created_at + timedelta(seconds=message_data.provider_response_latency),
            metadata=metadata,
            message_file_data=message_file_data,
            conversation_mode=conversation_mode,
        )

        return message_trace_info

    def moderation_trace(self, message_id, timer, **kwargs):
        moderation_result = kwargs.get("moderation_result")
        inputs = kwargs.get("inputs")
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        metadata = {
            "message_id": message_id,
            "action": moderation_result.action,
            "preset_response": moderation_result.preset_response,
            "query": moderation_result.query,
        }
        moderation_trace_info = ModerationTraceInfo(
            message_id=message_id,
            inputs=inputs,
            message_data=message_data,
            flagged=moderation_result.flagged,
            action=moderation_result.action,
            preset_response=moderation_result.preset_response,
            query=moderation_result.query,
            start_time=timer.get("start"),
            end_time=timer.get("end"),
            metadata=metadata,
        )

        return moderation_trace_info

    def suggested_question_trace(self, message_id, timer, **kwargs):
        suggested_question = kwargs.get("suggested_question")
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
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
        suggested_question_trace_info = SuggestedQuestionTraceInfo(
            message_id=message_id,
            message_data=message_data,
            inputs=message_data.message,
            outputs=message_data.answer,
            start_time=timer.get("start"),
            end_time=timer.get("end"),
            metadata=metadata,
            total_tokens=message_data.message_tokens + message_data.answer_tokens,
            status=message_data.status,
            error=message_data.error,
            from_account_id=message_data.from_account_id,
            agent_based=message_data.agent_based,
            from_source=message_data.from_source,
            model_provider=message_data.model_provider,
            model_id=message_data.model_id,
            suggested_question=suggested_question,
            level=message_data.status,
            status_message=message_data.error,
        )

        return suggested_question_trace_info

    def dataset_retrieval_trace(self, message_id, timer, **kwargs):
        documents = kwargs.get("documents")
        message_data = get_message_data(message_id)
        if not message_data:
            return {}

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

        dataset_retrieval_trace_info = DatasetRetrievalTraceInfo(
            message_id=message_id,
            inputs=message_data.query if message_data.query else message_data.inputs,
            documents=documents,
            start_time=timer.get("start"),
            end_time=timer.get("end"),
            metadata=metadata,
            message_data=message_data,
        )

        return dataset_retrieval_trace_info

    def tool_trace(self, message_id, timer, **kwargs):
        tool_name = kwargs.get('tool_name')
        tool_inputs = kwargs.get('tool_inputs')
        tool_outputs = kwargs.get('tool_outputs')
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        tool_config = {}
        time_cost = 0
        error = None
        tool_parameters = {}
        created_time = message_data.created_at
        end_time = message_data.updated_at
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

        file_url = ""
        message_file_data = db.session.query(MessageFile).filter_by(message_id=message_id).first()
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

        tool_trace_info = ToolTraceInfo(
            message_id=message_id,
            message_data=message_data,
            tool_name=tool_name,
            start_time=timer.get("start") if timer else created_time,
            end_time=timer.get("end") if timer else end_time,
            tool_inputs=tool_inputs,
            tool_outputs=tool_outputs,
            metadata=metadata,
            message_file_data=message_file_data,
            error=error,
            inputs=message_data.message,
            outputs=message_data.answer,
            tool_config=tool_config,
            time_cost=time_cost,
            tool_parameters=tool_parameters,
            file_url=file_url,
        )

        return tool_trace_info

    def generate_name_trace(self, conversation_id, timer, **kwargs):
        generate_conversation_name = kwargs.get("generate_conversation_name")
        inputs = kwargs.get("inputs")
        tenant_id = kwargs.get("tenant_id")
        start_time = timer.get("start")
        end_time = timer.get("end")

        metadata = {
            "conversation_id": conversation_id,
            "tenant_id": tenant_id,
        }

        generate_name_trace_info = GenerateNameTraceInfo(
            conversation_id=conversation_id,
            inputs=inputs,
            outputs=generate_conversation_name,
            start_time=start_time,
            end_time=end_time,
            metadata=metadata,
            tenant_id=tenant_id,
        )

        return generate_name_trace_info


class TraceQueueManager:
    def __init__(self, app_id=None, conversation_id=None, message_id=None):
        tracing_instance = OpsTraceService.get_ops_trace_instance(app_id, conversation_id, message_id)
        self.queue = queue.Queue()
        self.is_running = True
        self.thread = threading.Thread(
            target=self.process_queue, kwargs={
                'flask_app': current_app._get_current_object(),
                'trace_instance': tracing_instance
            }
        )
        self.thread.start()

    def stop(self):
        self.is_running = False

    def process_queue(self, flask_app: Flask, trace_instance: BaseTraceInstance):
        with flask_app.app_context():
            while self.is_running:
                try:
                    task = self.queue.get(timeout=60)
                    task.execute(trace_instance)
                    self.queue.task_done()
                except queue.Empty:
                    self.stop()

    def add_trace_task(self, trace_task: TraceTask):
        self.queue.put(trace_task)
