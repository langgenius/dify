from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from core.workflow.nodes.trigger_plugin.trigger_event_node import TriggerEventNode
from dify_graph.entities.graph_init_params import DIFY_RUN_CONTEXT_KEY, GraphInitParams
from dify_graph.graph_events import NodeRunStartedEvent
from dify_graph.runtime.graph_runtime_state import GraphRuntimeState
from dify_graph.runtime.variable_pool import VariablePool
from dify_graph.system_variable import SystemVariable


def create_trigger_event_node(node_data: TriggerEventNodeData) -> TriggerEventNode:
    node_config = {
        "id": "trigger-node",
        "data": node_data.model_dump(),
    }
    graph_init_params = GraphInitParams(
        workflow_id="workflow-1",
        graph_config={},
        run_context={
            DIFY_RUN_CONTEXT_KEY: {
                "tenant_id": "tenant-1",
                "app_id": "app-1",
                "user_id": "user-1",
                "user_from": UserFrom.ACCOUNT,
                "invoke_from": InvokeFrom.SERVICE_API,
            }
        },
        call_depth=0,
    )
    runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(
            system_variables=SystemVariable.default(),
            user_inputs={},
        ),
        start_at=0,
    )
    return TriggerEventNode(
        id="trigger-node",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )


def test_trigger_event_start_event_carries_provider_metadata() -> None:
    node = create_trigger_event_node(
        TriggerEventNodeData(
            title="Plugin Trigger",
            provider_id="provider-1",
            plugin_id="plugin-1",
            event_name="event.created",
            subscription_id="subscription-1",
            plugin_unique_identifier="plugin/provider",
            event_parameters={},
        )
    )

    start_event = next(node.run())

    assert isinstance(start_event, NodeRunStartedEvent)
    assert start_event.provider_id == "provider-1"
    assert start_event.extras == {"provider_id": "provider-1"}
