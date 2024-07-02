
from pydantic import BaseModel, Field

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.runtime_graph import RuntimeGraph
from core.workflow.nodes.base_node import UserFrom
from models.workflow import WorkflowType


class WorkflowRuntimeState(BaseModel):
    tenant_id: str
    app_id: str
    workflow_id: str
    workflow_type: WorkflowType
    user_id: str
    user_from: UserFrom
    variable_pool: VariablePool
    invoke_from: InvokeFrom
    graph: Graph
    call_depth: int
    start_at: float

    total_tokens: int = 0
    node_run_steps: int = 0

    runtime_graph: RuntimeGraph = Field(default_factory=RuntimeGraph)
