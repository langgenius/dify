from typing import Optional

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_runtime_state_entities import WorkflowRuntimeState
from core.workflow.graph import GraphNode


def source_handle_condition_func(workflow_runtime_state: WorkflowRuntimeState,
                                 graph_node: GraphNode,
                                 # TODO cycle_state optional
                                 predecessor_node_run_result: Optional[NodeRunResult] = None) -> bool:
    if not graph_node.source_edge_config:
        return False

    if not graph_node.source_edge_config.get('sourceHandle'):
        return True

    source_handle = predecessor_node_run_result.edge_source_handle \
        if predecessor_node_run_result else None

    return (source_handle is not None
            and graph_node.source_edge_config.get('sourceHandle') == source_handle)
