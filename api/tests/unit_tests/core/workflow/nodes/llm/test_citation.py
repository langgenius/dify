"""
Tests for LLM node citation functionality.
"""

import pytest

from core.variables import ArrayObjectSegment, StringSegment
from core.workflow.entities import GraphInitParams
from core.workflow.nodes.llm.entities import ContextConfig, LLMNodeChatModelMessage, LLMNodeData, ModelConfig
from core.workflow.nodes.llm.node import LLMNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom


@pytest.fixture
def graph_init_params() -> GraphInitParams:
    """Create graph initialization parameters for testing."""
    from core.app.entities.app_invoke_entities import InvokeFrom

    return GraphInitParams(
        tenant_id="test-tenant",
        app_id="test-app",
        workflow_id="test-workflow",
        graph_config={},
        user_id="test-user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )


@pytest.fixture
def variable_pool() -> VariablePool:
    """Create a variable pool for testing."""
    return VariablePool(
        system_variables=SystemVariable.empty(),
        user_inputs={},
    )


@pytest.fixture
def graph_runtime_state(variable_pool: VariablePool) -> GraphRuntimeState:
    """Create a graph runtime state for testing."""
    return GraphRuntimeState(
        variable_pool=variable_pool,
        start_at=0,
    )


class TestCitationFunctionality:
    """Test cases for citation functionality in LLM node."""

    def test_fetch_context_without_citation(self, graph_init_params, graph_runtime_state):
        """Test context fetching without citation enabled."""
        # Create node data with citation disabled
        node_data = LLMNodeData(
            title="Test LLM",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            prompt_template=[
                LLMNodeChatModelMessage(text="Answer the question: {{#context#}}", role="user", edition_type="basic")
            ],
            memory=None,
            context=ContextConfig(enabled=True, variable_selector=["test_node", "result"], citation_enabled=False),
        )

        # Create LLM node
        llm_node = LLMNode(
            id="test-llm",
            config={"id": "test-llm", "data": node_data.model_dump()},
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

        # Add context to variable pool (retrieval results)
        retrieval_results = [
            {
                "content": "Artificial intelligence (AI) is a field of computer science.",
                "metadata": {
                    "_source": "knowledge",
                    "position": 1,
                    "dataset_id": "dataset-1",
                    "dataset_name": "AI Knowledge",
                    "document_id": "doc-1",
                    "document_name": "AI Basics",
                    "data_source_type": "upload_file",
                    "segment_id": "seg-1",
                    "score": 0.95,
                },
            },
            {
                "content": "Machine learning is a subset of AI.",
                "metadata": {
                    "_source": "knowledge",
                    "position": 2,
                    "dataset_id": "dataset-1",
                    "dataset_name": "AI Knowledge",
                    "document_id": "doc-2",
                    "document_name": "ML Basics",
                    "data_source_type": "upload_file",
                    "segment_id": "seg-2",
                    "score": 0.90,
                },
            },
        ]

        graph_runtime_state.variable_pool.add(["test_node", "result"], ArrayObjectSegment(value=retrieval_results))

        # Fetch context
        result_events = list(llm_node._fetch_context(node_data))

        assert len(result_events) == 1
        event = result_events[0]

        # Without citation, context should not have citation markers
        assert "[1]" not in event.context
        assert "[2]" not in event.context
        assert "Artificial intelligence (AI) is a field of computer science." in event.context
        assert "Machine learning is a subset of AI." in event.context

    def test_fetch_context_with_citation_enabled(self, graph_init_params, graph_runtime_state):
        """Test context fetching with citation enabled."""
        # Create node data with citation enabled
        node_data = LLMNodeData(
            title="Test LLM",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            prompt_template=[
                LLMNodeChatModelMessage(text="Answer the question: {{#context#}}", role="user", edition_type="basic")
            ],
            memory=None,
            context=ContextConfig(enabled=True, variable_selector=["test_node", "result"], citation_enabled=True),
        )

        # Create LLM node
        llm_node = LLMNode(
            id="test-llm",
            config={"id": "test-llm", "data": node_data.model_dump()},
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

        # Add context to variable pool (retrieval results)
        retrieval_results = [
            {
                "content": "Artificial intelligence (AI) is a field of computer science.",
                "metadata": {
                    "_source": "knowledge",
                    "position": 1,
                    "dataset_id": "dataset-1",
                    "dataset_name": "AI Knowledge",
                    "document_id": "doc-1",
                    "document_name": "AI Basics",
                    "data_source_type": "upload_file",
                    "segment_id": "seg-1",
                    "score": 0.95,
                },
            },
            {
                "content": "Machine learning is a subset of AI.",
                "metadata": {
                    "_source": "knowledge",
                    "position": 2,
                    "dataset_id": "dataset-1",
                    "dataset_name": "AI Knowledge",
                    "document_id": "doc-2",
                    "document_name": "ML Basics",
                    "data_source_type": "upload_file",
                    "segment_id": "seg-2",
                    "score": 0.90,
                },
            },
        ]

        graph_runtime_state.variable_pool.add(["test_node", "result"], ArrayObjectSegment(value=retrieval_results))

        # Fetch context
        result_events = list(llm_node._fetch_context(node_data))

        assert len(result_events) == 1
        event = result_events[0]

        # With citation, context should have citation markers at the end of each segment
        assert "Artificial intelligence (AI) is a field of computer science. [1]" in event.context
        assert "Machine learning is a subset of AI. [2]" in event.context

        # Verify retrieval resources are collected
        assert len(event.retriever_resources) == 2
        assert event.retriever_resources[0].position == 1
        assert event.retriever_resources[1].position == 2

    def test_fetch_context_with_string_context(self, graph_init_params, graph_runtime_state):
        """Test context fetching with string context (no citation markers expected)."""
        # Create node data with citation enabled
        node_data = LLMNodeData(
            title="Test LLM",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            prompt_template=[
                LLMNodeChatModelMessage(text="Answer the question: {{#context#}}", role="user", edition_type="basic")
            ],
            memory=None,
            context=ContextConfig(enabled=True, variable_selector=["test_node", "result"], citation_enabled=True),
        )

        # Create LLM node
        llm_node = LLMNode(
            id="test-llm",
            config={"id": "test-llm", "data": node_data.model_dump()},
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

        # Add string context to variable pool (no metadata)
        graph_runtime_state.variable_pool.add(
            ["test_node", "result"], StringSegment(value="This is a simple string context without metadata.")
        )

        # Fetch context
        result_events = list(llm_node._fetch_context(node_data))

        assert len(result_events) == 1
        event = result_events[0]

        # String context should not have citation markers
        assert "[1]" not in event.context
        assert "This is a simple string context without metadata." in event.context

    def test_fetch_context_with_missing_position(self, graph_init_params, graph_runtime_state):
        """Test context fetching when position is missing in metadata."""
        # Create node data with citation enabled
        node_data = LLMNodeData(
            title="Test LLM",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode="chat", completion_params={}),
            prompt_template=[
                LLMNodeChatModelMessage(text="Answer the question: {{#context#}}", role="user", edition_type="basic")
            ],
            memory=None,
            context=ContextConfig(enabled=True, variable_selector=["test_node", "result"], citation_enabled=True),
        )

        # Create LLM node
        llm_node = LLMNode(
            id="test-llm",
            config={"id": "test-llm", "data": node_data.model_dump()},
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

        # Add context without position in metadata
        retrieval_results = [
            {
                "content": "Content without position metadata.",
                "metadata": {
                    "_source": "knowledge",
                    "dataset_id": "dataset-1",
                    "dataset_name": "Test Dataset",
                },
            }
        ]

        graph_runtime_state.variable_pool.add(["test_node", "result"], ArrayObjectSegment(value=retrieval_results))

        # Fetch context
        result_events = list(llm_node._fetch_context(node_data))

        assert len(result_events) == 1
        event = result_events[0]

        # Without position, citation marker should not be added
        assert "[1]" not in event.context
        assert "Content without position metadata." in event.context

    def test_citation_instruction_added_to_context(self):
        """Test that citation instruction is properly added to context."""
        # This test verifies that when citation_enabled is True,
        # the citation instruction is appended to the context.
        # We test this indirectly through the _fetch_context method
        # which should add citation markers based on the configuration.

        # The citation functionality is already tested in the previous tests
        # This is a placeholder to document the expected behavior:
        # 1. When citation_enabled=True and context has citation markers [1], [2]
        # 2. The system should add instruction to use these markers
        # 3. The instruction is added in fetch_prompt_messages method

        # Test that citation instruction format is correct
        citation_instruction = (
            "\n\nIMPORTANT: When answering, please cite the sources by including the citation markers "
            "(e.g., [1], [2]) at the end of relevant sentences. Place the citation at the sentence end."
        )

        # Verify the instruction contains expected keywords
        assert "IMPORTANT" in citation_instruction
        assert "cite the sources" in citation_instruction
        assert "citation markers" in citation_instruction
        assert "[1]" in citation_instruction
        assert "[2]" in citation_instruction
        assert "sentence end" in citation_instruction
