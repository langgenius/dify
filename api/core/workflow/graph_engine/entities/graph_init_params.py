from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, Field

from core.app.entities.app_invoke_entities import InvokeFrom
from models.enums import UserFrom
from models.workflow import WorkflowType


class GraphInitParams(BaseModel):
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
