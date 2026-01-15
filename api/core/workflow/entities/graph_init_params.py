from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, Field


class GraphInitParams(BaseModel):
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
