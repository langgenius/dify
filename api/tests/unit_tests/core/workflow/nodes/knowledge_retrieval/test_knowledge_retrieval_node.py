import time
import uuid
from unittest.mock import Mock

import pytest
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variables import ArrayStringSegment, StringSegment

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.nodes.knowledge_retrieval.entities import (
    Condition,
    KnowledgeRetrievalNodeData,
    MetadataFilteringCondition,
    MultipleRetrievalConfig,
    RerankingModelConfig,
    SingleRetrievalConfig,
)
from core.workflow.nodes.knowledge_retrieval.exc import RateLimitExceededError
from core.workflow.nodes.knowledge_retrieval.knowledge_retrieval_node import KnowledgeRetrievalNode
from core.workflow.nodes.knowledge_retrieval.retrieval import RAGRetrievalProtocol, Source
from core.workflow.system_variables import build_system_variables
from tests.workflow_test_utils import build_test_graph_init_params


@pytest.fixture
def mock_graph_init_params():
    """Create mock GraphInitParams."""
    return build_test_graph_init_params(
        workflow_id=str(uuid.uuid4()),
        graph_config={},
        tenant_id=str(uuid.uuid4()),
        app_id=str(uuid.uuid4()),
        user_id=str(uuid.uuid4()),
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )


@pytest.fixture
def mock_graph_runtime_state():
    """Create mock GraphRuntimeState."""
    variable_pool = VariablePool(
        system_variables=build_system_variables(user_id=str(uuid.uuid4()), files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    return GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())


@pytest.fixture
def mock_rag_retrieval(mocker):
    """Create mock RAGRetrievalProtocol."""
    mock_retrieval = Mock(spec=RAGRetrievalProtocol)
    mock_retrieval.knowledge_retrieval.return_value = []
    mock_retrieval.llm_usage = LLMUsage.empty_usage()
    mocker.patch(
        "core.workflow.nodes.knowledge_retrieval.knowledge_retrieval_node.DatasetRetrieval",
        return_value=mock_retrieval,
    )
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
        )

        # Assert
        assert node.id == node_id
        assert node._rag_retrieval == mock_rag_retrieval

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
        from graphon.nodes.llm.entities import ModelConfig

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
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "result" in result.outputs
        assert mock_rag_retrieval.knowledge_retrieval.called
        mock_source.model_dump.assert_called_once_with(by_alias=True)

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
        node_data = KnowledgeRetrievalNodeData(
            type="knowledge-retrieval",
            title="Knowledge Retrieval",
            dataset_ids=[str(uuid.uuid4())],
            retrieval_mode="multiple",
            query_variable_selector=["start", "query"],
            query_attachment_selector=["start", "attachments"],
        )
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

    def test_extract_variable_selector_includes_dataset_id_variable(self):
        """Variable mapping should include dataset_id_variable_selector when set."""
        # Arrange
        node_id = "knowledge_node_1"
        node_data = KnowledgeRetrievalNodeData(
            type="knowledge-retrieval",
            title="Knowledge Retrieval",
            dataset_ids=[],
            retrieval_mode="multiple",
            query_variable_selector=["start", "query"],
            dataset_id_variable_selector=["code_node", "dataset_id"],
        )

        # Act
        mapping = KnowledgeRetrievalNode._extract_variable_selector_to_variable_mapping(
            graph_config={},
            node_id=node_id,
            node_data=node_data,
        )

        # Assert
        assert mapping[f"{node_id}.datasetIds"] == ["code_node", "dataset_id"]


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
        from graphon.nodes.llm.entities import ModelConfig

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

    def test_resolve_metadata_filtering_conditions_templates(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
    ):
        """_resolve_metadata_filtering_conditions should expand {{#...#}} and keep numbers/None unchanged."""
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
        # Variable in pool used by template
        mock_graph_runtime_state.variable_pool.add(["start", "query"], StringSegment(value="readme"))

        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        conditions = MetadataFilteringCondition(
            logical_operator="and",
            conditions=[
                Condition(name="document_name", comparison_operator="is", value="{{#start.query#}}"),
                Condition(name="tags", comparison_operator="in", value=["x", "{{#start.query#}}"]),
                Condition(name="year", comparison_operator="=", value=2025),
            ],
        )

        # Act
        resolved = node._resolve_metadata_filtering_conditions(conditions)

        # Assert
        assert resolved.logical_operator == "and"
        assert resolved.conditions[0].value == "readme"
        assert isinstance(resolved.conditions[1].value, list)
        assert resolved.conditions[1].value[1] == "readme"
        assert resolved.conditions[2].value == 2025

    def test_fetch_passes_resolved_metadata_conditions(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
    ):
        """_fetch_dataset_retriever should pass resolved metadata conditions into request."""
        # Arrange
        query = "hi"
        variables = {"query": query}
        mock_graph_runtime_state.variable_pool.add(["start", "q"], StringSegment(value="readme"))

        node_data = KnowledgeRetrievalNodeData(
            title="Knowledge Retrieval",
            type="knowledge-retrieval",
            dataset_ids=[str(uuid.uuid4())],
            retrieval_mode="multiple",
            multiple_retrieval_config=MultipleRetrievalConfig(
                top_k=4,
                score_threshold=0.0,
                reranking_mode="reranking_model",
                reranking_enable=True,
                reranking_model=RerankingModelConfig(provider="cohere", model="rerank-v2"),
            ),
            metadata_filtering_mode="manual",
            metadata_filtering_conditions=MetadataFilteringCondition(
                logical_operator="and",
                conditions=[
                    Condition(name="document_name", comparison_operator="is", value="{{#start.q#}}"),
                ],
            ),
        )

        node_id = str(uuid.uuid4())
        config = {"id": node_id, "data": node_data.model_dump()}
        node = KnowledgeRetrievalNode(
            id=node_id,
            config=config,
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        mock_rag_retrieval.knowledge_retrieval.return_value = []
        mock_rag_retrieval.llm_usage = LLMUsage.empty_usage()

        # Act
        node._fetch_dataset_retriever(node_data=node_data, variables=variables)

        # Assert the passed request has resolved value
        call_args = mock_rag_retrieval.knowledge_retrieval.call_args
        request = call_args[1]["request"]
        assert request.metadata_filtering_conditions is not None
        assert request.metadata_filtering_conditions.conditions[0].value == "readme"


class TestResolveDynamicDatasetIds:
    """Tests for dynamic dataset ID resolution via dataset_id_variable_selector."""

    def test_static_only(self, mock_graph_init_params, mock_graph_runtime_state, mock_rag_retrieval):
        """When no variable selector is set, only static dataset_ids are used."""
        static_id = str(uuid.uuid4())
        node_data = KnowledgeRetrievalNodeData(
            title="KR",
            type="knowledge-retrieval",
            dataset_ids=[static_id],
            retrieval_mode="multiple",
        )
        node_id = str(uuid.uuid4())
        node = KnowledgeRetrievalNode(
            id=node_id,
            config={"id": node_id, "data": node_data.model_dump()},
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        assert node._resolve_dataset_ids(node_data) == [static_id]

    def test_dynamic_string_variable(self, mock_graph_init_params, mock_graph_runtime_state, mock_rag_retrieval):
        """A single string variable should be resolved as one dataset ID."""
        dynamic_id = str(uuid.uuid4())
        selector = ["code_node", "dataset_id"]
        mock_graph_runtime_state.variable_pool.add(selector, StringSegment(value=dynamic_id))

        node_data = KnowledgeRetrievalNodeData(
            title="KR",
            type="knowledge-retrieval",
            dataset_ids=[],
            retrieval_mode="multiple",
            dataset_id_variable_selector=selector,
        )
        node_id = str(uuid.uuid4())
        node = KnowledgeRetrievalNode(
            id=node_id,
            config={"id": node_id, "data": node_data.model_dump()},
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        assert node._resolve_dataset_ids(node_data) == [dynamic_id]

    def test_dynamic_array_string_variable(self, mock_graph_init_params, mock_graph_runtime_state, mock_rag_retrieval):
        """An ArrayStringSegment variable should be resolved as multiple dataset IDs."""
        id1, id2 = str(uuid.uuid4()), str(uuid.uuid4())
        selector = ["code_node", "dataset_ids"]
        mock_graph_runtime_state.variable_pool.add(selector, ArrayStringSegment(value=[id1, id2]))

        node_data = KnowledgeRetrievalNodeData(
            title="KR",
            type="knowledge-retrieval",
            dataset_ids=[],
            retrieval_mode="multiple",
            dataset_id_variable_selector=selector,
        )
        node_id = str(uuid.uuid4())
        node = KnowledgeRetrievalNode(
            id=node_id,
            config={"id": node_id, "data": node_data.model_dump()},
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        assert node._resolve_dataset_ids(node_data) == [id1, id2]

    def test_merge_static_and_dynamic_deduplicated(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
    ):
        """Static and dynamic IDs are merged with duplicates removed."""
        shared_id = str(uuid.uuid4())
        static_only = str(uuid.uuid4())
        dynamic_only = str(uuid.uuid4())
        selector = ["code_node", "ids"]
        mock_graph_runtime_state.variable_pool.add(
            selector,
            ArrayStringSegment(value=[shared_id, dynamic_only]),
        )

        node_data = KnowledgeRetrievalNodeData(
            title="KR",
            type="knowledge-retrieval",
            dataset_ids=[static_only, shared_id],
            retrieval_mode="multiple",
            dataset_id_variable_selector=selector,
        )
        node_id = str(uuid.uuid4())
        node = KnowledgeRetrievalNode(
            id=node_id,
            config={"id": node_id, "data": node_data.model_dump()},
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._resolve_dataset_ids(node_data)
        assert result == [static_only, shared_id, dynamic_only]

    def test_dynamic_empty_string_ignored(self, mock_graph_init_params, mock_graph_runtime_state, mock_rag_retrieval):
        """Empty strings in dynamic resolution should be filtered out."""
        selector = ["code_node", "id"]
        mock_graph_runtime_state.variable_pool.add(selector, StringSegment(value=""))

        node_data = KnowledgeRetrievalNodeData(
            title="KR",
            type="knowledge-retrieval",
            dataset_ids=[],
            retrieval_mode="multiple",
            dataset_id_variable_selector=selector,
        )
        node_id = str(uuid.uuid4())
        node = KnowledgeRetrievalNode(
            id=node_id,
            config={"id": node_id, "data": node_data.model_dump()},
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        assert node._resolve_dataset_ids(node_data) == []

    def test_dynamic_variable_not_found_falls_back(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
    ):
        """When the variable selector points to a missing variable, only static IDs are returned."""
        static_id = str(uuid.uuid4())
        node_data = KnowledgeRetrievalNodeData(
            title="KR",
            type="knowledge-retrieval",
            dataset_ids=[static_id],
            retrieval_mode="multiple",
            dataset_id_variable_selector=["nonexistent", "var"],
        )
        node_id = str(uuid.uuid4())
        node = KnowledgeRetrievalNode(
            id=node_id,
            config={"id": node_id, "data": node_data.model_dump()},
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._resolve_dataset_ids(node_data)
        assert result == [static_id]

    def test_dynamic_ids_used_in_fetch(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_rag_retrieval,
    ):
        """_fetch_dataset_retriever should pass dynamically resolved IDs into the retrieval request."""
        dynamic_id = str(uuid.uuid4())
        selector = ["code_node", "dataset_id"]
        mock_graph_runtime_state.variable_pool.add(selector, StringSegment(value=dynamic_id))
        mock_graph_runtime_state.variable_pool.add(["start", "query"], StringSegment(value="hello"))

        node_data = KnowledgeRetrievalNodeData(
            title="KR",
            type="knowledge-retrieval",
            dataset_ids=[],
            retrieval_mode="multiple",
            query_variable_selector=["start", "query"],
            dataset_id_variable_selector=selector,
            multiple_retrieval_config=MultipleRetrievalConfig(
                top_k=5,
                score_threshold=0.0,
                reranking_mode="reranking_model",
                reranking_enable=True,
                reranking_model=RerankingModelConfig(provider="cohere", model="rerank-v2"),
            ),
        )
        node_id = str(uuid.uuid4())
        node = KnowledgeRetrievalNode(
            id=node_id,
            config={"id": node_id, "data": node_data.model_dump()},
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        mock_rag_retrieval.knowledge_retrieval.return_value = []
        mock_rag_retrieval.llm_usage = LLMUsage.empty_usage()

        node._fetch_dataset_retriever(node_data=node_data, variables={"query": "hello"})

        call_args = mock_rag_retrieval.knowledge_retrieval.call_args
        request = call_args[1]["request"]
        assert request.dataset_ids == [dynamic_id]
