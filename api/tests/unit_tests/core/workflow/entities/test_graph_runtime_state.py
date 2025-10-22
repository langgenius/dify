import json
from time import time
from unittest.mock import MagicMock, patch

import pytest

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.runtime import GraphRuntimeState, ReadOnlyGraphRuntimeStateWrapper, VariablePool


class StubCoordinator:
    def __init__(self) -> None:
        self.state = "initial"

    def dumps(self) -> str:
        return json.dumps({"state": self.state})

    def loads(self, data: str) -> None:
        payload = json.loads(data)
        self.state = payload["state"]


class TestGraphRuntimeState:
    def test_property_getters_and_setters(self):
        # FIXME(-LAN-): Mock VariablePool if needed
        variable_pool = VariablePool()
        start_time = time()

        state = GraphRuntimeState(variable_pool=variable_pool, start_at=start_time)

        # Test variable_pool property (read-only)
        assert state.variable_pool == variable_pool

        # Test start_at property
        assert state.start_at == start_time
        new_time = time() + 100
        state.start_at = new_time
        assert state.start_at == new_time

        # Test total_tokens property
        assert state.total_tokens == 0
        state.total_tokens = 100
        assert state.total_tokens == 100

        # Test node_run_steps property
        assert state.node_run_steps == 0
        state.node_run_steps = 5
        assert state.node_run_steps == 5

    def test_outputs_immutability(self):
        variable_pool = VariablePool()
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=time())

        # Test that getting outputs returns a copy
        outputs1 = state.outputs
        outputs2 = state.outputs
        assert outputs1 == outputs2
        assert outputs1 is not outputs2  # Different objects

        # Test that modifying retrieved outputs doesn't affect internal state
        outputs = state.outputs
        outputs["test"] = "value"
        assert "test" not in state.outputs

        # Test set_output method
        state.set_output("key1", "value1")
        assert state.get_output("key1") == "value1"

        # Test update_outputs method
        state.update_outputs({"key2": "value2", "key3": "value3"})
        assert state.get_output("key2") == "value2"
        assert state.get_output("key3") == "value3"

    def test_llm_usage_immutability(self):
        variable_pool = VariablePool()
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=time())

        # Test that getting llm_usage returns a copy
        usage1 = state.llm_usage
        usage2 = state.llm_usage
        assert usage1 is not usage2  # Different objects

    def test_type_validation(self):
        variable_pool = VariablePool()
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=time())

        # Test total_tokens validation
        with pytest.raises(ValueError):
            state.total_tokens = -1

        # Test node_run_steps validation
        with pytest.raises(ValueError):
            state.node_run_steps = -1

    def test_helper_methods(self):
        variable_pool = VariablePool()
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=time())

        # Test increment_node_run_steps
        initial_steps = state.node_run_steps
        state.increment_node_run_steps()
        assert state.node_run_steps == initial_steps + 1

        # Test add_tokens
        initial_tokens = state.total_tokens
        state.add_tokens(50)
        assert state.total_tokens == initial_tokens + 50

        # Test add_tokens validation
        with pytest.raises(ValueError):
            state.add_tokens(-1)

    def test_ready_queue_default_instantiation(self):
        state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time())

        queue = state.ready_queue

        from core.workflow.graph_engine.ready_queue import InMemoryReadyQueue

        assert isinstance(queue, InMemoryReadyQueue)
        assert state.ready_queue is queue

    def test_graph_execution_lazy_instantiation(self):
        state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time())

        execution = state.graph_execution

        from core.workflow.graph_engine.domain.graph_execution import GraphExecution

        assert isinstance(execution, GraphExecution)
        assert execution.workflow_id == ""
        assert state.graph_execution is execution

    def test_response_coordinator_configuration(self):
        variable_pool = VariablePool()
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=time())

        with pytest.raises(ValueError):
            _ = state.response_coordinator

        mock_graph = MagicMock()
        with patch("core.workflow.graph_engine.response_coordinator.ResponseStreamCoordinator") as coordinator_cls:
            coordinator_instance = MagicMock()
            coordinator_cls.return_value = coordinator_instance

            state.configure(graph=mock_graph)

            assert state.response_coordinator is coordinator_instance
            coordinator_cls.assert_called_once_with(variable_pool=variable_pool, graph=mock_graph)

            # Configure again with same graph should be idempotent
            state.configure(graph=mock_graph)

        other_graph = MagicMock()
        with pytest.raises(ValueError):
            state.attach_graph(other_graph)

    def test_read_only_wrapper_exposes_additional_state(self):
        state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time())
        state.configure()

        wrapper = ReadOnlyGraphRuntimeStateWrapper(state)

        assert wrapper.ready_queue_size == 0
        assert wrapper.exceptions_count == 0

    def test_read_only_wrapper_serializes_runtime_state(self):
        state = GraphRuntimeState(variable_pool=VariablePool(), start_at=time())
        state.total_tokens = 5
        state.set_output("result", {"success": True})
        state.ready_queue.put("node-1")

        wrapper = ReadOnlyGraphRuntimeStateWrapper(state)

        wrapper_snapshot = json.loads(wrapper.dumps())
        state_snapshot = json.loads(state.dumps())

        assert wrapper_snapshot == state_snapshot

    def test_dumps_and_loads_roundtrip_with_response_coordinator(self):
        variable_pool = VariablePool()
        variable_pool.add(("node1", "value"), "payload")

        state = GraphRuntimeState(variable_pool=variable_pool, start_at=time())
        state.total_tokens = 10
        state.node_run_steps = 3
        state.set_output("final", {"result": True})
        usage = LLMUsage.from_metadata(
            {
                "prompt_tokens": 2,
                "completion_tokens": 3,
                "total_tokens": 5,
                "total_price": "1.23",
                "currency": "USD",
                "latency": 0.5,
            }
        )
        state.llm_usage = usage
        state.ready_queue.put("node-A")

        graph_execution = state.graph_execution
        graph_execution.workflow_id = "wf-123"
        graph_execution.exceptions_count = 4
        graph_execution.started = True

        mock_graph = MagicMock()
        stub = StubCoordinator()
        with patch.object(GraphRuntimeState, "_build_response_coordinator", return_value=stub):
            state.attach_graph(mock_graph)

        stub.state = "configured"

        snapshot = state.dumps()

        restored = GraphRuntimeState.from_snapshot(snapshot)

        assert restored.total_tokens == 10
        assert restored.node_run_steps == 3
        assert restored.get_output("final") == {"result": True}
        assert restored.llm_usage.total_tokens == usage.total_tokens
        assert restored.ready_queue.qsize() == 1
        assert restored.ready_queue.get(timeout=0.01) == "node-A"

        restored_segment = restored.variable_pool.get(("node1", "value"))
        assert restored_segment is not None
        assert restored_segment.value == "payload"

        restored_execution = restored.graph_execution
        assert restored_execution.workflow_id == "wf-123"
        assert restored_execution.exceptions_count == 4
        assert restored_execution.started is True

        new_stub = StubCoordinator()
        with patch.object(GraphRuntimeState, "_build_response_coordinator", return_value=new_stub):
            restored.attach_graph(mock_graph)

        assert new_stub.state == "configured"

    def test_loads_rehydrates_existing_instance(self):
        variable_pool = VariablePool()
        variable_pool.add(("node", "key"), "value")

        state = GraphRuntimeState(variable_pool=variable_pool, start_at=time())
        state.total_tokens = 7
        state.node_run_steps = 2
        state.set_output("foo", "bar")
        state.ready_queue.put("node-1")

        execution = state.graph_execution
        execution.workflow_id = "wf-456"
        execution.started = True

        mock_graph = MagicMock()
        original_stub = StubCoordinator()
        with patch.object(GraphRuntimeState, "_build_response_coordinator", return_value=original_stub):
            state.attach_graph(mock_graph)

        original_stub.state = "configured"
        snapshot = state.dumps()

        new_stub = StubCoordinator()
        with patch.object(GraphRuntimeState, "_build_response_coordinator", return_value=new_stub):
            restored = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)
            restored.attach_graph(mock_graph)
            restored.loads(snapshot)

        assert restored.total_tokens == 7
        assert restored.node_run_steps == 2
        assert restored.get_output("foo") == "bar"
        assert restored.ready_queue.qsize() == 1
        assert restored.ready_queue.get(timeout=0.01) == "node-1"

        restored_segment = restored.variable_pool.get(("node", "key"))
        assert restored_segment is not None
        assert restored_segment.value == "value"

        restored_execution = restored.graph_execution
        assert restored_execution.workflow_id == "wf-456"
        assert restored_execution.started is True

        assert new_stub.state == "configured"
