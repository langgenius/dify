"""Tests for ErrorHandler fallback model strategy."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest

from core.workflow.enums import (
    ErrorStrategy,
    NodeType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.graph import Graph
from core.workflow.graph_engine.domain.graph_execution import GraphExecution
from core.workflow.graph_engine.error_handler import ErrorHandler
from core.workflow.graph_events import NodeRunFailedEvent, NodeRunRetryEvent
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.entities import RetryConfig
from core.workflow.nodes.llm.entities import ContextConfig, LLMNodeData, ModelConfig
from core.workflow.runtime import GraphRuntimeState, VariablePool


class MockLLMNode:
    """Mock LLM node for testing."""

    def __init__(
        self,
        node_id: str,
        node_type: NodeType = NodeType.LLM,
        error_strategy: ErrorStrategy | None = None,
        fallback_models: list[ModelConfig] | None = None,
    ):
        self._node_id = node_id
        self.node_type = node_type
        self.title = f"LLM Node {node_id}"
        self.error_strategy = error_strategy
        self.retry = False
        self.retry_config = RetryConfig()

        # Create node_data with fallback_models
        node_data = LLMNodeData(
            title=self.title,
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            prompt_template=[],
            context=ContextConfig(enabled=False),
            fallback_models=fallback_models,
        )
        self.node_data = node_data

    @property
    def id(self) -> str:
        return self._node_id


@pytest.fixture
def graph_execution() -> GraphExecution:
    """Create a mock GraphExecution."""
    return GraphExecution(workflow_id="test-workflow")


@pytest.fixture
def variable_pool() -> VariablePool:
    """Create a variable pool for testing."""
    return VariablePool()


@pytest.fixture
def graph_runtime_state(variable_pool: VariablePool) -> GraphRuntimeState:
    """Create a GraphRuntimeState for testing."""
    return GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)


@pytest.fixture
def fallback_models() -> list[ModelConfig]:
    """Create fallback models for testing."""
    return [
        ModelConfig(provider="openai", name="gpt-4", mode="chat", completion_params={}),
        ModelConfig(provider="anthropic", name="claude-3", mode="chat", completion_params={}),
    ]


@pytest.fixture
def llm_node_with_fallback(fallback_models: list[ModelConfig]) -> MockLLMNode:
    """Create an LLM node with fallback models configured."""
    return MockLLMNode(
        node_id="llm-node-1",
        error_strategy=ErrorStrategy.FALLBACK_MODEL,
        fallback_models=fallback_models,
    )


@pytest.fixture
def graph(llm_node_with_fallback: MockLLMNode) -> Graph:
    """Create a Graph with an LLM node."""
    return Graph(
        nodes={"llm-node-1": llm_node_with_fallback},
        edges={},
        in_edges={},
        out_edges={},
        root_node=llm_node_with_fallback,
    )


@pytest.fixture
def error_handler(
    graph: Graph, graph_execution: GraphExecution, graph_runtime_state: GraphRuntimeState
) -> ErrorHandler:
    """Create an ErrorHandler instance for testing."""
    return ErrorHandler(
        graph=graph,
        graph_execution=graph_execution,
        graph_runtime_state=graph_runtime_state,
    )


def create_failed_event(
    node_id: str,
    error: str = "Model invocation failed",
    metadata: dict[WorkflowNodeExecutionMetadataKey, Any] | None = None,
) -> NodeRunFailedEvent:
    """Create a NodeRunFailedEvent for testing."""
    node_run_result = NodeRunResult(
        status=WorkflowNodeExecutionStatus.FAILED,
        error=error,
        error_type="ModelInvokeError",
        metadata=metadata or {},
    )

    return NodeRunFailedEvent(
        id="exec-1",
        node_id=node_id,
        node_type=NodeType.LLM,
        node_title="Test LLM Node",
        node_run_result=node_run_result,
        error=error,
        start_at=datetime.now(),
    )


class TestFallbackModelStrategy:
    """Test cases for fallback model error strategy."""

    def test_fallback_model_strategy_returns_retry_event(
        self,
        error_handler: ErrorHandler,
        graph_runtime_state: GraphRuntimeState,
        fallback_models: list[ModelConfig],
    ):
        """Test that fallback model strategy returns NodeRunRetryEvent with correct index."""
        event = create_failed_event("llm-node-1")

        result = error_handler.handle_node_failure(event)

        assert result is not None
        assert isinstance(result, NodeRunRetryEvent)
        assert result.node_id == "llm-node-1"
        assert result.retry_index == 0
        assert result.error == "Model invocation failed"

        # Verify metadata contains fallback model index
        assert WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX in result.node_run_result.metadata
        assert result.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX] == 0
        assert (
            result.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY]
            == ErrorStrategy.FALLBACK_MODEL
        )

        # Verify variable pool contains fallback model index
        fallback_index_var = graph_runtime_state.variable_pool.get(("llm-node-1", "_fallback_model_index"))
        assert fallback_index_var is not None
        assert fallback_index_var.text == "0"

    def test_fallback_model_strategy_no_fallback_models_aborts(
        self,
        graph_execution: GraphExecution,
        graph_runtime_state: GraphRuntimeState,
    ):
        """Test that fallback model strategy aborts when no fallback_models configured."""
        # Create LLM node without fallback_models
        llm_node = MockLLMNode(
            node_id="llm-node-1",
            error_strategy=ErrorStrategy.FALLBACK_MODEL,
            fallback_models=None,
        )
        graph = Graph(
            nodes={"llm-node-1": llm_node},
            edges={},
            in_edges={},
            out_edges={},
            root_node=llm_node,
        )
        error_handler = ErrorHandler(
            graph=graph,
            graph_execution=graph_execution,
            graph_runtime_state=graph_runtime_state,
        )

        event = create_failed_event("llm-node-1")
        result = error_handler.handle_node_failure(event)

        assert result is None

    def test_fallback_model_strategy_empty_fallback_models_aborts(
        self,
        graph_execution: GraphExecution,
        graph_runtime_state: GraphRuntimeState,
    ):
        """Test that fallback model strategy aborts when fallback_models is empty."""
        # Create LLM node with empty fallback_models
        llm_node = MockLLMNode(
            node_id="llm-node-1",
            error_strategy=ErrorStrategy.FALLBACK_MODEL,
            fallback_models=[],
        )
        graph = Graph(
            nodes={"llm-node-1": llm_node},
            edges={},
            in_edges={},
            out_edges={},
            root_node=llm_node,
        )
        error_handler = ErrorHandler(
            graph=graph,
            graph_execution=graph_execution,
            graph_runtime_state=graph_runtime_state,
        )

        event = create_failed_event("llm-node-1")
        result = error_handler.handle_node_failure(event)

        assert result is None

    def test_fallback_model_strategy_tracks_index_from_metadata(
        self,
        error_handler: ErrorHandler,
        graph_runtime_state: GraphRuntimeState,
        fallback_models: list[ModelConfig],
    ):
        """Test that fallback model strategy tracks index from metadata."""
        # First failure with primary model (index -1)
        event1 = create_failed_event(
            "llm-node-1",
            metadata={WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX: -1},
        )
        result1 = error_handler.handle_node_failure(event1)

        assert result1 is not None
        assert isinstance(result1, NodeRunRetryEvent)
        assert result1.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX] == 0

        # Second failure with first fallback model (index 0)
        event2 = create_failed_event(
            "llm-node-1",
            metadata={WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX: 0},
        )
        result2 = error_handler.handle_node_failure(event2)

        assert result2 is not None
        assert isinstance(result2, NodeRunRetryEvent)
        assert result2.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX] == 1

    def test_fallback_model_strategy_tracks_index_from_variable_pool(
        self,
        error_handler: ErrorHandler,
        graph_runtime_state: GraphRuntimeState,
        fallback_models: list[ModelConfig],
    ):
        """Test that fallback model strategy tracks index from variable pool."""
        # Set fallback model index in variable pool
        graph_runtime_state.variable_pool.add(("llm-node-1", "_fallback_model_index"), "0")

        event = create_failed_event("llm-node-1")
        result = error_handler.handle_node_failure(event)

        assert result is not None
        assert isinstance(result, NodeRunRetryEvent)
        # Should use index 1 (next after 0)
        assert result.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX] == 1

    def test_fallback_model_strategy_uses_max_index(
        self,
        error_handler: ErrorHandler,
        graph_runtime_state: GraphRuntimeState,
        fallback_models: list[ModelConfig],
    ):
        """Test that fallback model strategy uses the maximum index from metadata and variable pool."""
        # Set index in variable pool
        graph_runtime_state.variable_pool.add(("llm-node-1", "_fallback_model_index"), "1")

        # Event has lower index in metadata
        event = create_failed_event(
            "llm-node-1",
            metadata={WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX: 0},
        )
        result = error_handler.handle_node_failure(event)

        assert result is not None
        assert isinstance(result, NodeRunRetryEvent)
        # Should use max(0, 1) + 1 = 2
        assert result.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX] == 2

    def test_fallback_model_strategy_exhausts_all_models(
        self,
        error_handler: ErrorHandler,
        graph_runtime_state: GraphRuntimeState,
        fallback_models: list[ModelConfig],
    ):
        """Test that fallback model strategy aborts when all models are exhausted."""
        # Simulate that we've tried all models (primary + 2 fallback models = 3 total)
        # Last tried index is 1 (second fallback model)
        event = create_failed_event(
            "llm-node-1",
            metadata={WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX: 1},
        )
        result = error_handler.handle_node_failure(event)

        # Should abort because next index (2) >= len(fallback_models) (2)
        assert result is None

        # Verify variable pool is cleared
        fallback_index_var = graph_runtime_state.variable_pool.get(("llm-node-1", "_fallback_model_index"))
        assert fallback_index_var is None

    def test_fallback_model_strategy_multiple_fallback_models(
        self,
        graph_execution: GraphExecution,
        graph_runtime_state: GraphRuntimeState,
    ):
        """Test that fallback model strategy works with multiple fallback models."""
        # Create 3 fallback models
        fallback_models = [
            ModelConfig(provider="openai", name="gpt-4", mode="chat", completion_params={}),
            ModelConfig(provider="anthropic", name="claude-3", mode="chat", completion_params={}),
            ModelConfig(provider="google", name="gemini-pro", mode="chat", completion_params={}),
        ]

        llm_node = MockLLMNode(
            node_id="llm-node-1",
            error_strategy=ErrorStrategy.FALLBACK_MODEL,
            fallback_models=fallback_models,
        )
        graph = Graph(
            nodes={"llm-node-1": llm_node},
            edges={},
            in_edges={},
            out_edges={},
            root_node=llm_node,
        )
        error_handler = ErrorHandler(
            graph=graph,
            graph_execution=graph_execution,
            graph_runtime_state=graph_runtime_state,
        )

        # First failure - should try first fallback (index 0)
        event1 = create_failed_event("llm-node-1")
        result1 = error_handler.handle_node_failure(event1)
        assert result1 is not None
        assert result1.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX] == 0

        # Second failure - should try second fallback (index 1)
        event2 = create_failed_event(
            "llm-node-1",
            metadata={WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX: 0},
        )
        result2 = error_handler.handle_node_failure(event2)
        assert result2 is not None
        assert result2.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX] == 1

        # Third failure - should try third fallback (index 2)
        event3 = create_failed_event(
            "llm-node-1",
            metadata={WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX: 1},
        )
        result3 = error_handler.handle_node_failure(event3)
        assert result3 is not None
        assert result3.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX] == 2

        # Fourth failure - should abort (all models exhausted)
        event4 = create_failed_event(
            "llm-node-1",
            metadata={WorkflowNodeExecutionMetadataKey.FALLBACK_MODEL_INDEX: 2},
        )
        result4 = error_handler.handle_node_failure(event4)
        assert result4 is None
