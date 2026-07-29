from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from unittest.mock import MagicMock, patch

import pytest

from commands import vector as vector_command
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import Document as VectorDocument
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetCollectionBinding,
    DocumentSegment,
    DocumentSegmentSummary,
)
from models.dataset import Document as DatasetDocument
from models.enums import (
    CollectionBindingType,
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    SegmentStatus,
    SummaryStatus,
)
from models.model import App, AppAnnotationSetting, MessageAnnotation


def _dataset() -> Dataset:
    dataset = Dataset(
        tenant_id=str(uuid.uuid4()),
        name="vector migration dataset",
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        created_by=str(uuid.uuid4()),
        embedding_model="embedding",
        embedding_model_provider="provider",
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    dataset.id = str(uuid.uuid4())
    return dataset


def _document(dataset: Dataset, *, position: int, doc_form: str) -> DatasetDocument:
    document = DatasetDocument(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=position,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch=f"batch-{position}",
        name=f"document-{position}.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=dataset.created_by,
        enabled=True,
        archived=False,
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=doc_form,
        word_count=10,
        tokens=10,
    )
    document.id = str(uuid.uuid4())
    return document


def _segment(dataset: Dataset, document: DatasetDocument, *, position: int) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=position,
        content=f"parent content {position}",
        word_count=3,
        tokens=3,
        created_by=dataset.created_by,
        status=SegmentStatus.COMPLETED,
        enabled=True,
    )
    segment.id = str(uuid.uuid4())
    segment.index_node_id = str(uuid.uuid4())
    segment.index_node_hash = f"parent-hash-{position}"
    return segment


def _summary(dataset: Dataset, document: DatasetDocument, segment: DocumentSegment) -> DocumentSegmentSummary:
    return DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content=f"summary for {segment.content}",
        summary_index_node_id=str(uuid.uuid4()),
        summary_index_node_hash=f"summary-hash-{segment.position}",
        status=SummaryStatus.COMPLETED,
        enabled=True,
    )


class _ScalarResult:
    def __init__(self, values: Sequence[object]) -> None:
        self._values = values

    def all(self) -> list[object]:
        return list(self._values)


class _QueuedReadSession:
    def __init__(self, results: Sequence[Sequence[object]]) -> None:
        self._results = iter(results)

    def scalars(self, _statement: object) -> _ScalarResult:
        return _ScalarResult(next(self._results))


def test_collect_dataset_vector_documents_preserves_summaries_and_parent_child_shape() -> None:
    dataset = _dataset()
    paragraph_document = _document(dataset, position=1, doc_form=IndexStructureType.PARAGRAPH_INDEX)
    parent_document = _document(dataset, position=2, doc_form=IndexStructureType.PARENT_CHILD_INDEX)
    paragraph_segment = _segment(dataset, paragraph_document, position=1)
    parent_segment = _segment(dataset, parent_document, position=1)
    paragraph_summary = _summary(dataset, paragraph_document, paragraph_segment)
    parent_summary = _summary(dataset, parent_document, parent_segment)
    child = ChildChunk(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=parent_document.id,
        segment_id=parent_segment.id,
        position=1,
        content="real child content",
        word_count=3,
        created_by=dataset.created_by,
        index_node_id=str(uuid.uuid4()),
        index_node_hash="child-hash",
    )
    session = _QueuedReadSession(
        [
            [paragraph_document, parent_document],
            [paragraph_segment],
            [paragraph_summary],
            [parent_segment],
            [parent_summary],
            [child],
        ]
    )

    documents, segment_count = vector_command._collect_dataset_vector_documents(
        dataset,
        session=session,  # type: ignore[arg-type]
    )

    assert segment_count == 2
    assert {document.metadata["doc_id"] for document in documents} == {
        paragraph_segment.index_node_id,
        paragraph_summary.summary_index_node_id,
        child.index_node_id,
        parent_summary.summary_index_node_id,
    }
    assert parent_segment.index_node_id not in {document.metadata["doc_id"] for document in documents}
    assert {document.metadata["original_chunk_id"] for document in documents if document.metadata["is_summary"]} == {
        paragraph_segment.id,
        parent_segment.id,
    }


@dataclass(frozen=True)
class _Page:
    items: list[Dataset]


class _TrackedSessionContext:
    def __init__(self, tracker: _ConnectionTracker, session: MagicMock) -> None:
        self._tracker = tracker
        self._session = session

    def __enter__(self) -> MagicMock:
        self._tracker.active += 1
        return self._session

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self._tracker.active -= 1


class _ConnectionTracker:
    def __init__(self) -> None:
        self.active = 0
        self.read_scalar_result: object | None = None
        self.write_session = MagicMock()

    def read(self) -> _TrackedSessionContext:
        session = MagicMock()
        session.scalar.return_value = self.read_scalar_result
        return _TrackedSessionContext(self, session)

    def write(self) -> _TrackedSessionContext:
        return _TrackedSessionContext(self, self.write_session)


class _TrackedSessionMaker:
    def __init__(self, tracker: _ConnectionTracker) -> None:
        self._tracker = tracker

    def __call__(self) -> _TrackedSessionContext:
        return self._tracker.read()

    def begin(self) -> _TrackedSessionContext:
        return self._tracker.write()


def test_knowledge_migration_closes_read_transaction_before_vector_io() -> None:
    dataset = _dataset()
    tracker = _ConnectionTracker()
    tracker.write_session.execute.return_value.rowcount = 1
    vector = MagicMock()
    document = VectorDocument(
        page_content="snapshot",
        metadata={
            "doc_id": str(uuid.uuid4()),
            "document_id": str(uuid.uuid4()),
            "dataset_id": dataset.id,
        },
    )

    def create_vector(detached_dataset: Dataset) -> MagicMock:
        assert tracker.active == 0
        assert detached_dataset.index_struct_dict is not None
        return vector

    with (
        patch.object(vector_command, "db", MagicMock(engine=object())),
        patch.object(
            vector_command,
            "sessionmaker",
            return_value=_TrackedSessionMaker(tracker),
        ),
        patch.object(
            vector_command,
            "paginate_query",
            side_effect=[_Page([dataset]), _Page([])],
        ),
        patch.object(
            vector_command,
            "_collect_dataset_vector_documents",
            return_value=([document], 1),
        ),
        patch.object(vector_command, "Vector", side_effect=create_vector) as vector_factory,
        patch.object(vector_command.dify_config, "VECTOR_STORE", VectorType.WEAVIATE),
    ):
        vector_command.migrate_knowledge_vector_database()

    vector_factory.assert_called_once_with(dataset)
    vector.delete.assert_called_once_with()
    vector.create.assert_called_once_with([document])
    tracker.write_session.execute.assert_called_once()
    assert tracker.active == 0


def test_knowledge_migration_does_not_activate_snapshot_changed_during_vector_io(
    capsys: pytest.CaptureFixture[str],
) -> None:
    dataset = _dataset()
    tracker = _ConnectionTracker()
    vector = MagicMock()
    original_document = VectorDocument(
        page_content="original snapshot",
        metadata={"doc_id": str(uuid.uuid4()), "dataset_id": dataset.id},
    )
    changed_document = VectorDocument(
        page_content="concurrent update",
        metadata={"doc_id": original_document.metadata["doc_id"], "dataset_id": dataset.id},
    )

    with (
        patch.object(vector_command, "db", MagicMock(engine=object())),
        patch.object(vector_command, "sessionmaker", return_value=_TrackedSessionMaker(tracker)),
        patch.object(vector_command, "paginate_query", side_effect=[_Page([dataset]), _Page([])]),
        patch.object(
            vector_command,
            "_collect_dataset_vector_documents",
            side_effect=[([original_document], 1), ([changed_document], 1)],
        ),
        patch.object(vector_command, "Vector", return_value=vector),
        patch.object(vector_command.dify_config, "VECTOR_STORE", VectorType.WEAVIATE),
    ):
        vector_command.migrate_knowledge_vector_database()

    vector.create.assert_called_once_with([original_document])
    tracker.write_session.execute.assert_not_called()
    assert "changed while its vector index was being migrated" in capsys.readouterr().out
    assert tracker.active == 0


def test_knowledge_migration_does_not_overwrite_concurrently_changed_vector_configuration(
    capsys: pytest.CaptureFixture[str],
) -> None:
    dataset = _dataset()
    tracker = _ConnectionTracker()
    tracker.write_session.execute.return_value.rowcount = 0
    vector = MagicMock()
    document = VectorDocument(
        page_content="stable snapshot",
        metadata={"doc_id": str(uuid.uuid4()), "dataset_id": dataset.id},
    )

    with (
        patch.object(vector_command, "db", MagicMock(engine=object())),
        patch.object(vector_command, "sessionmaker", return_value=_TrackedSessionMaker(tracker)),
        patch.object(vector_command, "paginate_query", side_effect=[_Page([dataset]), _Page([])]),
        patch.object(vector_command, "_collect_dataset_vector_documents", return_value=([document], 1)),
        patch.object(vector_command, "Vector", return_value=vector),
        patch.object(vector_command.dify_config, "VECTOR_STORE", VectorType.WEAVIATE),
    ):
        vector_command.migrate_knowledge_vector_database()

    vector.create.assert_called_once_with([document])
    tracker.write_session.execute.assert_called_once()
    assert "vector configuration changed concurrently" in capsys.readouterr().out
    assert tracker.active == 0


def test_knowledge_migration_compare_and_swap_guards_embedding_configuration(
    capsys: pytest.CaptureFixture[str],
) -> None:
    dataset = _dataset()
    tracker = _ConnectionTracker()
    vector = MagicMock()
    document = VectorDocument(
        page_content="stable snapshot",
        metadata={"doc_id": str(uuid.uuid4()), "dataset_id": dataset.id},
    )

    def execute(statement: object) -> MagicMock:
        # Simulate the database accepting the activation unless the command
        # includes the embedding configuration in its compare-and-swap.
        statement_text = str(statement)
        guards_embedding_configuration = (
            "datasets.embedding_model =" in statement_text and "datasets.embedding_model_provider =" in statement_text
        )
        result = MagicMock()
        result.rowcount = 0 if guards_embedding_configuration else 1
        return result

    tracker.write_session.execute.side_effect = execute

    with (
        patch.object(vector_command, "db", MagicMock(engine=object())),
        patch.object(vector_command, "sessionmaker", return_value=_TrackedSessionMaker(tracker)),
        patch.object(vector_command, "paginate_query", side_effect=[_Page([dataset]), _Page([])]),
        patch.object(vector_command, "_collect_dataset_vector_documents", return_value=([document], 1)),
        patch.object(vector_command, "Vector", return_value=vector),
        patch.object(vector_command.dify_config, "VECTOR_STORE", VectorType.WEAVIATE),
    ):
        vector_command.migrate_knowledge_vector_database()

    vector.create.assert_called_once_with([document])
    assert "vector configuration changed concurrently" in capsys.readouterr().out
    assert tracker.active == 0


def test_knowledge_migration_resolves_qdrant_binding_without_holding_connection_during_vector_io() -> None:
    dataset = _dataset()
    dataset.collection_binding_id = str(uuid.uuid4())
    binding = DatasetCollectionBinding(
        provider_name="provider",
        model_name="embedding",
        type=CollectionBindingType.DATASET,
        collection_name="bound-collection",
    )
    tracker = _ConnectionTracker()
    tracker.read_scalar_result = binding
    tracker.write_session.execute.return_value.rowcount = 1
    vector = MagicMock()
    document = VectorDocument(
        page_content="stable snapshot",
        metadata={"doc_id": str(uuid.uuid4()), "dataset_id": dataset.id},
    )

    def create_vector(detached_dataset: Dataset) -> MagicMock:
        assert tracker.active == 0
        assert detached_dataset.index_struct_dict == {
            "type": VectorType.QDRANT,
            "vector_store": {"class_prefix": binding.collection_name},
        }
        return vector

    with (
        patch.object(vector_command, "db", MagicMock(engine=object())),
        patch.object(vector_command, "sessionmaker", return_value=_TrackedSessionMaker(tracker)),
        patch.object(vector_command, "paginate_query", side_effect=[_Page([dataset]), _Page([])]),
        patch.object(vector_command, "_collect_dataset_vector_documents", return_value=([document], 1)),
        patch.object(vector_command, "Vector", side_effect=create_vector),
        patch.object(vector_command.dify_config, "VECTOR_STORE", VectorType.QDRANT),
    ):
        vector_command.migrate_knowledge_vector_database()

    vector.delete.assert_called_once_with()
    vector.create.assert_called_once_with([document])
    assert tracker.active == 0


class _SequencedSessionMaker:
    def __init__(self, sessions: Sequence[MagicMock], tracker: _ConnectionTracker) -> None:
        self._sessions = iter(sessions)
        self._tracker = tracker

    def begin(self) -> _TrackedSessionContext:
        session = next(self._sessions)
        return _TrackedSessionContext(self._tracker, session)


def test_annotation_migration_closes_database_transaction_before_vector_io() -> None:
    tenant_id = str(uuid.uuid4())
    app = App(id=str(uuid.uuid4()), tenant_id=tenant_id, status="normal")
    binding = DatasetCollectionBinding(
        provider_name="provider",
        model_name="embedding",
        type=CollectionBindingType.ANNOTATION,
        collection_name="annotation-collection",
    )
    setting = AppAnnotationSetting(
        app_id=app.id,
        score_threshold=0.8,
        collection_binding_id=binding.id,
        created_user_id=str(uuid.uuid4()),
        updated_user_id=str(uuid.uuid4()),
    )
    annotation = MessageAnnotation(
        app_id=app.id,
        question="How does migration work?",
        content="Safely.",
        account_id=str(uuid.uuid4()),
    )
    first_page_session = MagicMock()
    first_page_session.scalars.return_value.all.return_value = [app]
    detail_session = MagicMock()
    detail_session.scalar.side_effect = [setting, binding]
    detail_session.scalars.return_value.all.return_value = [annotation]
    final_page_session = MagicMock()
    final_page_session.scalars.return_value.all.return_value = list[App]()
    tracker = _ConnectionTracker()
    session_maker = _SequencedSessionMaker(
        [first_page_session, detail_session, final_page_session],
        tracker,
    )
    vector = MagicMock()

    def create_vector(dataset: Dataset, *, attributes: list[str]) -> MagicMock:
        assert tracker.active == 0
        assert dataset.id == app.id
        assert attributes == ["doc_id", "annotation_id", "app_id"]
        return vector

    with (
        patch.object(vector_command, "db", MagicMock(engine=object())),
        patch.object(vector_command, "sessionmaker", return_value=session_maker),
        patch.object(vector_command, "Vector", side_effect=create_vector),
    ):
        vector_command.migrate_annotation_vector_database()

    vector.delete.assert_called_once_with()
    created_documents = vector.create.call_args.args[0]
    assert len(created_documents) == 1
    assert created_documents[0].metadata["annotation_id"] == annotation.id
    assert tracker.active == 0
