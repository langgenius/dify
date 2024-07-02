import time
from collections.abc import Generator
from typing import cast

from flask import current_app

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.callbacks.base_workflow_callback import BaseWorkflowCallback
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.nodes.base_node import UserFrom


class GraphEngine:
    def __init__(self, tenant_id: str,
                 app_id: str,
                 user_id: str,
                 user_from: UserFrom,
                 invoke_from: InvokeFrom,
                 call_depth: int,
                 graph: Graph,
                 variable_pool: VariablePool,
                 callbacks: list[BaseWorkflowCallback]) -> None:
        self.graph_runtime_state = GraphRuntimeState(
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            call_depth=call_depth,
            graph=graph,
            variable_pool=variable_pool
        )

        max_execution_steps = current_app.config.get("WORKFLOW_MAX_EXECUTION_STEPS")
        self.max_execution_steps = cast(int, max_execution_steps)
        max_execution_time = current_app.config.get("WORKFLOW_MAX_EXECUTION_TIME")
        self.max_execution_time = cast(int, max_execution_time)

        self.callbacks = callbacks

    def run(self) -> Generator:
        self.graph_runtime_state.start_at = time.perf_counter()
        pass
