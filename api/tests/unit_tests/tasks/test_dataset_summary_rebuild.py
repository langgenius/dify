import importlib
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import Document as IndexDocument
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus, SummaryStatus


@pytest.fixture(params=["deal_dataset_vector_index_task", "deal_dataset_index_update_task"])
def task_module(request: pytest.FixtureRequest) -> ModuleType:
    return importlib.import_module(f"tasks.{request.param}")


@pytest.fixture
def indexed_dataset(sqlite_session: Session) -> tuple[Dataset, list[Document]]:
    tenant_id = str(uuid.uuid4())
    created_by = str(uuid.uuid4())
    dataset = Dataset(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Summary rebuild dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        is_multimodal=False,
        summary_index_setting={"enable": True},
    )
    documents = []
    sqlite_session.add(dataset)
    for position in (1, 2):
        document = Document(
            id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            position=position,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch-1",
            name=f"document-{position}.txt",
            created_from=DocumentCreatedFrom.WEB,
            created_by=created_by,
            indexing_status=IndexingStatus.COMPLETED,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content=f"Body {position}",
            word_count=2,
            tokens=2,
            created_by=created_by,
            index_node_id=f"node-{position}",
            index_node_hash=f"hash-{position}",
            status=SegmentStatus.COMPLETED,
        )
        summary = DocumentSegmentSummary(
            dataset_id=dataset.id,
            document_id=document.id,
            chunk_id=segment.id,
            summary_content=f"Summary {position}",
            summary_index_node_id=f"summary-{position}",
            status=SummaryStatus.COMPLETED,
        )
        sqlite_session.add_all([document, segment, summary])
        documents.append(document)
    sqlite_session.commit()
    return dataset, documents


@contextmanager
def _record_commits(factory: sessionmaker[Session], events: list[str]) -> Generator[None]:
    def after_commit(_session: Session) -> None:
        events.append("commit")

    event.listen(factory.class_, "after_commit", after_commit)
    try:
        yield
    finally:
        event.remove(factory.class_, "after_commit", after_commit)


@pytest.mark.parametrize("failed_document", [False, True], ids=["all-loaded", "one-load-fails"])
@pytest.mark.parametrize("summaries_enabled", [True, False], ids=["summaries-enabled", "summaries-disabled"])
def test_update_dispatches_summaries_after_body_rebuild_commits(
    task_module: ModuleType,
    indexed_dataset: tuple[Dataset, list[Document]],
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    failed_document: bool,
    summaries_enabled: bool,
) -> None:
    dataset, documents = indexed_dataset
    dataset.summary_index_setting = {"enable": summaries_enabled}
    sqlite_session.commit()
    expected_statuses = {
        document.id: IndexingStatus.ERROR if failed_document and index == 0 else IndexingStatus.COMPLETED
        for index, document in enumerate(documents)
    }
    events: list[str] = []
    observed_statuses: list[dict[str, IndexingStatus]] = []
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: events.append("clean")

    def load(_dataset, body_documents: list[IndexDocument], **_kwargs) -> None:
        document_id = body_documents[0].metadata["document_id"]
        events.append(f"load:{document_id}")
        if failed_document and document_id == documents[0].id:
            raise RuntimeError("Embedding request failed")

    def dispatch(*_args, **_kwargs) -> None:
        events.append("dispatch")
        assert not processor.clean.call_args.kwargs["session"].in_transaction()
        # A worker starts with a fresh session and must see every final document status.
        with sqlite_session_factory() as session:
            observed_statuses.append(
                dict(
                    session.execute(
                        select(Document.id, Document.indexing_status).where(Document.dataset_id == dataset.id)
                    )
                    .tuples()
                    .all()
                )
            )

    processor.load.side_effect = load
    with (
        _record_commits(sqlite_session_factory, events),
        patch.object(task_module, "IndexProcessorFactory") as processor_factory,
        patch("tasks.regenerate_summary_index_task.regenerate_summary_index_task.delay", side_effect=dispatch) as delay,
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        getattr(task_module, task_module.__name__.rsplit(".", 1)[1]).run(dataset.id, "update")

    delay.assert_called_once_with(dataset.id, regenerate_reason="embedding_model_changed", regenerate_vectors_only=True)
    assert observed_statuses == [expected_statuses]
    assert events[:2] == ["commit", "clean"]
    assert set(events[2:-1:2]) == {f"load:{document.id}" for document in documents}
    assert events[3:-1:2] == ["commit", "commit"]
    assert events[-1] == "dispatch"


def test_update_does_not_dispatch_summaries_when_cleanup_fails(
    task_module: ModuleType,
    indexed_dataset: tuple[Dataset, list[Document]],
) -> None:
    dataset, _documents = indexed_dataset
    with (
        patch.object(task_module, "IndexProcessorFactory") as processor_factory,
        patch("tasks.regenerate_summary_index_task.regenerate_summary_index_task.delay") as delay,
    ):
        processor = processor_factory.return_value.init_index_processor.return_value
        processor.clean.side_effect = RuntimeError("Vector store unavailable")
        getattr(task_module, task_module.__name__.rsplit(".", 1)[1]).run(dataset.id, "update")

    processor.load.assert_not_called()
    delay.assert_not_called()


def test_update_dispatches_after_cleanup_without_completed_documents(
    task_module: ModuleType,
    indexed_dataset: tuple[Dataset, list[Document]],
    sqlite_session: Session,
) -> None:
    dataset, documents = indexed_dataset
    for document in documents:
        document.indexing_status = IndexingStatus.ERROR
    sqlite_session.commit()
    events: list[str] = []

    def dispatch(*_args, **_kwargs) -> None:
        events.append("dispatch")
        assert not processor.clean.call_args.kwargs["session"].in_transaction()

    with (
        patch.object(task_module, "IndexProcessorFactory") as processor_factory,
        patch("tasks.regenerate_summary_index_task.regenerate_summary_index_task.delay") as delay,
    ):
        processor = processor_factory.return_value.init_index_processor.return_value
        processor.clean.side_effect = lambda *_args, **_kwargs: events.append("clean")
        delay.side_effect = dispatch
        getattr(task_module, task_module.__name__.rsplit(".", 1)[1]).run(dataset.id, "update")

    processor.load.assert_not_called()
    delay.assert_called_once_with(dataset.id, regenerate_reason="embedding_model_changed", regenerate_vectors_only=True)
    assert events == ["clean", "dispatch"]


def test_other_actions_do_not_dispatch_summary_rebuild(
    task_module: ModuleType,
    indexed_dataset: tuple[Dataset, list[Document]],
) -> None:
    dataset, _documents = indexed_dataset
    actions = ("add", "remove") if task_module.__name__.endswith("vector_index_task") else ("upgrade",)
    with (
        patch.object(task_module, "IndexProcessorFactory"),
        patch("tasks.regenerate_summary_index_task.regenerate_summary_index_task.delay") as delay,
    ):
        task = getattr(task_module, task_module.__name__.rsplit(".", 1)[1])
        for action in actions:
            task.run(dataset.id, action)

    delay.assert_not_called()


def test_missing_dataset_does_not_dispatch_summary_rebuild(task_module: ModuleType) -> None:
    with (
        patch.object(task_module, "IndexProcessorFactory") as processor_factory,
        patch("tasks.regenerate_summary_index_task.regenerate_summary_index_task.delay") as delay,
    ):
        getattr(task_module, task_module.__name__.rsplit(".", 1)[1]).run(str(uuid.uuid4()), "update")

    processor_factory.assert_not_called()
    delay.assert_not_called()
