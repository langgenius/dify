import time
import uuid
from unittest.mock import Mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.model_runtime.entities.llm_entities import LLMUsage
from core.variables import StringSegment
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.knowledge_retrieval.entities import (
    KnowledgeRetrievalNodeData,
    MultipleRetrievalConfig,
    RerankingModelConfig,
    SingleRetrievalConfig,
)
from core.workflow.nodes.knowledge_retrieval.exc import RateLimitExceededError
from core.workflow.nodes.knowledge_retrieval.knowledge_retrieval_node import KnowledgeRetrievalNode
from core.workflow.repositories.rag_retrieval_protocol import RAGRetrievalProtocol, Source
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom


@pytest.fixture
def mock_graph_init_params():
    """Create mock GraphInitParams."""
    return GraphInitParams(
        tenant_id=str(uuid.uuid4()),
        app_id=str(uuid.uuid4()),
        workflow_id=str(uuid.uuid4()),
        graph_config={},
        user_id=str(uuid.uuid4()),
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )


@pytest.fixture
def mock_graph_runtime_state():
    """Create mock GraphRuntimeState."""
    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id=str(uuid.uuid4()), files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    return GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())


@pytest.fixture
def mock_rag_retrieval():
    """Create mock RAGRetrievalProtocol."""
    mock_retrieval = Mock(spec=RAGRetrievalProtocol)
    mock_retrieval.knowledge_retrieval.return_value = []
    mock_retrieval.llm_usage = LLMUsage.empty_usage()
    return mock_retrieval


@pytest.fixture
def sample_node_data():
    """Create sample KnowledgeRetrievalNodeData."""
    return KnowledgeRetrievalNodeData(
        title="Knowledge Retrieval",
        type="knowledge-retrieval",
        dataset_ids=[str(uuid.uuid4())],
        retrieval_mode="multiple",
        multiple_retrieval_config=MultipleRetrievalConfig(
            top_k=5,
            score_threshold=0.7,
            reranking_mode="reranking_model",
            reranking_enable=True,
            reranking_model=RerankingModelConfig(
                provider="cohere",
                model="rerank-v2",
            ),
        ),
    )


class TestKnowledgeRetrievalNode:
    """
    Test suite for KnowledgeRetrievalNode.
    """

    def test_node_initialization(self, mock_graph_init_params, mock_graph_runtime_state, mock_rag_retrieval):
        """Test KnowledgeRetrievalNode initialization."""
        # Arrange
        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": {
                "title": "Knowledge Retrieval",
                "type": "knowledge-retrieval",
                "dataset_ids": [str(uuid.uuid4())],
                "retrieval_mode": "multiple",
            },
        }

        # Act
        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
            rag_retrieval=mock_rag_retrieval,
        )

        # Assert
        assert node.id == node_id
        assert node._rag_retrieval == mock_rag_retrieval
        assert node._llm_file_saver is not None

    def test_run_with_no_query_or_attachment(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
        sample_node_data,
    ):
        """Test _run returns success when no query or attachment is provided."""
        # Arrange
        sample_node_data.query_variable_selector = None
        sample_node_data.query_attachment_selector = None

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
            rag_retrieval=mock_rag_retrieval,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs == {}
        assert mock_rag_retrieval.knowledge_retrieval.call_count == 0

    def test_run_with_query_variable_single_mode(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
    ):
        """Test _run with query variable in single mode."""
        # Arrange
        from core.workflow.nodes.llm.entities import ModelConfig

        query = "What is Python?"
        query_selector = ["start", "query"]

        # Add query to variable pool
        mock_graph_runtime_state.variable_pool.add(query_selector, StringSegment(value=query))

        node_data = KnowledgeRetrievalNodeData(
            title="Knowledge Retrieval",
            type="knowledge-retrieval",
            dataset_ids=[str(uuid.uuid4())],
            retrieval_mode="single",
            query_variable_selector=query_selector,
            single_retrieval_config=SingleRetrievalConfig(
                model=ModelConfig(
                    provider="openai",
                    name="gpt-4",
                    mode="chat",
                    completion_params={"temperature": 0.7},
                )
            ),
        )

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": node_data.model_dump(),
        }

        # Mock retrieval response
        mock_source = Mock(spec=Source)
        mock_source.model_dump.return_value = {"content": "Python is a programming language"}
        mock_rag_retrieval.knowledge_retrieval.return_value = [mock_source]
        mock_rag_retrieval.llm_usage = LLMUsage.empty_usage()

        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
            rag_retrieval=mock_rag_retrieval,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "result" in result.outputs
        assert mock_rag_retrieval.knowledge_retrieval.called

    def test_run_with_query_variable_multiple_mode(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
        sample_node_data,
    ):
        """Test _run with query variable in multiple mode."""
        # Arrange
        query = "What is Python?"
        query_selector = ["start", "query"]

        # Add query to variable pool
        mock_graph_runtime_state.variable_pool.add(query_selector, StringSegment(value=query))
        sample_node_data.query_variable_selector = query_selector

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        # Mock retrieval response
        mock_source = Mock(spec=Source)
        mock_source.model_dump.return_value = {"content": "Python is a programming language"}
        mock_rag_retrieval.knowledge_retrieval.return_value = [mock_source]
        mock_rag_retrieval.llm_usage = LLMUsage.empty_usage()

        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
            rag_retrieval=mock_rag_retrieval,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "result" in result.outputs
        assert mock_rag_retrieval.knowledge_retrieval.called

    def test_run_with_invalid_query_variable_type(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
        sample_node_data,
    ):
        """Test _run fails when query variable is not StringSegment."""
        # Arrange
        query_selector = ["start", "query"]

        # Add non-string variable to variable pool
        mock_graph_runtime_state.variable_pool.add(query_selector, [1, 2, 3])
        sample_node_data.query_variable_selector = query_selector

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
            rag_retrieval=mock_rag_retrieval,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Query variable is not string type" in result.error

    def test_run_with_invalid_attachment_variable_type(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
        sample_node_data,
    ):
        """Test _run fails when attachment variable is not FileSegment or ArrayFileSegment."""
        # Arrange
        attachment_selector = ["start", "attachments"]

        # Add non-file variable to variable pool
        mock_graph_runtime_state.variable_pool.add(attachment_selector, "not a file")
        sample_node_data.query_attachment_selector = attachment_selector

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
            rag_retrieval=mock_rag_retrieval,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Attachments variable is not array file or file type" in result.error

    def test_run_with_rate_limit_exceeded(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
        sample_node_data,
    ):
        """Test _run handles RateLimitExceededError properly."""
        # Arrange
        query = "What is Python?"
        query_selector = ["start", "query"]

        mock_graph_runtime_state.variable_pool.add(query_selector, StringSegment(value=query))
        sample_node_data.query_variable_selector = query_selector

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        # Mock retrieval to raise RateLimitExceededError
        mock_rag_retrieval.knowledge_retrieval.side_effect = RateLimitExceededError(
            "knowledge base request rate limit exceeded"
        )
        mock_rag_retrieval.llm_usage = LLMUsage.empty_usage()

        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
            rag_retrieval=mock_rag_retrieval,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "rate limit" in result.error.lower()

    def test_run_with_generic_exception(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
        sample_node_data,
    ):
        """Test _run handles generic exceptions properly."""
        # Arrange
        query = "What is Python?"
        query_selector = ["start", "query"]

        mock_graph_runtime_state.variable_pool.add(query_selector, StringSegment(value=query))
        sample_node_data.query_variable_selector = query_selector

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        # Mock retrieval to raise generic exception
        mock_rag_retrieval.knowledge_retrieval.side_effect = Exception("Unexpected error")
        mock_rag_retrieval.llm_usage = LLMUsage.empty_usage()

        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
            rag_retrieval=mock_rag_retrieval,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Unexpected error" in result.error

    def test_extract_variable_selector_to_variable_mapping(self):
        """Test _extract_variable_selector_to_variable_mapping class method."""
        # Arrange
        node_id = "knowledge_node_1"
        node_data = {
            "type": "knowledge-retrieval",
            "title": "Knowledge Retrieval",
            "dataset_ids": [str(uuid.uuid4())],
            "retrieval_mode": "multiple",
            "query_variable_selector": ["start", "query"],
            "query_attachment_selector": ["start", "attachments"],
        }
        graph_config = {}

        # Act
        mapping = KnowledgeRetrievalNode._extract_variable_selector_to_variable_mapping(
            graph_config=graph_config,
            node_id=node_id,
            node_data=node_data,
        )

        # Assert
        assert mapping[f"{node_id}.query"] == ["start", "query"]
        assert mapping[f"{node_id}.queryAttachment"] == ["start", "attachments"]


class TestFetchDatasetRetriever:
    """
    Test suite for _fetch_dataset_retriever method.
    """

    def test_fetch_dataset_retriever_single_mode(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
    ):
        """Test _fetch_dataset_retriever in single mode."""
        # Arrange
        from core.workflow.nodes.llm.entities import ModelConfig

        query = "What is Python?"
        variables = {"query": query}

        node_data = KnowledgeRetrievalNodeData(
            title="Knowledge Retrieval",
            type="knowledge-retrieval",
            dataset_ids=[str(uuid.uuid4())],
            retrieval_mode="single",
            single_retrieval_config=SingleRetrievalConfig(
                model=ModelConfig(
                    provider="openai",
                    name="gpt-4",
                    mode="chat",
                    completion_params={"temperature": 0.7},
                )
            ),
        )

        # Mock retrieval response
        mock_source = Mock(spec=Source)
        mock_rag_retrieval.knowledge_retrieval.return_value = [mock_source]
        mock_rag_retrieval.llm_usage = LLMUsage.empty_usage()

        node_id = str(uuid.uuid4())
        config = {"id": node_id, "data": node_data.model_dump()}

        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
            rag_retrieval=mock_rag_retrieval,
        )

        # Act
        results, usage = node._fetch_dataset_retriever(node_data=node_data, variables=variables)

        # Assert
        assert len(results) == 1
        assert isinstance(usage, LLMUsage)
        assert mock_rag_retrieval.knowledge_retrieval.called

    def test_fetch_dataset_retriever_multiple_mode_with_reranking(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
        sample_node_data,
    ):
        """Test _fetch_dataset_retriever in multiple mode with reranking."""
        # Arrange
        query = "What is Python?"
        variables = {"query": query}

        # Mock retrieval response
        mock_rag_retrieval.knowledge_retrieval.return_value = []
        mock_rag_retrieval.llm_usage = LLMUsage.empty_usage()

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
            rag_retrieval=mock_rag_retrieval,
        )

        # Act
        results, usage = node._fetch_dataset_retriever(node_data=sample_node_data, variables=variables)

        # Assert
        assert isinstance(results, list)
        assert isinstance(usage, LLMUsage)
        assert mock_rag_retrieval.knowledge_retrieval.called

        # Verify reranking parameters via request object
        call_args = mock_rag_retrieval.knowledge_retrieval.call_args
        request = call_args[1]["request"]
        assert request.reranking_enable is True
        assert request.reranking_mode == "reranking_model"

    def test_fetch_dataset_retriever_multiple_mode_without_reranking(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
    ):
        """Test _fetch_dataset_retriever in multiple mode without reranking."""
        # Arrange
        query = "What is Python?"
        variables = {"query": query}

        node_data = KnowledgeRetrievalNodeData(
            title="Knowledge Retrieval",
            type="knowledge-retrieval",
            dataset_ids=[str(uuid.uuid4())],
            retrieval_mode="multiple",
            multiple_retrieval_config=MultipleRetrievalConfig(
                top_k=5,
                score_threshold=0.7,
                reranking_enable=False,
                reranking_mode="reranking_model",
            ),
        )

        # Mock retrieval response
        mock_rag_retrieval.knowledge_retrieval.return_value = []
        mock_rag_retrieval.llm_usage = LLMUsage.empty_usage()

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": node_data.model_dump(),
        }

        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
            rag_retrieval=mock_rag_retrieval,
        )

        # Act
        results, usage = node._fetch_dataset_retriever(node_data=node_data, variables=variables)

        # Assert
        assert isinstance(results, list)
        assert mock_rag_retrieval.knowledge_retrieval.called

        # Verify reranking is disabled
        call_args = mock_rag_retrieval.knowledge_retrieval.call_args
        request = call_args[1]["request"]
        assert request.reranking_enable is False

    def test_version_method(self):
        """Test version class method."""
        # Act
        version = KnowledgeRetrievalNode.version()

        # Assert
        assert version == "1"
