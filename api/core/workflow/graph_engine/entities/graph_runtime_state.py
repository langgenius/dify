from typing import Optional

from pydantic import BaseModel, Field

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.runtime_route_state import RuntimeRouteState
from core.workflow.nodes.base_node import UserFrom


class GraphRuntimeState(BaseModel):
    # init params
    tenant_id: str
    app_id: str
    user_id: str
    user_from: UserFrom
    invoke_from: InvokeFrom
    call_depth: int

    variable_pool: VariablePool

    start_at: Optional[float] = None
    total_tokens: int = 0
    node_run_steps: int = 0

    node_run_state: RuntimeRouteState = Field(default_factory=RuntimeRouteState)
