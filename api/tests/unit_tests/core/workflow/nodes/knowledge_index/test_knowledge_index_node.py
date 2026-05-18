import time
import uuid
from unittest.mock import Mock

import pytest
from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.workflow.nodes.knowledge_index.entities import KnowledgeIndexNodeData
from core.workflow.nodes.knowledge_index.exc import KnowledgeIndexNodeError
from core.workflow.nodes.knowledge_index.knowledge_index_node import KnowledgeIndexNode
from core.workflow.nodes.knowledge_index.protocols import (
    IndexProcessorProtocol,
    Preview,
    PreviewItem,
    SummaryIndexServiceProtocol,
)
from core.workflow.system_variables import SystemVariableKey, build_system_variables
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variables.segments import StringSegment
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
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(user_id=str(uuid.uuid4()), files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    return GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())


@pytest.fixture
def mock_index_processor(mocker: MockerFixture):
    """Create mock IndexProcessorProtocol."""
    mock_processor = Mock(spec=IndexProcessorProtocol)
    mocker.patch(
        "core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessor",
        return_value=mock_processor,
    )
    return mock_processor


@pytest.fixture
def mock_summary_index_service(mocker: MockerFixture):
    """Create mock SummaryIndexServiceProtocol."""
    mock_service = Mock(spec=SummaryIndexServiceProtocol)
    mocker.patch(
        "core.workflow.nodes.knowledge_index.knowledge_index_node.SummaryIndex",
        return_value=mock_service,
    )
    return mock_service


@pytest.fixture
def sample_node_data():
    """Create sample KnowledgeIndexNodeData."""
    return KnowledgeIndexNodeData(
        title="Knowledge Index",
        type="knowledge-index",
        chunk_structure="general_structure",
        index_chunk_variable_selector=["start", "chunks"],
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        summary_index_setting=None,
    )


@pytest.fixture
def sample_chunks():
    """Create sample chunks data."""
    return {
        "general_chunks": ["Chunk 1 content", "Chunk 2 content"],
        "data_source_info": {"file_id": str(uuid.uuid4())},
    }


def _build_node(
    *,
    node_id: str,
    node_data: KnowledgeIndexNodeData | dict[str, object],
    graph_init_params,
    graph_runtime_state,
) -> KnowledgeIndexNode:
    return KnowledgeIndexNode(
        node_id=node_id,
        data=(
            node_data
            if isinstance(node_data, KnowledgeIndexNodeData)
            else KnowledgeIndexNodeData.model_validate(node_data)
        ),
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )


class TestKnowledgeIndexNode:
    """
    Test suite for KnowledgeIndexNode.
    """

    def test_node_initialization(
        self, mock_graph_init_params, mock_graph_runtime_state, mock_index_processor, mock_summary_index_service
    ):
        """Test KnowledgeIndexNode initialization."""
        # Arrange
        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": {
                "title": "Knowledge Index",
                "type": "knowledge-index",
                "chunk_structure": "general_structure",
                "index_chunk_variable_selector": ["start", "chunks"],
            },
        }

        # Act
        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Assert
        assert node.id == node_id
        assert node.index_processor == mock_index_processor
        assert node.summary_index_service == mock_summary_index_service

    def test_run_without_dataset_id(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_index_processor,
        mock_summary_index_service,
        sample_node_data,
    ):
        """Test _run raises KnowledgeIndexNodeError when dataset_id is not provided."""
        # Arrange
        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Act & Assert
        with pytest.raises(KnowledgeIndexNodeError, match="Dataset ID is required"):
            node._run()

    def test_run_without_index_chunk_variable(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_index_processor,
        mock_summary_index_service,
        sample_node_data,
    ):
        """Test _run raises KnowledgeIndexNodeError when index chunk variable is not provided."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DATASET_ID],
            StringSegment(value=dataset_id),
        )

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Act & Assert
        with pytest.raises(KnowledgeIndexNodeError, match="Index chunk variable is required"):
            node._run()

    def test_run_with_empty_chunks(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_index_processor,
        mock_summary_index_service,
        sample_node_data,
    ):
        """Test _run fails when chunks is empty."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        chunks_selector = ["start", "chunks"]

        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DATASET_ID],
            StringSegment(value=dataset_id),
        )
        mock_graph_runtime_state.variable_pool.add(chunks_selector, StringSegment(value=""))

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Chunks is required" in result.error

    def test_run_preview_mode_success(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_index_processor,
        mock_summary_index_service,
        sample_node_data,
        sample_chunks,
    ):
        """Test _run succeeds in preview mode."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        chunks_selector = ["start", "chunks"]

        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DATASET_ID],
            StringSegment(value=dataset_id),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DOCUMENT_ID],
            StringSegment(value=document_id),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.INVOKE_FROM],
            StringSegment(value=InvokeFrom.DEBUGGER),
        )
        mock_graph_runtime_state.variable_pool.add(chunks_selector, sample_chunks)

        # Mock preview output
        mock_preview = Preview(
            chunk_structure="general_structure",
            preview=[PreviewItem(content="Chunk 1"), PreviewItem(content="Chunk 2")],
            total_segments=2,
        )
        mock_index_processor.get_preview_output.return_value = mock_preview

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs is not None
        assert mock_index_processor.get_preview_output.called

    def test_run_production_mode_success(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_index_processor,
        mock_summary_index_service,
        sample_node_data,
        sample_chunks,
    ):
        """Test _run succeeds in production mode."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        original_document_id = str(uuid.uuid4())
        batch = "batch_123"
        chunks_selector = ["start", "chunks"]

        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DATASET_ID],
            StringSegment(value=dataset_id),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DOCUMENT_ID],
            StringSegment(value=document_id),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.ORIGINAL_DOCUMENT_ID],
            StringSegment(value=original_document_id),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.BATCH],
            StringSegment(value=batch),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.INVOKE_FROM],
            StringSegment(value=InvokeFrom.SERVICE_API),
        )
        mock_graph_runtime_state.variable_pool.add(chunks_selector, sample_chunks)

        # Mock index_and_clean output
        mock_index_processor.index_and_clean.return_value = {"status": "indexed"}

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs is not None
        assert mock_summary_index_service.generate_and_vectorize_summary.called
        assert mock_index_processor.index_and_clean.called

    def test_run_production_mode_without_batch(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_index_processor,
        mock_summary_index_service,
        sample_node_data,
        sample_chunks,
    ):
        """Test _run fails when batch is not provided in production mode."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        chunks_selector = ["start", "chunks"]

        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DATASET_ID],
            StringSegment(value=dataset_id),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DOCUMENT_ID],
            StringSegment(value=document_id),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.INVOKE_FROM],
            StringSegment(value=InvokeFrom.SERVICE_API),
        )
        mock_graph_runtime_state.variable_pool.add(chunks_selector, sample_chunks)

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Batch is required" in result.error

    def test_run_with_knowledge_index_node_error(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_index_processor,
        mock_summary_index_service,
        sample_node_data,
        sample_chunks,
    ):
        """Test _run handles KnowledgeIndexNodeError properly."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        batch = "batch_123"
        chunks_selector = ["start", "chunks"]

        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DATASET_ID],
            StringSegment(value=dataset_id),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DOCUMENT_ID],
            StringSegment(value=document_id),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.BATCH],
            StringSegment(value=batch),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.INVOKE_FROM],
            StringSegment(value=InvokeFrom.SERVICE_API),
        )
        mock_graph_runtime_state.variable_pool.add(chunks_selector, sample_chunks)

        # Mock to raise KnowledgeIndexNodeError
        mock_index_processor.index_and_clean.side_effect = KnowledgeIndexNodeError("Indexing failed")

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Indexing failed" in result.error
        assert result.error_type == "KnowledgeIndexNodeError"

    def test_run_with_generic_exception(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_index_processor,
        mock_summary_index_service,
        sample_node_data,
        sample_chunks,
    ):
        """Test _run handles generic exceptions properly."""
        # Arrange
        dataset_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        batch = "batch_123"
        chunks_selector = ["start", "chunks"]

        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DATASET_ID],
            StringSegment(value=dataset_id),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.DOCUMENT_ID],
            StringSegment(value=document_id),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.BATCH],
            StringSegment(value=batch),
        )
        mock_graph_runtime_state.variable_pool.add(
            ["sys", SystemVariableKey.INVOKE_FROM],
            StringSegment(value=InvokeFrom.SERVICE_API),
        )
        mock_graph_runtime_state.variable_pool.add(chunks_selector, sample_chunks)

        # Mock to raise generic exception
        mock_index_processor.index_and_clean.side_effect = Exception("Unexpected error")

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Unexpected error" in result.error
        assert result.error_type == "Exception"

    def test_invoke_knowledge_index(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_index_processor,
        mock_summary_index_service,
        sample_node_data,
    ):
        # Arrange
        dataset_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        original_document_id = str(uuid.uuid4())
        batch = "batch_123"
        chunks = {"general_chunks": ["content"]}

        mock_index_processor.index_and_clean.return_value = {"status": "indexed"}

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Act
        result = node._invoke_knowledge_index(
            dataset_id=dataset_id,
            document_id=document_id,
            original_document_id=original_document_id,
            is_preview=False,
            batch=batch,
            chunks=chunks,
            summary_index_setting=None,
        )

        # Assert
        assert mock_summary_index_service.generate_and_vectorize_summary.called
        assert mock_index_processor.index_and_clean.called
        assert result == {"status": "indexed"}

    def test_version_method(self):
        """Test version class method."""
        # Act
        version = KnowledgeIndexNode.version()

        # Assert
        assert version == "1"

    def test_get_streaming_template(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_index_processor,
        mock_summary_index_service,
        sample_node_data,
    ):
        """Test get_streaming_template method."""
        # Arrange
        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Act
        template = node.get_streaming_template()

        # Assert
        assert template is not None
        assert template.segments == []


class TestInvokeKnowledgeIndex:
    def test_invoke_with_summary_index_setting(
        self,
        mock_graph_init_params,
        mock_graph_runtime_state,
        mock_index_processor,
        mock_summary_index_service,
        sample_node_data,
    ):
        # Arrange
        dataset_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        original_document_id = str(uuid.uuid4())
        batch = "batch_123"
        chunks = {"general_chunks": ["content"]}
        summary_setting = {"enabled": True}

        mock_index_processor.index_and_clean.return_value = {"status": "indexed"}

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            graph_init_params=mock_graph_init_params,
            graph_runtime_state=mock_graph_runtime_state,
        )

        # Act
        result = node._invoke_knowledge_index(
            dataset_id=dataset_id,
            document_id=document_id,
            original_document_id=original_document_id,
            is_preview=False,
            batch=batch,
            chunks=chunks,
            summary_index_setting=summary_setting,
        )

        # Assert
        mock_summary_index_service.generate_and_vectorize_summary.assert_called_once_with(
            dataset_id, document_id, False, summary_setting
        )
        mock_index_processor.index_and_clean.assert_called_once_with(
            dataset_id, document_id, original_document_id, chunks, batch, summary_setting
        )
        assert result == {"status": "indexed"}
