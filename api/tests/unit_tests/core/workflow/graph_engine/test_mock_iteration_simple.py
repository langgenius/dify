"""
Simple test to verify MockNodeFactory works with iteration nodes.
"""

import sys
from pathlib import Path

# Add api directory to path
api_dir = Path(__file__).parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(api_dir))

from core.workflow.enums import NodeType
from tests.unit_tests.core.workflow.graph_engine.test_mock_config import MockConfigBuilder
from tests.unit_tests.core.workflow.graph_engine.test_mock_factory import MockNodeFactory


def test_mock_factory_registers_iteration_node():
    """Test that MockNodeFactory has iteration node registered."""

    # Create a MockNodeFactory instance
    factory = MockNodeFactory(graph_init_params=None, graph_runtime_state=None, mock_config=None)

    # Check that iteration node is registered
    assert NodeType.ITERATION in factory._mock_node_types
    print("✓ Iteration node is registered in MockNodeFactory")

    # Check that loop node is registered
    assert NodeType.LOOP in factory._mock_node_types
    print("✓ Loop node is registered in MockNodeFactory")

    # Check the class types
    from tests.unit_tests.core.workflow.graph_engine.test_mock_nodes import MockIterationNode, MockLoopNode

    assert factory._mock_node_types[NodeType.ITERATION] == MockIterationNode
    print("✓ Iteration node maps to MockIterationNode class")

    assert factory._mock_node_types[NodeType.LOOP] == MockLoopNode
    print("✓ Loop node maps to MockLoopNode class")


def test_mock_iteration_node_preserves_config():
    """Test that MockIterationNode preserves mock configuration."""

    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState, VariablePool
    from models.enums import UserFrom
    from tests.unit_tests.core.workflow.graph_engine.test_mock_nodes import MockIterationNode

    # Create mock config
    mock_config = MockConfigBuilder().with_llm_response("Test response").build()

    # Create minimal graph init params
    graph_init_params = GraphInitParams(
        tenant_id="test",
        app_id="test",
        workflow_id="test",
        graph_config={"nodes": [], "edges": []},
        user_id="test",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
        call_depth=0,
    )

    # Create minimal runtime state
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(environment_variables=[], conversation_variables=[], user_inputs={}),
        start_at=0,
        total_tokens=0,
        node_run_steps=0,
    )

    # Create mock iteration node
    node_config = {
        "id": "iter1",
        "data": {
            "type": "iteration",
            "title": "Test",
            "iterator_selector": ["start", "items"],
            "output_selector": ["node", "text"],
            "start_node_id": "node1",
        },
    }

    mock_node = MockIterationNode(
        id="iter1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        mock_config=mock_config,
    )

    # Verify the mock config is preserved
    assert mock_node.mock_config == mock_config
    print("✓ MockIterationNode preserves mock configuration")

    # Check that _create_graph_engine method exists and is overridden
    assert hasattr(mock_node, "_create_graph_engine")
    assert MockIterationNode._create_graph_engine != MockIterationNode.__bases__[1]._create_graph_engine
    print("✓ MockIterationNode overrides _create_graph_engine method")


def test_mock_loop_node_preserves_config():
    """Test that MockLoopNode preserves mock configuration."""

    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState, VariablePool
    from models.enums import UserFrom
    from tests.unit_tests.core.workflow.graph_engine.test_mock_nodes import MockLoopNode

    # Create mock config
    mock_config = MockConfigBuilder().with_http_response({"status": 200}).build()

    # Create minimal graph init params
    graph_init_params = GraphInitParams(
        tenant_id="test",
        app_id="test",
        workflow_id="test",
        graph_config={"nodes": [], "edges": []},
        user_id="test",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
        call_depth=0,
    )

    # Create minimal runtime state
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(environment_variables=[], conversation_variables=[], user_inputs={}),
        start_at=0,
        total_tokens=0,
        node_run_steps=0,
    )

    # Create mock loop node
    node_config = {
        "id": "loop1",
        "data": {
            "type": "loop",
            "title": "Test",
            "loop_count": 3,
            "start_node_id": "node1",
            "loop_variables": [],
            "outputs": {},
        },
    }

    mock_node = MockLoopNode(
        id="loop1",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        mock_config=mock_config,
    )

    # Verify the mock config is preserved
    assert mock_node.mock_config == mock_config
    print("✓ MockLoopNode preserves mock configuration")

    # Check that _create_graph_engine method exists and is overridden
    assert hasattr(mock_node, "_create_graph_engine")
    assert MockLoopNode._create_graph_engine != MockLoopNode.__bases__[1]._create_graph_engine
    print("✓ MockLoopNode overrides _create_graph_engine method")


if __name__ == "__main__":
    test_mock_factory_registers_iteration_node()
    test_mock_iteration_node_preserves_config()
    test_mock_loop_node_preserves_config()
    print("\n✅ All tests passed! MockNodeFactory now supports iteration and loop nodes.")
