import time
from decimal import Decimal

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.graph_engine.entities.runtime_route_state import RuntimeRouteState
from core.workflow.system_variable import SystemVariable


def create_test_graph_runtime_state() -> GraphRuntimeState:
    """Factory function to create a GraphRuntimeState with non-empty values for testing."""
    # Create a variable pool with system variables
    system_vars = SystemVariable(
        user_id="test_user_123",
        app_id="test_app_456",
        workflow_id="test_workflow_789",
        workflow_execution_id="test_execution_001",
        query="test query",
        conversation_id="test_conv_123",
        dialogue_count=5,
    )
    variable_pool = VariablePool(system_variables=system_vars)

    # Add some variables to the variable pool
    variable_pool.add(["test_node", "test_var"], "test_value")
    variable_pool.add(["another_node", "another_var"], 42)

    # Create LLM usage with realistic values
    llm_usage = LLMUsage(
        prompt_tokens=150,
        prompt_unit_price=Decimal("0.001"),
        prompt_price_unit=Decimal(1000),
        prompt_price=Decimal("0.15"),
        completion_tokens=75,
        completion_unit_price=Decimal("0.002"),
        completion_price_unit=Decimal(1000),
        completion_price=Decimal("0.15"),
        total_tokens=225,
        total_price=Decimal("0.30"),
        currency="USD",
        latency=1.25,
    )

    # Create runtime route state with some node states
    node_run_state = RuntimeRouteState()
    node_state = node_run_state.create_node_state("test_node_1")
    node_run_state.add_route(node_state.id, "target_node_id")

    return GraphRuntimeState(
        variable_pool=variable_pool,
        start_at=time.perf_counter(),
        total_tokens=100,
        llm_usage=llm_usage,
        outputs={
            "string_output": "test result",
            "int_output": 42,
            "float_output": 3.14,
            "list_output": ["item1", "item2", "item3"],
            "dict_output": {"key1": "value1", "key2": 123},
            "nested_dict": {"level1": {"level2": ["nested", "list", 456]}},
        },
        node_run_steps=5,
        node_run_state=node_run_state,
    )


def test_basic_round_trip_serialization():
    """Test basic round-trip serialization ensures GraphRuntimeState values remain unchanged."""
    # Create a state with non-empty values
    original_state = create_test_graph_runtime_state()

    # Serialize to JSON and deserialize back
    json_data = original_state.model_dump_json()
    deserialized_state = GraphRuntimeState.model_validate_json(json_data)

    # Core test: ensure the round-trip preserves all values
    assert deserialized_state == original_state

    # Serialize to JSON and deserialize back
    dict_data = original_state.model_dump(mode="python")
    deserialized_state = GraphRuntimeState.model_validate(dict_data)
    assert deserialized_state == original_state

    # Serialize to JSON and deserialize back
    dict_data = original_state.model_dump(mode="json")
    deserialized_state = GraphRuntimeState.model_validate(dict_data)
    assert deserialized_state == original_state


def test_outputs_field_round_trip():
    """Test the problematic outputs field maintains values through round-trip serialization."""
    original_state = create_test_graph_runtime_state()

    # Serialize and deserialize
    json_data = original_state.model_dump_json()
    deserialized_state = GraphRuntimeState.model_validate_json(json_data)

    # Verify the outputs field specifically maintains its values
    assert deserialized_state.outputs == original_state.outputs
    assert deserialized_state == original_state


def test_empty_outputs_round_trip():
    """Test round-trip serialization with empty outputs field."""
    variable_pool = VariablePool.empty()
    original_state = GraphRuntimeState(
        variable_pool=variable_pool,
        start_at=time.perf_counter(),
        outputs={},  # Empty outputs
    )

    json_data = original_state.model_dump_json()
    deserialized_state = GraphRuntimeState.model_validate_json(json_data)

    assert deserialized_state == original_state


def test_llm_usage_round_trip():
    # Create LLM usage with specific decimal values
    llm_usage = LLMUsage(
        prompt_tokens=100,
        prompt_unit_price=Decimal("0.0015"),
        prompt_price_unit=Decimal(1000),
        prompt_price=Decimal("0.15"),
        completion_tokens=50,
        completion_unit_price=Decimal("0.003"),
        completion_price_unit=Decimal(1000),
        completion_price=Decimal("0.15"),
        total_tokens=150,
        total_price=Decimal("0.30"),
        currency="USD",
        latency=2.5,
    )

    json_data = llm_usage.model_dump_json()
    deserialized = LLMUsage.model_validate_json(json_data)
    assert deserialized == llm_usage

    dict_data = llm_usage.model_dump(mode="python")
    deserialized = LLMUsage.model_validate(dict_data)
    assert deserialized == llm_usage

    dict_data = llm_usage.model_dump(mode="json")
    deserialized = LLMUsage.model_validate(dict_data)
    assert deserialized == llm_usage
