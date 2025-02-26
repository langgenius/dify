import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional, cast

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

from core.ops.utils import filter_none_values, generate_dotted_order
from extensions.ext_database import db
from models.model import EndUser, MessageFile
from models.workflow import WorkflowNodeExecution
import weave
import wandb
from core.ops.weave_trace.entities.weave_trace_entity import WeaveTraceModel

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
        self.weave_client = weave.init(project_name=f"{self.entity}/{self.project_name}" if self.entity else self.project_name)
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")
        self.calls = {}

    def get_project_url(self,):
        try:
            project_url = f"https://wandb.ai/{self.weave_client._project_id()}"
            return project_url
        except Exception as e:
            logger.debug(f"Weave get run url failed: {str(e)}")
            raise ValueError(f"Weave get run url failed: {str(e)}")


    def trace(self, trace_info: BaseTraceInfo):
        logger.debug(f"Trace info: {trace_info}")
        print("Trace info: ", trace_info)
        if isinstance(trace_info, WorkflowTraceInfo):
            # self.workflow_trace(trace_info)
            print("Workflow trace: ", trace_info)
            pass
        if isinstance(trace_info, MessageTraceInfo):
            self.message_trace(trace_info)
        if isinstance(trace_info, ModerationTraceInfo):
            print("Moderation trace: ", trace_info)
            pass
            # self.moderation_trace(trace_info)
        if isinstance(trace_info, SuggestedQuestionTraceInfo):
            print("Suggested question trace: ", trace_info)
            pass
            # self.suggested_question_trace(trace_info)
        if isinstance(trace_info, DatasetRetrievalTraceInfo):
            print("Dataset retrieval trace: ", trace_info)
            pass
            # self.dataset_retrieval_trace(trace_info)
        if isinstance(trace_info, ToolTraceInfo):
            print("Tool trace: ", trace_info)
            pass
            # self.tool_trace(trace_info)
        if isinstance(trace_info, GenerateNameTraceInfo):
            print("Generate name trace: ", trace_info)
            pass
            # self.generate_name_trace(trace_info)

    def message_trace(self, trace_info: MessageTraceInfo):
        # get message file data
        file_list = cast(list[str], trace_info.file_list) or []
        message_file_data: Optional[MessageFile] = trace_info.message_file_data
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
            end_user_data: Optional[EndUser] = (
                db.session.query(EndUser).filter(EndUser.id == message_data.from_end_user_id).first()
            )
            if end_user_data is not None:
                end_user_id = end_user_data.session_id
                metadata["end_user_id"] = end_user_id

        metadata["message_id"] = message_id
        metadata["start_time"]=trace_info.start_time
        metadata["end_time"]=trace_info.end_time
        metadata["tags"] = ["message", str(trace_info.conversation_mode)]
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
            attributes=metadata
        )
        self.add_run(message_run)

        # create llm run parented to message run
        llm_run = WeaveTraceModel(
            id=str(uuid.uuid4()),
            input_tokens=trace_info.message_tokens,
            output_tokens=trace_info.answer_tokens,
            total_tokens=trace_info.total_tokens,
            op="llm",
            inputs=trace_info.inputs,
            outputs=trace_info.outputs,
            attributes=metadata,
        )
        self.add_run(llm_run, parent_run_id=message_id,)
        self.update_run(llm_run)
        self.update_run(message_run)

    def moderation_trace(self, trace_info: ModerationTraceInfo):
        if trace_info.message_data is None:
            return

        metadata = trace_info.metadata
        metadata["tags"] = ["moderation"]
        metadata["start_time"] = trace_info.start_time or trace_info.message_data.created_at,
        metadata["end_time"] = trace_info.end_time or trace_info.message_data.updated_at,

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
            attributes=metadata,
        )
        self.add_run(moderation_run, parent_run_id=trace_info.message_id)

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

    def add_run(self, run_data: WeaveTraceModel, parent_run_id: Optional[str] = None):
        call = self.weave_client.create_call(op=run_data.op, inputs=run_data.inputs,  attributes=run_data.attributes)
        self.calls[run_data.id] = call
        if parent_run_id:
            self.calls[run_data.id].parent_id = parent_run_id

    def update_run(self, run_data: WeaveTraceModel):
        call = self.calls.get(run_data.id)
        if call:
            self.weave_client.finish_call(call=call, output=run_data.outputs, exception=run_data.exception)
        else:
            raise ValueError(f"Call with id {run_data['id']} not found")