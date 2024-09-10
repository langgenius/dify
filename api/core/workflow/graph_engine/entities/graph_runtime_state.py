from typing import Any

from pydantic import BaseModel, Field

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.runtime_route_state import RuntimeRouteState


class GraphRuntimeState(BaseModel):
    variable_pool: VariablePool = Field(..., description="variable pool")
    """variable pool"""

    start_at: float = Field(..., description="start time")
    """start time"""
    total_tokens: int = 0
    """total tokens"""
    llm_usage: LLMUsage = LLMUsage.empty_usage()
    """llm usage info"""
    outputs: dict[str, Any] = {}
    """outputs"""

    node_run_steps: int = 0
    """node run steps"""

    node_run_state: RuntimeRouteState = RuntimeRouteState()
    """node run state"""
