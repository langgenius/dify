from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, Field, PositiveInt

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from models.enums import UserFrom
from models.workflow import WorkflowType


class GraphInitParams(BaseModel):
    """GraphInitParams encapsulates the configurations and contextual information
    that remain constant throughout a single execution of the graph engine.

    A single execution is defined as follows: as long as the execution has not reached
    its conclusion, it is considered one execution. For instance, if a workflow is suspended
    and later resumed, it is still regarded as a single execution, not two.

    For the state diagram of workflow execution, refer to `WorkflowExecutionStatus`.
    """

    # init params
    tenant_id: str = Field(..., description="tenant / workspace id")
    app_id: str = Field(..., description="app id")
    workflow_type: WorkflowType = Field(..., description="workflow type")
    workflow_id: str = Field(..., description="workflow id")
    graph_config: Mapping[str, Any] = Field(..., description="graph config")
    user_id: str = Field(..., description="user id")
    user_from: UserFrom = Field(..., description="user from, account or end-user")
    invoke_from: InvokeFrom = Field(..., description="invoke from, service-api, web-app, explore or debugger")
    call_depth: int = Field(..., description="call depth")

    # max_execution_steps records the maximum steps allowed during the execution of a workflow.
    max_execution_steps: PositiveInt = Field(
        default=dify_config.WORKFLOW_MAX_EXECUTION_STEPS, description="max_execution_steps"
    )
    # max_execution_time records the max execution time for the workflow, measured in seconds
    max_execution_time: PositiveInt = Field(default=dify_config.WORKFLOW_MAX_EXECUTION_TIME, description="")
