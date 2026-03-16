from __future__ import annotations

from contextlib import nullcontext
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from core.indexing_runner import DocumentIsPausedError
from enums.cloud_plan import CloudPlan
from models.dataset import Dataset, Document
from tasks import document_indexing_task as task_module


class _SessionContext:
    def __init__(self, session: MagicMock) -> None:
        self._session = session

    def __enter__(self) -> MagicMock:
        return self._session

    def __exit__(self, exc_type, exc, tb) -> None:  # type: ignore[override]
        return None


class TestDocumentIndexingTask:
    """Unit tests for document indexing task flow."""

    def test_document_indexing_task_should_delegate_to_document_indexing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Test legacy task delegates to internal indexing handler."""
        # Arrange
        document_indexing_mock = MagicMock()
        monkeypatch.setattr(task_module, "_document_indexing", document_indexing_mock)

        # Act
        task_module.document_indexing_task("dataset-1", ["doc-1"])

        # Assert
        document_indexing_mock.assert_called_once_with("dataset-1", ["doc-1"])

    def test_should_return_when_dataset_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test early return when dataset does not exist."""
        # Arrange
        session = MagicMock()
        dataset_query = MagicMock()
        dataset_query.where.return_value = dataset_query
        dataset_query.first.return_value = None
        session.query.side_effect = lambda model: dataset_query

        create_session_mock = MagicMock(return_value=_SessionContext(session))
        monkeypatch.setattr(task_module.session_factory, "create_session", create_session_mock)
        features_mock = MagicMock()
        monkeypatch.setattr(task_module.FeatureService, "get_features", features_mock)

        # Act
        task_module._document_indexing("dataset-1", ["doc-1"])

        # Assert
        features_mock.assert_not_called()

    def test_should_mark_documents_error_on_feature_limit_exception(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test documents are marked error when feature limits fail."""
        # Arrange
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")

        doc1 = SimpleNamespace(id="doc-1", indexing_status=None, error=None, stopped_at=None)
        doc2 = SimpleNamespace(id="doc-2", indexing_status=None, error=None, stopped_at=None)

        dataset_query = MagicMock()
        dataset_query.where.return_value = dataset_query
        dataset_query.first.return_value = dataset

        document_query = MagicMock()
        document_query.where.return_value = document_query
        document_query.first.side_effect = [doc1, doc2]

        session = MagicMock()

        def query_side_effect(model: Any):
            if model is Dataset:
                return dataset_query
            if model is Document:
                return document_query
            return MagicMock()

        session.query.side_effect = query_side_effect

        create_session_mock = MagicMock(return_value=_SessionContext(session))
        monkeypatch.setattr(task_module.session_factory, "create_session", create_session_mock)

        features = SimpleNamespace(
            billing=SimpleNamespace(
                enabled=True,
                subscription=SimpleNamespace(plan=CloudPlan.SANDBOX),
            ),
            vector_space=SimpleNamespace(limit=0, size=0),
        )
        monkeypatch.setattr(task_module.FeatureService, "get_features", MagicMock(return_value=features))
        monkeypatch.setattr(task_module.dify_config, "BATCH_UPLOAD_LIMIT", "10")

        # Act
        task_module._document_indexing("dataset-1", ["doc-1", "doc-2"])

        # Assert
        assert doc1.indexing_status == "error"
        assert doc2.indexing_status == "error"
        assert "batch upload" in doc1.error
        session.commit.assert_called_once()

    def test_should_mark_documents_error_when_batch_upload_limit_exceeded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Test batch upload limit triggers error handling."""
        # Arrange
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = SimpleNamespace(id="doc-1", indexing_status=None, error=None, stopped_at=None)

        dataset_query = MagicMock()
        dataset_query.where.return_value = dataset_query
        dataset_query.first.return_value = dataset

        document_query = MagicMock()
        document_query.where.return_value = document_query
        document_query.first.return_value = document

        session = MagicMock()
        session.query.side_effect = lambda model: dataset_query if model is Dataset else document_query

        monkeypatch.setattr(task_module.session_factory, "create_session", MagicMock(return_value=_SessionContext(session)))

        features = SimpleNamespace(
            billing=SimpleNamespace(
                enabled=True,
                subscription=SimpleNamespace(plan=CloudPlan.PROFESSIONAL),
            ),
            vector_space=SimpleNamespace(limit=0, size=0),
        )
        monkeypatch.setattr(task_module.FeatureService, "get_features", MagicMock(return_value=features))
        monkeypatch.setattr(task_module.dify_config, "BATCH_UPLOAD_LIMIT", "1")

        # Act
        task_module._document_indexing("dataset-1", ["doc-1", "doc-2"])

        # Assert
        assert document.indexing_status == "error"
        assert "batch upload limit" in document.error
        session.commit.assert_called_once()

    def test_should_queue_summary_generation_for_completed_documents(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test summary generation is queued for eligible documents."""
        # Arrange
        dataset = SimpleNamespace(
            id="dataset-1",
            tenant_id="tenant-1",
            indexing_technique="high_quality",
            summary_index_setting={"enable": True},
        )

        doc_eligible = SimpleNamespace(
            id="doc-1",
            indexing_status="completed",
            doc_form="text",
            need_summary=True,
        )
        doc_skip_form = SimpleNamespace(
            id="doc-2",
            indexing_status="completed",
            doc_form="qa_model",
            need_summary=True,
        )
        doc_skip_status = SimpleNamespace(
            id="doc-3",
            indexing_status="processing",
            doc_form="text",
            need_summary=True,
        )

        dataset_query = MagicMock()
        dataset_query.where.return_value = dataset_query
        dataset_query.first.return_value = dataset

        phase1_docs = [SimpleNamespace(id="doc-1"), SimpleNamespace(id="doc-2"), SimpleNamespace(id="doc-3")]
        phase1_document_query = MagicMock()
        phase1_document_query.where.return_value = phase1_document_query
        phase1_document_query.all.return_value = phase1_docs

        summary_document_query = MagicMock()
        summary_document_query.where.return_value = summary_document_query
        summary_document_query.all.return_value = [doc_eligible, doc_skip_form, doc_skip_status]

        session1 = MagicMock()
        session2 = MagicMock()
        session2.begin.return_value = nullcontext()
        session3 = MagicMock()

        session1.query.side_effect = lambda model: dataset_query
        session2.query.side_effect = lambda model: phase1_document_query
        session3.query.side_effect = lambda model: summary_document_query if model is Document else dataset_query

        create_session_mock = MagicMock(
            side_effect=[_SessionContext(session1), _SessionContext(session2), _SessionContext(session3)]
        )
        monkeypatch.setattr(task_module.session_factory, "create_session", create_session_mock)

        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=False),
            vector_space=SimpleNamespace(limit=0, size=0),
        )
        monkeypatch.setattr(task_module.FeatureService, "get_features", MagicMock(return_value=features))

        indexing_runner = MagicMock()
        monkeypatch.setattr(task_module, "IndexingRunner", MagicMock(return_value=indexing_runner))
        delay_mock = MagicMock()
        monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay_mock)

        # Act
        task_module._document_indexing("dataset-1", ["doc-1", "doc-2", "doc-3"])

        # Assert
        delay_mock.assert_called_once_with("dataset-1", "doc-1", None)

    def test_should_continue_when_summary_queue_fails(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test summary queueing errors are swallowed."""
        # Arrange
        dataset = SimpleNamespace(
            id="dataset-1",
            tenant_id="tenant-1",
            indexing_technique="high_quality",
            summary_index_setting={"enable": True},
        )

        doc_eligible = SimpleNamespace(
            id="doc-1",
            indexing_status="completed",
            doc_form="text",
            need_summary=True,
        )

        dataset_query = MagicMock()
        dataset_query.where.return_value = dataset_query
        dataset_query.first.return_value = dataset

        phase1_query = MagicMock()
        phase1_query.where.return_value = phase1_query
        phase1_query.all.return_value = [SimpleNamespace(id="doc-1")]

        summary_query = MagicMock()
        summary_query.where.return_value = summary_query
        summary_query.all.return_value = [doc_eligible]

        session1 = MagicMock()
        session2 = MagicMock()
        session2.begin.return_value = nullcontext()
        session3 = MagicMock()
        session1.query.side_effect = lambda model: dataset_query
        session2.query.side_effect = lambda model: phase1_query
        session3.query.side_effect = lambda model: summary_query if model is Document else dataset_query

        monkeypatch.setattr(
            task_module.session_factory,
            "create_session",
            MagicMock(side_effect=[_SessionContext(session1), _SessionContext(session2), _SessionContext(session3)]),
        )

        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=False),
            vector_space=SimpleNamespace(limit=0, size=0),
        )
        monkeypatch.setattr(task_module.FeatureService, "get_features", MagicMock(return_value=features))

        indexing_runner = MagicMock()
        monkeypatch.setattr(task_module, "IndexingRunner", MagicMock(return_value=indexing_runner))
        delay_mock = MagicMock(side_effect=Exception("boom"))
        monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay_mock)

        # Act
        task_module._document_indexing("dataset-1", ["doc-1"])

        # Assert
        delay_mock.assert_called_once_with("dataset-1", "doc-1", None)

    def test_should_return_when_dataset_missing_after_indexing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test early return when dataset is missing after indexing."""
        # Arrange
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        dataset_query = MagicMock()
        dataset_query.where.return_value = dataset_query
        dataset_query.first.side_effect = [dataset, None]

        document_query = MagicMock()
        document_query.where.return_value = document_query
        document_query.all.return_value = [SimpleNamespace(id="doc-1")]

        session1 = MagicMock()
        session2 = MagicMock()
        session2.begin.return_value = nullcontext()
        session3 = MagicMock()
        session1.query.side_effect = lambda model: dataset_query
        session2.query.side_effect = lambda model: document_query
        session3.query.side_effect = lambda model: dataset_query

        monkeypatch.setattr(
            task_module.session_factory,
            "create_session",
            MagicMock(side_effect=[_SessionContext(session1), _SessionContext(session2), _SessionContext(session3)]),
        )

        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=False),
            vector_space=SimpleNamespace(limit=0, size=0),
        )
        monkeypatch.setattr(task_module.FeatureService, "get_features", MagicMock(return_value=features))
        monkeypatch.setattr(task_module, "IndexingRunner", MagicMock(return_value=MagicMock()))

        # Act
        task_module._document_indexing("dataset-1", ["doc-1"])

        # Assert
        session3.query.assert_called()

    def test_should_skip_summary_when_not_high_quality(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test summary generation skipped when indexing_technique is not high_quality."""
        # Arrange
        dataset = SimpleNamespace(
            id="dataset-1",
            tenant_id="tenant-1",
            indexing_technique="economy",
            summary_index_setting={"enable": True},
        )
        dataset_query = MagicMock()
        dataset_query.where.return_value = dataset_query
        dataset_query.first.return_value = dataset

        document_query = MagicMock()
        document_query.where.return_value = document_query
        document_query.all.return_value = [SimpleNamespace(id="doc-1")]

        session1 = MagicMock()
        session2 = MagicMock()
        session2.begin.return_value = nullcontext()
        session3 = MagicMock()
        session1.query.side_effect = lambda model: dataset_query
        session2.query.side_effect = lambda model: document_query
        session3.query.side_effect = lambda model: dataset_query

        monkeypatch.setattr(
            task_module.session_factory,
            "create_session",
            MagicMock(side_effect=[_SessionContext(session1), _SessionContext(session2), _SessionContext(session3)]),
        )

        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=False),
            vector_space=SimpleNamespace(limit=0, size=0),
        )
        monkeypatch.setattr(task_module.FeatureService, "get_features", MagicMock(return_value=features))
        monkeypatch.setattr(task_module, "IndexingRunner", MagicMock(return_value=MagicMock()))

        delay_mock = MagicMock()
        monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay_mock)

        # Act
        task_module._document_indexing("dataset-1", ["doc-1"])

        # Assert
        delay_mock.assert_not_called()

    def test_should_skip_summary_generation_when_indexing_paused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test summary generation is skipped when indexing is paused."""
        # Arrange
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        dataset_query = MagicMock()
        dataset_query.where.return_value = dataset_query
        dataset_query.first.return_value = dataset

        document_query = MagicMock()
        document_query.where.return_value = document_query
        document_query.all.return_value = [SimpleNamespace(id="doc-1")]

        session1 = MagicMock()
        session2 = MagicMock()
        session2.begin.return_value = nullcontext()
        session1.query.side_effect = lambda model: dataset_query
        session2.query.side_effect = lambda model: document_query

        create_session_mock = MagicMock(side_effect=[_SessionContext(session1), _SessionContext(session2)])
        monkeypatch.setattr(task_module.session_factory, "create_session", create_session_mock)

        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=False),
            vector_space=SimpleNamespace(limit=0, size=0),
        )
        monkeypatch.setattr(task_module.FeatureService, "get_features", MagicMock(return_value=features))

        runner = MagicMock()
        runner.run.side_effect = DocumentIsPausedError("paused")
        monkeypatch.setattr(task_module, "IndexingRunner", MagicMock(return_value=runner))
        delay_mock = MagicMock()
        monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay_mock)

        # Act
        task_module._document_indexing("dataset-1", ["doc-1"])

        # Assert
        delay_mock.assert_not_called()

    def test_should_handle_indexing_runner_exception(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test generic indexing runner exception is handled."""
        # Arrange
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        dataset_query = MagicMock()
        dataset_query.where.return_value = dataset_query
        dataset_query.first.return_value = dataset

        document_query = MagicMock()
        document_query.where.return_value = document_query
        document_query.all.return_value = [SimpleNamespace(id="doc-1")]

        session1 = MagicMock()
        session2 = MagicMock()
        session2.begin.return_value = nullcontext()
        session1.query.side_effect = lambda model: dataset_query
        session2.query.side_effect = lambda model: document_query

        monkeypatch.setattr(
            task_module.session_factory,
            "create_session",
            MagicMock(side_effect=[_SessionContext(session1), _SessionContext(session2)]),
        )

        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=False),
            vector_space=SimpleNamespace(limit=0, size=0),
        )
        monkeypatch.setattr(task_module.FeatureService, "get_features", MagicMock(return_value=features))

        runner = MagicMock()
        runner.run.side_effect = RuntimeError("boom")
        monkeypatch.setattr(task_module, "IndexingRunner", MagicMock(return_value=runner))

        delay_mock = MagicMock()
        monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay_mock)

        # Act
        task_module._document_indexing("dataset-1", ["doc-1"])

        # Assert
        delay_mock.assert_not_called()

    def test_should_log_missing_document_entry_in_summary_list(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test falsey document entries are handled in summary iteration."""
        # Arrange
        class _FalseyDocument:
            def __init__(self, doc_id: str) -> None:
                self.id = doc_id

            def __bool__(self) -> bool:
                return False

        dataset = SimpleNamespace(
            id="dataset-1",
            tenant_id="tenant-1",
            indexing_technique="high_quality",
            summary_index_setting={"enable": True},
        )
        dataset_query = MagicMock()
        dataset_query.where.return_value = dataset_query
        dataset_query.first.return_value = dataset

        phase1_query = MagicMock()
        phase1_query.where.return_value = phase1_query
        phase1_query.all.return_value = [SimpleNamespace(id="doc-1")]

        summary_query = MagicMock()
        summary_query.where.return_value = summary_query
        summary_query.all.return_value = [_FalseyDocument("missing-doc")]

        session1 = MagicMock()
        session2 = MagicMock()
        session2.begin.return_value = nullcontext()
        session3 = MagicMock()
        session1.query.side_effect = lambda model: dataset_query
        session2.query.side_effect = lambda model: phase1_query
        session3.query.side_effect = lambda model: summary_query if model is Document else dataset_query

        monkeypatch.setattr(
            task_module.session_factory,
            "create_session",
            MagicMock(side_effect=[_SessionContext(session1), _SessionContext(session2), _SessionContext(session3)]),
        )

        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=False),
            vector_space=SimpleNamespace(limit=0, size=0),
        )
        monkeypatch.setattr(task_module.FeatureService, "get_features", MagicMock(return_value=features))
        monkeypatch.setattr(task_module, "IndexingRunner", MagicMock(return_value=MagicMock()))

        delay_mock = MagicMock()
        monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay_mock)

        # Act
        task_module._document_indexing("dataset-1", ["doc-1"])

        # Assert
        delay_mock.assert_not_called()


class TestDocumentIndexingTenantQueue:
    """Unit tests for tenant queue handling."""

    def test_should_apply_next_tasks_when_present(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test enqueuing next tasks when queue has pending items."""
        # Arrange
        monkeypatch.setattr(task_module, "_document_indexing", MagicMock())
        monkeypatch.setattr(task_module.dify_config, "TENANT_ISOLATED_TASK_CONCURRENCY", 2)

        queue = MagicMock()
        queue.pull_tasks.return_value = [
            {"tenant_id": "tenant-1", "dataset_id": "dataset-1", "document_ids": ["doc-1"]}
        ]
        monkeypatch.setattr(task_module, "TenantIsolatedTaskQueue", MagicMock(return_value=queue))

        producer_ctx = nullcontext("producer")
        monkeypatch.setattr(task_module.current_app, "producer_or_acquire", MagicMock(return_value=producer_ctx))

        task_func = MagicMock()

        # Act
        task_module._document_indexing_with_tenant_queue("tenant-1", "dataset-1", ["doc-1"], task_func)

        # Assert
        queue.set_task_waiting_time.assert_called_once()
        task_func.apply_async.assert_called_once()

    def test_should_clear_queue_when_no_next_tasks(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test clearing queue state when no tasks remain."""
        # Arrange
        monkeypatch.setattr(task_module, "_document_indexing", MagicMock())
        queue = MagicMock()
        queue.pull_tasks.return_value = []
        monkeypatch.setattr(task_module, "TenantIsolatedTaskQueue", MagicMock(return_value=queue))

        task_func = MagicMock()

        # Act
        task_module._document_indexing_with_tenant_queue("tenant-1", "dataset-1", ["doc-1"], task_func)

        # Assert
        queue.delete_task_key.assert_called_once()

    def test_should_continue_queue_processing_on_indexing_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test queue processing continues when indexing raises."""
        # Arrange
        monkeypatch.setattr(task_module, "_document_indexing", MagicMock(side_effect=RuntimeError("boom")))
        queue = MagicMock()
        queue.pull_tasks.return_value = []
        monkeypatch.setattr(task_module, "TenantIsolatedTaskQueue", MagicMock(return_value=queue))

        task_func = MagicMock()

        # Act
        task_module._document_indexing_with_tenant_queue("tenant-1", "dataset-1", ["doc-1"], task_func)

        # Assert
        queue.delete_task_key.assert_called_once()

    def test_normal_document_indexing_task_should_delegate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test normal indexing task delegates to tenant queue handler."""
        # Arrange
        handler = MagicMock()
        monkeypatch.setattr(task_module, "_document_indexing_with_tenant_queue", handler)

        # Act
        task_module.normal_document_indexing_task("tenant-1", "dataset-1", ["doc-1"])

        # Assert
        handler.assert_called_once_with("tenant-1", "dataset-1", ["doc-1"], task_module.normal_document_indexing_task)

    def test_priority_document_indexing_task_should_delegate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test priority indexing task delegates to tenant queue handler."""
        # Arrange
        handler = MagicMock()
        monkeypatch.setattr(task_module, "_document_indexing_with_tenant_queue", handler)

        # Act
        task_module.priority_document_indexing_task("tenant-1", "dataset-1", ["doc-1"])

        # Assert
        handler.assert_called_once_with(
            "tenant-1", "dataset-1", ["doc-1"], task_module.priority_document_indexing_task
        )
