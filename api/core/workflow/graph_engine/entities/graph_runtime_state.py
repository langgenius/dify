from pydantic import BaseModel, Field

from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.runtime_route_state import RuntimeRouteState


class GraphRuntimeState(BaseModel):
    variable_pool: VariablePool = Field(..., description="variable pool")

    start_at: float = Field(..., description="start time")
    total_tokens: int = Field(0, description="total tokens")
    node_run_steps: int = Field(0, description="node run steps")

    node_run_state: RuntimeRouteState = Field(default_factory=RuntimeRouteState, description="node run state")
