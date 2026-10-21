import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from core.workflow.nodes.knowledge_index.entities import KnowledgeIndexNodeData
from core.workflow.nodes.knowledge_index.exc import KnowledgeIndexNodeError
from core.workflow.nodes.knowledge_index.knowledge_index_node import KnowledgeIndexNode
from core.workflow.nodes.knowledge_index.protocols import (
    KNOWLEDGE_INDEX_PROCESSOR_CONTEXT_KEY,
    SUMMARY_INDEX_SERVICE_CONTEXT_KEY,
    IndexingResultDict,
    Preview,
    PreviewItem,
)
from core.workflow.system_variables import SystemVariableKey, build_system_variables
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.runtime import RuntimeState, VariablePool
from graphon.variables.segments import StringSegment
from tests.workflow_test_utils import build_test_graph_init_params


@dataclass(frozen=True)
class IndexCall:
    dataset_id: str
    document_id: str
    original_document_id: str
    chunks: Mapping[str, object]
    batch: object
    summary_index_setting: SummaryIndexSettingDict | None
    session: Session


@dataclass
class RecordingIndexProcessor:
    expected_generation: str | None = "generation-1"
    index_calls: list[IndexCall] = field(default_factory=list)
    preview_sessions: list[Session] = field(default_factory=list)
    error: Exception | None = None
    preview_output: Preview = field(
        default_factory=lambda: Preview(chunk_structure="general_structure", total_segments=0)
    )

    def format_preview(self, chunk_structure: str, chunks: object) -> Preview:
        del chunk_structure, chunks
        return self.preview_output

    def index_and_clean(
        self,
        dataset_id: str,
        document_id: str,
        original_document_id: str,
        chunks: Mapping[str, object],
        batch: object,
        summary_index_setting: SummaryIndexSettingDict | None = None,
        *,
        session: Session,
    ) -> IndexingResultDict:
        self.index_calls.append(
            IndexCall(
                dataset_id,
                document_id,
                original_document_id,
                chunks,
                batch,
                summary_index_setting,
                session,
            )
        )
        if self.error is not None:
            raise self.error
        return {
            "dataset_id": dataset_id,
            "dataset_name": "Dataset",
            "batch": batch,
            "document_id": document_id,
            "document_name": "Document",
            "created_at": 0.0,
            "display_status": "indexing",
        }

    def get_preview_output(
        self,
        chunks: object,
        dataset_id: str,
        document_id: str,
        chunk_structure: str,
        summary_index_setting: SummaryIndexSettingDict | None,
        *,
        session: Session,
    ) -> Preview:
        del chunks, dataset_id, document_id, chunk_structure, summary_index_setting
        self.preview_sessions.append(session)
        return self.preview_output


@dataclass(frozen=True)
class SummaryCall:
    dataset_id: str
    document_id: str
    is_preview: bool
    summary_index_setting: SummaryIndexSettingDict | None
    expected_generation: str | None


@dataclass
class RecordingSummaryIndex:
    calls: list[SummaryCall] = field(default_factory=list)

    def generate_and_vectorize_summary(
        self,
        dataset_id: str,
        document_id: str,
        is_preview: bool,
        summary_index_setting: SummaryIndexSettingDict | None = None,
        *,
        expected_generation: str | None = None,
    ) -> None:
        self.calls.append(SummaryCall(dataset_id, document_id, is_preview, summary_index_setting, expected_generation))


@pytest.fixture
def mock_index_processor() -> RecordingIndexProcessor:
    return RecordingIndexProcessor()


@pytest.fixture
def mock_preview_processor(monkeypatch: pytest.MonkeyPatch) -> RecordingIndexProcessor:
    processor = RecordingIndexProcessor(expected_generation=None)

    def build_preview_processor(*, attachment_writer: object | None = None) -> RecordingIndexProcessor:
        del attachment_writer
        return processor

    monkeypatch.setattr(
        "core.workflow.nodes.knowledge_index.knowledge_index_node.IndexProcessor",
        build_preview_processor,
    )
    return processor


@pytest.fixture
def mock_graph_init_params(
    mock_index_processor: RecordingIndexProcessor,
    mock_preview_processor: RecordingIndexProcessor,
    mock_summary_index_service: RecordingSummaryIndex,
) -> object:
    """Create mock GraphInitParams."""
    del mock_preview_processor
    return build_test_graph_init_params(
        workflow_id=str(uuid.uuid4()),
        graph_config={},
        tenant_id=str(uuid.uuid4()),
        app_id=str(uuid.uuid4()),
        user_id=str(uuid.uuid4()),
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
        extra_context={
            KNOWLEDGE_INDEX_PROCESSOR_CONTEXT_KEY: mock_index_processor,
            SUMMARY_INDEX_SERVICE_CONTEXT_KEY: mock_summary_index_service,
        },
    )


@pytest.fixture
def mock_graph_runtime_state():
    """Create mock RuntimeState."""
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(user_id=str(uuid.uuid4()), files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    return RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=time.perf_counter())


@pytest.fixture
def mock_summary_index_service() -> RecordingSummaryIndex:
    return RecordingSummaryIndex()


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
    init_params,
    runtime_state,
) -> KnowledgeIndexNode:
    return KnowledgeIndexNode(
        node_id=node_id,
        data=(
            node_data
            if isinstance(node_data, KnowledgeIndexNodeData)
            else KnowledgeIndexNodeData.model_validate(node_data)
        ),
        init_params=init_params,
        runtime_state=runtime_state,
    )


class TestKnowledgeIndexNode:
    """
    Test suite for KnowledgeIndexNode.
    """

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
            init_params=mock_graph_init_params,
            runtime_state=mock_graph_runtime_state,
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
            init_params=mock_graph_init_params,
            runtime_state=mock_graph_runtime_state,
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
            init_params=mock_graph_init_params,
            runtime_state=mock_graph_runtime_state,
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
        mock_preview_processor,
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
        mock_preview_processor.preview_output = mock_preview
        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            init_params=mock_graph_init_params,
            runtime_state=mock_graph_runtime_state,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs is not None
        assert len(mock_preview_processor.preview_sessions) == 1
        assert isinstance(mock_preview_processor.preview_sessions[0], Session)
        assert mock_index_processor.index_calls == []

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

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            init_params=mock_graph_init_params,
            runtime_state=mock_graph_runtime_state,
        )

        # Act
        result = node._run()

        # Assert
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs is not None
        assert len(mock_index_processor.index_calls) == 1
        assert mock_summary_index_service.calls == [
            SummaryCall(dataset_id, document_id, False, None, mock_index_processor.expected_generation)
        ]

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
            init_params=mock_graph_init_params,
            runtime_state=mock_graph_runtime_state,
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

        mock_index_processor.error = KnowledgeIndexNodeError("Indexing failed")

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            init_params=mock_graph_init_params,
            runtime_state=mock_graph_runtime_state,
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

        mock_index_processor.error = Exception("Unexpected error")

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            init_params=mock_graph_init_params,
            runtime_state=mock_graph_runtime_state,
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
        sqlite_session: Session,
    ):
        # Arrange
        dataset_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        original_document_id = str(uuid.uuid4())
        batch = "batch_123"
        chunks = {"general_chunks": ["content"]}

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            init_params=mock_graph_init_params,
            runtime_state=mock_graph_runtime_state,
        )

        # Act
        session = sqlite_session
        commits: list[str] = []
        event.listen(session, "after_commit", lambda _session: commits.append("commit"))
        result = node._invoke_knowledge_index(
            session=session,
            dataset_id=dataset_id,
            document_id=document_id,
            original_document_id=original_document_id,
            is_preview=False,
            batch=batch,
            chunks=chunks,
            summary_index_setting=None,
        )

        # Assert
        assert len(mock_summary_index_service.calls) == 1
        assert len(mock_index_processor.index_calls) == 1
        assert commits == ["commit"]
        assert result["document_id"] == document_id

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
            init_params=mock_graph_init_params,
            runtime_state=mock_graph_runtime_state,
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
        sqlite_session: Session,
    ):
        # Arrange
        dataset_id = str(uuid.uuid4())
        document_id = str(uuid.uuid4())
        original_document_id = str(uuid.uuid4())
        batch = "batch_123"
        chunks = {"general_chunks": ["content"]}
        summary_setting: SummaryIndexSettingDict = {"enable": True}

        node_id = str(uuid.uuid4())
        config = {
            "id": node_id,
            "data": sample_node_data.model_dump(),
        }

        node = _build_node(
            node_id=node_id,
            node_data=config["data"],
            init_params=mock_graph_init_params,
            runtime_state=mock_graph_runtime_state,
        )

        # Act
        session = sqlite_session
        commits: list[str] = []
        event.listen(session, "after_commit", lambda _session: commits.append("commit"))
        result = node._invoke_knowledge_index(
            session=session,
            dataset_id=dataset_id,
            document_id=document_id,
            original_document_id=original_document_id,
            is_preview=False,
            batch=batch,
            chunks=chunks,
            summary_index_setting=summary_setting,
        )

        # Assert
        assert mock_summary_index_service.calls == [
            SummaryCall(
                dataset_id,
                document_id,
                False,
                summary_setting,
                mock_index_processor.expected_generation,
            )
        ]
        assert mock_index_processor.index_calls == [
            IndexCall(dataset_id, document_id, original_document_id, chunks, batch, summary_setting, session)
        ]
        assert commits == ["commit"]
        assert result["document_id"] == document_id
