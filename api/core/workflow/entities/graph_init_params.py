from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, Field


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
    workflow_id: str = Field(..., description="workflow id")
    graph_config: Mapping[str, Any] = Field(..., description="graph config")
    user_id: str = Field(..., description="user id")
    user_from: str = Field(
        ..., description="user from, account or end-user"
    )  # Should be UserFrom enum: 'account' | 'end-user'
    invoke_from: str = Field(
        ..., description="invoke from, service-api, web-app, explore or debugger"
    )  # Should be InvokeFrom enum: 'service-api' | 'web-app' | 'explore' | 'debugger'
    call_depth: int = Field(..., description="call depth")
