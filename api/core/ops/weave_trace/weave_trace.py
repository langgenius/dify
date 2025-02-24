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


    def trace(self, trace_info: BaseTraceInfo):
        pass

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

    def add_run(self, run_data: dict, parent_run_id: Optional[str] = None):
        call = self.weave_client.create_call(op=run_data["name"], inputs=run_data["inputs"])
        self.calls[run_data["id"]] = call
        if parent_run_id:
            self.calls[run_data["id"]].parent_id = parent_run_id

    def update_run(self, run_data: dict):
        call = self.calls.get(run_data["id"])
        if call:
            self.weave_client.finish_call(call, output=run_data["outputs"])
        else:
            raise ValueError(f"Call with id {run_data['id']} not found")