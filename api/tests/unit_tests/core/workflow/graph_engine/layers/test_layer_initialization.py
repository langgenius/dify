from __future__ import annotations

import pytest

from core.workflow.graph_engine import GraphEngine, GraphEngineConfig
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_engine.layers.base import (
    GraphEngineLayer,
    GraphEngineLayerNotInitializedError,
)
from core.workflow.graph_events import GraphEngineEvent

from ..test_table_runner import WorkflowRunner


class LayerForTest(GraphEngineLayer):
    def on_graph_start(self) -> None:
        pass

    def on_event(self, event: GraphEngineEvent) -> None:
        pass

    def on_graph_end(self, error: Exception | None) -> None:
        pass


def test_layer_runtime_state_raises_when_uninitialized() -> None:
    layer = LayerForTest()

    with pytest.raises(GraphEngineLayerNotInitializedError):
        _ = layer.graph_runtime_state


def test_layer_runtime_state_available_after_engine_layer() -> None:
    runner = WorkflowRunner()
    fixture_data = runner.load_fixture("simple_passthrough_workflow")
    graph, graph_runtime_state = runner.create_graph_from_fixture(
        fixture_data,
        inputs={"query": "test layer state"},
    )
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )

    layer = LayerForTest()
    engine.layer(layer)

    outputs = layer.graph_runtime_state.outputs
    ready_queue_size = layer.graph_runtime_state.ready_queue_size

    assert outputs == {}
    assert isinstance(ready_queue_size, int)
    assert ready_queue_size >= 0
