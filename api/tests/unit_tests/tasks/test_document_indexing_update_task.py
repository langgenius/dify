"""
Unit tests for document_indexing_update_task summary generation.

After updating a document via the API, the summary index should be
regenerated under the same conditions as during initial creation:
- indexing_technique is HIGH_QUALITY
- summary_index_setting has enable=True
- document.indexing_status is COMPLETED
- document.doc_form is not QA_INDEX
- document.need_summary is True
"""

from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.indexing_runner import DocumentIsPausedError
from tasks.document_indexing_update_task import document_indexing_update_task


class _SessionContext:
    """Minimal context manager that yields a mock session."""

    def __init__(self, session: MagicMock) -> None:
        self._session = session

    def __enter__(self) -> MagicMock:
        return self._session

    def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[override]
        return None


def _make_dataset_and_documents(
    *,
    dataset_id: str = "ds-1",
    document_id: str = "doc-1",
    indexing_technique: str = "high_quality",
    summary_index_setting: dict | None = None,
    doc_form: str = "text_model",
    need_summary: bool = True,
):
    """Create mock dataset and document objects.

    Returns (dataset, doc_for_session1, doc_for_session3).

    session1 doc: before IndexingRunner runs (status irrelevant for summary).
    session3 doc: re-queried after IndexingRunner completes — normally COMPLETED.
    """
    dataset = SimpleNamespace(
        id=dataset_id,
        indexing_technique=indexing_technique,
        summary_index_setting=summary_index_setting,
    )
    doc_s1 = SimpleNamespace(
        id=document_id,
        dataset_id=dataset_id,
        indexing_status="waiting",
        doc_form=doc_form,
        need_summary=need_summary,
    )
    # After IndexingRunner.run the document status is COMPLETED in the DB
    doc_s3 = SimpleNamespace(
        id=document_id,
        dataset_id=dataset_id,
        indexing_status="completed",
        doc_form=doc_form,
        need_summary=need_summary,
    )
    return dataset, doc_s1, doc_s3


def _patch_all(monkeypatch: pytest.MonkeyPatch, *, sessions, runner, processor):
    """Wire up all mocks for document_indexing_update_task."""
    monkeypatch.setattr(
        "tasks.document_indexing_update_task.session_factory.create_session",
        MagicMock(side_effect=sessions),
    )
    monkeypatch.setattr(
        "tasks.document_indexing_update_task.IndexProcessorFactory",
        MagicMock(return_value=MagicMock(init_index_processor=MagicMock(return_value=processor))),
    )
    monkeypatch.setattr(
        "tasks.document_indexing_update_task.IndexingRunner",
        MagicMock(return_value=runner),
    )


def _session_with_begin():
    """Create a mock session with a begin() context manager."""
    s = MagicMock()
    s.begin.return_value = nullcontext()
    return s


class TestUpdateTaskSummaryGeneration:
    """Tests for summary index generation in the document update task.

    The update task creates sessions in this order:
      1. session1: fetch document + dataset + segments (uses begin())
      2. session2: delete segments — only if segments exist (uses begin())
      3. session3: summary check — only if indexing succeeded (no begin())

    With empty segments (default), only sessions 1 and 3 are created.
    """

    def test_should_queue_summary_when_conditions_met(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Summary task is queued when all conditions are met."""
        dataset, doc_s1, doc_s3 = _make_dataset_and_documents(
            summary_index_setting={"enable": True},
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))

        session3 = MagicMock()
        session3.scalar.side_effect = [dataset, doc_s3]

        runner = MagicMock()
        processor = MagicMock()

        _patch_all(
            monkeypatch,
            sessions=[_SessionContext(session1), _SessionContext(session3)],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_called_once_with("ds-1", "doc-1", None)

    def test_should_not_queue_when_not_high_quality(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Summary is skipped when indexing_technique is not high_quality."""
        dataset, doc_s1, _ = _make_dataset_and_documents(
            indexing_technique="economy",
            summary_index_setting={"enable": True},
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))

        session3 = MagicMock()
        session3.scalar.return_value = dataset  # dataset.indexing_technique == "economy"

        runner = MagicMock()
        processor = MagicMock()

        _patch_all(
            monkeypatch,
            sessions=[_SessionContext(session1), _SessionContext(session3)],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_not_called()

    def test_should_not_queue_when_summary_setting_disabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Summary is skipped when summary_index_setting has enable=False."""
        dataset, doc_s1, _ = _make_dataset_and_documents(
            summary_index_setting={"enable": False},
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))

        session3 = MagicMock()
        session3.scalar.return_value = dataset

        runner = MagicMock()
        processor = MagicMock()

        _patch_all(
            monkeypatch,
            sessions=[_SessionContext(session1), _SessionContext(session3)],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_not_called()

    def test_should_not_queue_when_summary_setting_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Summary is skipped when summary_index_setting is None."""
        dataset, doc_s1, _ = _make_dataset_and_documents(
            summary_index_setting=None,
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))

        session3 = MagicMock()
        session3.scalar.return_value = dataset

        runner = MagicMock()
        processor = MagicMock()

        _patch_all(
            monkeypatch,
            sessions=[_SessionContext(session1), _SessionContext(session3)],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_not_called()

    def test_should_not_queue_when_need_summary_false(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Summary is skipped when document.need_summary is False."""
        dataset, doc_s1, doc_s3 = _make_dataset_and_documents(
            summary_index_setting={"enable": True},
            need_summary=False,
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))

        session3 = MagicMock()
        session3.scalar.side_effect = [dataset, doc_s3]

        runner = MagicMock()
        processor = MagicMock()

        _patch_all(
            monkeypatch,
            sessions=[_SessionContext(session1), _SessionContext(session3)],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_not_called()

    def test_should_not_queue_when_qa_index_form(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Summary is skipped when doc_form is QA_INDEX."""
        dataset, doc_s1, doc_s3 = _make_dataset_and_documents(
            summary_index_setting={"enable": True},
            doc_form="qa_model",
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))

        session3 = MagicMock()
        session3.scalar.side_effect = [dataset, doc_s3]

        runner = MagicMock()
        processor = MagicMock()

        _patch_all(
            monkeypatch,
            sessions=[_SessionContext(session1), _SessionContext(session3)],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_not_called()

    def test_should_not_queue_when_indexing_fails(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Summary is skipped when IndexingRunner.run raises."""
        dataset, doc_s1, _ = _make_dataset_and_documents(
            summary_index_setting={"enable": True},
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))

        runner = MagicMock()
        runner.run.side_effect = Exception("indexing failed")
        processor = MagicMock()

        # Only session1 needed — task returns early after indexing failure
        _patch_all(
            monkeypatch,
            sessions=[_SessionContext(session1)],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_not_called()

    def test_should_not_queue_when_document_is_paused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Summary is skipped when IndexingRunner raises DocumentIsPausedError."""

        dataset, doc_s1, _ = _make_dataset_and_documents(
            summary_index_setting={"enable": True},
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))

        runner = MagicMock()
        runner.run.side_effect = DocumentIsPausedError("doc-1 is paused")
        processor = MagicMock()

        # Only session1 needed — task returns early after paused error
        _patch_all(
            monkeypatch,
            sessions=[_SessionContext(session1)],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_not_called()

    def test_should_not_queue_when_dataset_not_found_after_indexing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Summary is skipped when the dataset disappears after indexing."""
        dataset, doc_s1, _ = _make_dataset_and_documents(
            summary_index_setting={"enable": True},
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))

        # Session 3: dataset is None
        session3 = MagicMock()
        session3.scalar.return_value = None

        runner = MagicMock()
        processor = MagicMock()

        _patch_all(
            monkeypatch,
            sessions=[_SessionContext(session1), _SessionContext(session3)],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_not_called()

    def test_should_not_queue_when_document_not_completed_after_indexing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Summary is skipped when document indexing_status is not COMPLETED after indexing."""
        dataset, doc_s1, _ = _make_dataset_and_documents(
            summary_index_setting={"enable": True},
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))

        # Document still in error status after indexing
        doc_s3_error = SimpleNamespace(
            id="doc-1",
            dataset_id="ds-1",
            indexing_status="error",
            doc_form="text_model",
            need_summary=True,
        )
        session3 = MagicMock()
        session3.scalar.side_effect = [dataset, doc_s3_error]

        runner = MagicMock()
        processor = MagicMock()

        _patch_all(
            monkeypatch,
            sessions=[_SessionContext(session1), _SessionContext(session3)],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_not_called()

    def test_should_swallow_summary_queue_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Task should not raise when generate_summary_index_task.delay raises."""
        dataset, doc_s1, doc_s3 = _make_dataset_and_documents(
            summary_index_setting={"enable": True},
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[]))

        session3 = MagicMock()
        session3.scalar.side_effect = [dataset, doc_s3]

        runner = MagicMock()
        processor = MagicMock()

        _patch_all(
            monkeypatch,
            sessions=[_SessionContext(session1), _SessionContext(session3)],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock(side_effect=Exception("queue full"))
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        # Should not raise
        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_called_once_with("ds-1", "doc-1", None)

    def test_should_queue_summary_with_segments_and_session2(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """When segments exist, session2 is also created for deletion.
        Verify summary generation still works correctly."""
        dataset, doc_s1, doc_s3 = _make_dataset_and_documents(
            summary_index_setting={"enable": True},
        )

        session1 = _session_with_begin()
        session1.scalar.side_effect = [doc_s1, dataset]
        seg = SimpleNamespace(index_node_id="node-1")
        session1.scalars.return_value = MagicMock(all=MagicMock(return_value=[seg]))

        # Session 2: segment deletion
        session2 = _session_with_begin()

        session3 = MagicMock()
        session3.scalar.side_effect = [dataset, doc_s3]

        runner = MagicMock()
        processor = MagicMock()

        _patch_all(
            monkeypatch,
            sessions=[
                _SessionContext(session1),
                _SessionContext(session2),
                _SessionContext(session3),
            ],
            runner=runner,
            processor=processor,
        )

        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.document_indexing_update_task.generate_summary_index_task.delay",
            delay_mock,
        )

        document_indexing_update_task("ds-1", "doc-1")

        delay_mock.assert_called_once_with("ds-1", "doc-1", None)
