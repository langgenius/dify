from collections.abc import Mapping

from graphon.entities import GraphInitParams
from graphon.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.runtime import GraphRuntimeState

from core.trigger.constants import TRIGGER_PLUGIN_NODE_TYPE
from core.workflow.nodes.trigger_plugin.trigger_event_node import TriggerEventNode
from core.workflow.system_variables import build_system_variables
from tests.workflow_test_utils import build_test_graph_init_params, build_test_variable_pool


def _build_context(graph_config: Mapping[str, object]) -> tuple[GraphInitParams, GraphRuntimeState]:
    init_params = build_test_graph_init_params(
        graph_config=graph_config,
        user_from="account",
        invoke_from="debugger",
    )
    runtime_state = GraphRuntimeState(
        variable_pool=build_test_variable_pool(
            variables=build_system_variables(user_id="user", files=[]),
            node_id="node-1",
            inputs={"payload": "value"},
        ),
        start_at=0.0,
    )
    return init_params, runtime_state


def _build_node_config() -> NodeConfigDict:
    return NodeConfigDictAdapter.validate_python(
        {
            "id": "node-1",
            "data": {
                "type": TRIGGER_PLUGIN_NODE_TYPE,
                "title": "Trigger Event",
                "plugin_id": "plugin-id",
                "provider_id": "provider-id",
                "event_name": "event-name",
                "subscription_id": "subscription-id",
                "plugin_unique_identifier": "plugin-unique-identifier",
                "event_parameters": {},
            },
        }
    )


def test_trigger_event_node_run_populates_trigger_info_metadata() -> None:
    init_params, runtime_state = _build_context(graph_config={})
    node = TriggerEventNode(
        id="node-1",
        config=_build_node_config(),
        graph_init_params=init_params,
        graph_runtime_state=runtime_state,
    )

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.metadata[WorkflowNodeExecutionMetadataKey.TRIGGER_INFO] == {
        "provider_id": "provider-id",
        "event_name": "event-name",
        "plugin_unique_identifier": "plugin-unique-identifier",
    }
