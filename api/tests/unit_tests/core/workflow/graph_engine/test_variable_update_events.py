import time
import uuid
from uuid import uuid4

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, InvokeFrom, UserFrom
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.system_variables import build_bootstrap_variables, build_system_variables
from core.workflow.variable_pool_initializer import add_variables_to_pool
from dify_graph.entities import GraphInitParams
from dify_graph.graph import Graph
from dify_graph.graph_engine import GraphEngine, GraphEngineConfig
from dify_graph.graph_engine.command_channels import InMemoryChannel
from dify_graph.graph_engine.layers.base import GraphEngineLayer
from dify_graph.graph_events import NodeRunVariableUpdatedEvent
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.variables import StringVariable

DEFAULT_NODE_ID = "node_id"


class CaptureVariableUpdateLayer(GraphEngineLayer):
    def __init__(self) -> None:
        super().__init__()
        self.events: list[NodeRunVariableUpdatedEvent] = []
        self.observed_values: list[object | None] = []

    def on_graph_start(self) -> None:
        pass

    def on_event(self, event) -> None:
        if not isinstance(event, NodeRunVariableUpdatedEvent):
            return

        current_value = self.graph_runtime_state.variable_pool.get(event.variable.selector)
        self.events.append(event)
        self.observed_values.append(None if current_value is None else current_value.value)

    def on_graph_end(self, error: Exception | None) -> None:
        pass


def test_graph_engine_applies_variable_updates_before_notifying_layers():
    graph_config = {
        "edges": [
            {
                "id": "start-source-assigner-target",
                "source": "start",
                "target": "assigner",
            },
        ],
        "nodes": [
            {"data": {"type": "start", "title": "Start"}, "id": "start"},
            {
                "data": {
                    "type": "assigner",
                    "title": "Variable Assigner",
                    "assigned_variable_selector": ["conversation", "test_conversation_variable"],
                    "write_mode": "over-write",
                    "input_variable_selector": ["node_id", "test_string_variable"],
                },
                "id": "assigner",
            },
        ],
    }

    init_params = GraphInitParams(
        workflow_id="1",
        graph_config=graph_config,
        run_context={
            DIFY_RUN_CONTEXT_KEY: {
                "tenant_id": "1",
                "app_id": "1",
                "user_id": "1",
                "user_from": UserFrom.ACCOUNT,
                "invoke_from": InvokeFrom.DEBUGGER,
            }
        },
        call_depth=0,
    )

    variable_pool = VariablePool()
    add_variables_to_pool(
        variable_pool,
        build_bootstrap_variables(
            system_variables=build_system_variables(conversation_id=str(uuid.uuid4())),
            conversation_variables=[
                StringVariable(
                    id=str(uuid4()),
                    name="test_conversation_variable",
                    value="the first value",
                )
            ],
        ),
    )
    variable_pool.add(
        [DEFAULT_NODE_ID, "test_string_variable"],
        StringVariable(
            id=str(uuid4()),
            name="test_string_variable",
            value="the second value",
        ),
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(graph_init_params=init_params, graph_runtime_state=graph_runtime_state)
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id="start")

    engine = GraphEngine(
        workflow_id="workflow-id",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )
    capture_layer = CaptureVariableUpdateLayer()
    engine.layer(capture_layer)

    events = list(engine.run())

    update_events = [event for event in events if isinstance(event, NodeRunVariableUpdatedEvent)]
    assert len(update_events) == 1
    assert update_events[0].variable.value == "the second value"

    current_value = graph_runtime_state.variable_pool.get(["conversation", "test_conversation_variable"])
    assert current_value is not None
    assert current_value.value == "the second value"

    assert len(capture_layer.events) == 1
    assert capture_layer.observed_values == ["the second value"]
