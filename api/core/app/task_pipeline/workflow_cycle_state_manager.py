from typing import Any, Union

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
from core.app.entities.task_entities import AdvancedChatTaskState, WorkflowTaskState
from core.workflow.enums import SystemVariableKey
from models.account import Account
from models.model import EndUser
from models.workflow import Workflow


class WorkflowCycleStateManager:
    _application_generate_entity: Union[AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity]
    _workflow: Workflow
    _user: Union[Account, EndUser]
    _task_state: Union[AdvancedChatTaskState, WorkflowTaskState]
    _workflow_system_variables: dict[SystemVariableKey, Any]
