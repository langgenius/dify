from contextlib import nullcontext
from unittest.mock import MagicMock, patch

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from tasks.delete_segment_from_index_task import delete_segment_from_index_task
from tasks.disable_segment_from_index_task import disable_segment_from_index_task
from tasks.disable_segments_from_index_task import disable_segments_from_index_task
from tasks.remove_document_from_index_task import remove_document_from_index_task


def _dataset(*, is_multimodal: bool = False) -> Dataset:
    return Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        created_by="00000000-0000-0000-0000-000000000001",
        is_multimodal=is_multimodal,
    )


def _document(dataset: Dataset, *, enabled: bool = True) -> Document:
    return Document(
        id="document-1",
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.WEB,
        created_by="00000000-0000-0000-0000-000000000001",
        indexing_status=IndexingStatus.COMPLETED,
        enabled=enabled,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        disabled_by="00000000-0000-0000-0000-000000000002",
    )


def _segment(dataset: Dataset, document: Document, *, index_node_id: str = "node-1") -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by="00000000-0000-0000-0000-000000000001",
        index_node_id=index_node_id,
        status=SegmentStatus.COMPLETED,
        disabled_by="00000000-0000-0000-0000-000000000002",
    )
    segment.id = "segment-1"
    return segment


def test_disable_segment_commits_index_cleanup() -> None:
    dataset = _dataset()
    document = _document(dataset)
    segment = _segment(dataset, document)
    session = MagicMock()
    session.scalar.return_value = segment
    session.get.side_effect = lambda model, _identifier: dataset if model is Dataset else document
    phase_events: list[str] = []
    session.commit.side_effect = lambda: phase_events.append("commit")
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")
    disable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        patch(
            "tasks.disable_segment_from_index_task.session_factory.create_session", return_value=nullcontext(session)
        ),
        patch("tasks.disable_segment_from_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.summary_index_service.SummaryIndexService.disable_summaries_for_segments",
            disable_summaries,
        ),
        patch("tasks.disable_segment_from_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        disable_segment_from_index_task.run(segment.id)

    assert phase_events == ["commit", "clean", "commit", "summary"]
    disable_summaries.assert_called_once_with(
        dataset=dataset,
        session=session,
        segment_ids=[segment.id],
        disabled_by=segment.disabled_by,
    )


def test_disable_segment_without_primary_vector_still_disables_summary() -> None:
    dataset = _dataset()
    document = _document(dataset)
    segment = _segment(dataset, document, index_node_id="")
    segment.index_node_id = None
    session = MagicMock()
    session.scalar.return_value = segment
    session.get.side_effect = lambda model, _identifier: dataset if model is Dataset else document
    processor = MagicMock()
    disable_summaries = MagicMock()

    with (
        patch(
            "tasks.disable_segment_from_index_task.session_factory.create_session", return_value=nullcontext(session)
        ),
        patch("tasks.disable_segment_from_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.summary_index_service.SummaryIndexService.disable_summaries_for_segments",
            disable_summaries,
        ),
        patch("tasks.disable_segment_from_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        disable_segment_from_index_task.run(segment.id)

    processor.clean.assert_not_called()
    disable_summaries.assert_called_once_with(
        dataset=dataset,
        session=session,
        segment_ids=[segment.id],
        disabled_by=segment.disabled_by,
    )


def test_disable_segments_commits_index_cleanup() -> None:
    dataset = _dataset()
    document = _document(dataset)
    segment = _segment(dataset, document)
    session = MagicMock()
    session.scalar.side_effect = [dataset, document]
    session.scalars.return_value.all.return_value = [segment]
    phase_events: list[str] = []
    session.commit.side_effect = lambda: phase_events.append("commit")
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")
    disable_summaries = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("summary"))

    with (
        patch(
            "tasks.disable_segments_from_index_task.session_factory.create_session", return_value=nullcontext(session)
        ),
        patch("tasks.disable_segments_from_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.summary_index_service.SummaryIndexService.disable_summaries_for_segments",
            disable_summaries,
        ),
        patch("tasks.disable_segments_from_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        disable_segments_from_index_task.run([segment.id], dataset.id, document.id)

    assert phase_events == ["commit", "clean", "commit", "summary"]
    disable_summaries.assert_called_once_with(
        dataset=dataset,
        session=session,
        segment_ids=[segment.id],
        disabled_by=segment.disabled_by,
    )


def test_delete_segment_commits_index_cleanup_without_attachments() -> None:
    dataset = _dataset()
    document = _document(dataset)
    session = MagicMock()
    session.scalar.side_effect = [dataset, document]
    phase_events: list[str] = []
    session.commit.side_effect = lambda: phase_events.append("commit")
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")

    with (
        patch("tasks.delete_segment_from_index_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, ["segment-1"])

    assert phase_events == ["commit", "clean", "commit"]


def test_delete_segment_cleans_deleted_ids_for_inactive_document() -> None:
    """Actual deletion must not leave summaries because a document is disabled."""
    dataset = _dataset()
    document = _document(dataset, enabled=False)
    session = MagicMock()
    session.scalar.side_effect = [dataset, document]
    processor = MagicMock()

    with (
        patch("tasks.delete_segment_from_index_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        delete_segment_from_index_task.run([], dataset.id, document.id, ["segment-1"])

    processor.clean.assert_called_once_with(
        dataset,
        [],
        with_keywords=True,
        delete_child_chunks=True,
        precomputed_child_node_ids=None,
        delete_summaries=True,
        segment_ids=["segment-1"],
        session=session,
    )


def test_delete_segment_removes_relational_dependants_when_document_is_already_gone() -> None:
    dataset = _dataset()
    session = MagicMock()
    session.scalar.side_effect = [dataset, None]

    with (
        patch("tasks.delete_segment_from_index_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
    ):
        delete_segment_from_index_task.run([], dataset.id, "missing-document", ["segment-1"])

    processor_factory.assert_not_called()
    delete_statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert any("DELETE FROM document_segment_summaries" in sql for sql in delete_statements)
    assert any("DELETE FROM child_chunks" in sql for sql in delete_statements)
    assert any("DELETE FROM segment_attachment_bindings" in sql for sql in delete_statements)


def test_delete_segment_removes_relational_dependants_when_index_cleanup_fails() -> None:
    dataset = _dataset()
    document = _document(dataset)
    session = MagicMock()
    session.scalar.side_effect = [dataset, document]
    processor = MagicMock()
    processor.clean.side_effect = RuntimeError("vector backend unavailable")

    with (
        patch("tasks.delete_segment_from_index_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        delete_segment_from_index_task.run([], dataset.id, document.id, ["segment-1"])

    delete_statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert any("DELETE FROM document_segment_summaries" in sql for sql in delete_statements)
    assert any("DELETE FROM child_chunks" in sql for sql in delete_statements)
    assert any("DELETE FROM segment_attachment_bindings" in sql for sql in delete_statements)
    assert session.rollback.call_count == 1
    assert session.commit.call_count == 2


def test_delete_segment_cleanup_failure_does_not_escape_when_relational_fallback_also_fails() -> None:
    dataset = _dataset()
    document = _document(dataset)
    session = MagicMock()
    session.scalar.side_effect = [dataset, document]
    session.execute.side_effect = RuntimeError("database cleanup unavailable")
    processor = MagicMock()
    processor.clean.side_effect = RuntimeError("vector backend unavailable")

    with (
        patch("tasks.delete_segment_from_index_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        delete_segment_from_index_task.run([], dataset.id, document.id, ["segment-1"])

    session.execute.assert_called_once()
    assert session.rollback.call_count == 2
    assert session.commit.call_count == 1


def test_delete_segment_rolls_over_attachment_lookup_before_cleanup() -> None:
    dataset = _dataset(is_multimodal=True)
    document = _document(dataset)
    binding = SegmentAttachmentBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        segment_id="segment-1",
        attachment_id="attachment-1",
    )
    binding.id = "binding-1"
    session = MagicMock()
    transaction_active = False

    def scalar(*_args: object) -> object:
        nonlocal transaction_active
        transaction_active = True
        return dataset if session.scalar.call_count == 1 else document

    def scalars(*_args: object) -> MagicMock:
        nonlocal transaction_active
        transaction_active = True
        return MagicMock(all=MagicMock(return_value=[binding]))

    def commit() -> None:
        nonlocal transaction_active
        transaction_active = False

    session.scalar.side_effect = scalar
    session.scalars.side_effect = scalars
    session.commit.side_effect = commit
    processor = MagicMock()
    cleanup_transaction_states: list[bool] = []
    processor.clean.side_effect = lambda *_args, **_kwargs: cleanup_transaction_states.append(transaction_active)

    with (
        patch("tasks.delete_segment_from_index_task.session_factory.create_session", return_value=nullcontext(session)),
        patch("tasks.delete_segment_from_index_task.IndexProcessorFactory") as processor_factory,
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        delete_segment_from_index_task.run(["node-1"], dataset.id, document.id, ["segment-1"])

    assert cleanup_transaction_states == [False, False]
    assert processor.clean.call_count == 2


def test_remove_document_commits_before_summary_and_index_cleanup() -> None:
    dataset = _dataset()
    document = _document(dataset)
    segment = _segment(dataset, document)
    session = MagicMock()
    session.scalar.return_value = document
    session.scalars.return_value.all.return_value = [segment]
    session.get.return_value = dataset
    phase_events: list[str] = []
    session.commit.side_effect = lambda: phase_events.append("commit")
    processor = MagicMock()
    processor.clean.side_effect = lambda *_args, **_kwargs: phase_events.append("clean")

    def disable_summaries(**_kwargs: object) -> None:
        phase_events.append("summary")
        session.commit()

    disable_summaries_mock = MagicMock(side_effect=disable_summaries)
    with (
        patch(
            "tasks.remove_document_from_index_task.session_factory.create_session",
            return_value=nullcontext(session),
        ),
        patch("tasks.remove_document_from_index_task.IndexProcessorFactory") as processor_factory,
        patch(
            "services.summary_index_service.SummaryIndexService.disable_summaries_for_segments",
            disable_summaries_mock,
        ),
        patch("tasks.remove_document_from_index_task.redis_client.delete"),
    ):
        processor_factory.return_value.init_index_processor.return_value = processor
        remove_document_from_index_task.run(document.id)

    assert phase_events == ["commit", "summary", "commit", "clean", "commit"]
    disable_summaries_mock.assert_called_once_with(
        dataset=dataset,
        session=session,
        segment_ids=[segment.id],
        disabled_by=document.disabled_by,
    )
