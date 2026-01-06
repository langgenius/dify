from core.workflow.entities import GraphInitParams
from core.workflow.graph_events import (
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
    NodeRunSucceededEvent,
)
from core.workflow.nodes.iteration.iteration_node import IterationNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable


def test_iteration_node_emits_iteration_events_when_iterator_empty():
    init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config={},
        user_id="user",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )
    runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=SystemVariable.empty(), user_inputs={}),
        start_at=0.0,
    )
    runtime_state.variable_pool.add(("start", "items"), [])

    node = IterationNode(
        id="iteration-node",
        config={
            "id": "iteration-node",
            "data": {
                "title": "Iteration",
                "iterator_selector": ["start", "items"],
                "output_selector": ["iteration-node", "output"],
            },
        },
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
    )

    events = list(node.run())

    assert any(isinstance(event, NodeRunIterationStartedEvent) for event in events)

    iteration_succeeded_event = next(event for event in events if isinstance(event, NodeRunIterationSucceededEvent))
    assert iteration_succeeded_event.steps == 0
    assert iteration_succeeded_event.outputs == {"output": []}

    assert any(isinstance(event, NodeRunSucceededEvent) for event in events)
