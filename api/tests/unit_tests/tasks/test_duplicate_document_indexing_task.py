"""Tests for duplicate document indexing delivery and queue behavior."""

import json
import uuid
from datetime import timedelta
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.knowledge_task import KnowledgeTaskOutbox
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind
from tasks.duplicate_document_indexing_task import (
    _duplicate_document_indexing_task_with_tenant_queue,
    duplicate_document_indexing_task,
    normal_duplicate_document_indexing_task,
    priority_duplicate_document_indexing_task,
)


@pytest.fixture
def tenant_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def dataset_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def document_ids() -> list[str]:
    return [str(uuid.uuid4()) for _ in range(3)]


class TestDuplicateDocumentIndexingTask:
    """Tests for the deprecated duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task.convert_legacy_document_indexing_delivery", autospec=True)
    def test_duplicate_document_indexing_task_converts_legacy_delivery(
        self, convert_legacy: MagicMock, dataset_id: str, document_ids: list[str]
    ) -> None:
        """The deployed two-argument task only enters the durable conversion boundary."""
        # Act
        duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        convert_legacy.assert_called_once_with(dataset_id, document_ids)


class TestDurableDuplicateDelivery:
    def test_active_duplicate_delivery_executes_worker_once(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        generations = {document_ids[0]: str(uuid.uuid4())}
        intent = KnowledgeTaskOutbox(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            task_kind=KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE.value,
            payload={},
            status="dispatched",
        )
        sqlite_session.add(intent)
        sqlite_session.commit()
        calls: list[str] = []

        def run_once(*_args, **_kwargs) -> None:
            calls.append("run")
            if len(calls) == 1:
                normal_duplicate_document_indexing_task.run(
                    tenant_id,
                    dataset_id,
                    document_ids,
                    generations,
                    intent.id,
                )

        monkeypatch.setattr(
            "tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue",
            run_once,
        )

        normal_duplicate_document_indexing_task.run(
            tenant_id,
            dataset_id,
            document_ids,
            generations,
            intent.id,
        )

        sqlite_session.expire_all()
        persisted = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
        assert persisted is not None
        assert persisted.status == "completed"
        assert persisted.execution_attempts == 1
        assert calls == ["run"]

    def test_expired_execution_lease_repairs_without_replaying_uncertain_work(
        self,
        sqlite_session: Session,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        now = naive_utc_now()
        intent = KnowledgeTaskOutbox(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            task_kind=KnowledgeTaskKind.DOCUMENT_INDEX_DUPLICATE.value,
            payload={},
            status="executing",
            execution_attempts=1,
            claim_id=str(uuid.uuid4()),
            claimed_at=now - timedelta(minutes=6),
            available_at=now - timedelta(seconds=1),
        )
        sqlite_session.add(intent)
        sqlite_session.commit()
        calls: list[str] = []

        def record(*_args, **_kwargs) -> None:
            calls.append("run")

        monkeypatch.setattr(
            "tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue",
            record,
        )

        normal_duplicate_document_indexing_task.run(
            tenant_id,
            dataset_id,
            document_ids,
            {document_ids[0]: str(uuid.uuid4())},
            intent.id,
        )

        sqlite_session.expire_all()
        persisted = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
        assert persisted is not None
        assert persisted.status == "completed"
        assert persisted.execution_attempts == 2
        assert calls == []
        assert persisted.payload["_recovered_execution"] is True

    @patch("tasks.duplicate_document_indexing_task.convert_legacy_document_indexing_delivery", autospec=True)
    def test_duplicate_document_indexing_task_with_empty_document_ids(
        self, convert_legacy: MagicMock, dataset_id: str
    ) -> None:
        """Test duplicate_document_indexing_task with empty document_ids list."""
        # Arrange
        document_ids = []

        # Act
        duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        convert_legacy.assert_called_once_with(dataset_id, document_ids)


class TestDuplicateDocumentIndexingTaskWithTenantQueue:
    """Tests for _duplicate_document_indexing_task_with_tenant_queue function."""

    @patch("tasks.duplicate_document_indexing_task.convert_legacy_document_indexing_delivery", autospec=True)
    @pytest.mark.usefixtures("tenant_queue_commands")
    def test_tenant_queue_wrapper_calls_core_function(
        self,
        convert_legacy: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that tenant queue wrapper calls the core function."""
        # Arrange
        mock_task_func = Mock()

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        convert_legacy.assert_called_once_with(dataset_id, document_ids)

    def test_tenant_queue_wrapper_deletes_key_when_no_tasks(
        self,
        tenant_queue_commands: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Test that tenant queue wrapper deletes task key when no more tasks."""
        # Arrange
        mock_task_func = Mock()
        tenant_queue_commands.return_value = None
        monkeypatch.setattr(
            "tasks.duplicate_document_indexing_task.convert_legacy_document_indexing_delivery",
            lambda _dataset_id, _document_ids: None,
        )

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        tenant_queue_commands.assert_any_call("DEL", f"tenant_duplicate_document_indexing_task:{tenant_id}")

    def test_tenant_queue_wrapper_processes_next_tasks(
        self,
        tenant_queue_commands: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Test that tenant queue wrapper processes next tasks from queue."""
        # Arrange
        mock_task_func = Mock()
        next_task = {
            "tenant_id": tenant_id,
            "dataset_id": dataset_id,
            "document_ids": document_ids,
        }
        tenant_queue_commands.side_effect = [json.dumps({"data": next_task}), None, None]
        monkeypatch.setattr(
            "tasks.duplicate_document_indexing_task.convert_legacy_document_indexing_delivery",
            lambda _dataset_id, _document_ids: None,
        )

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        tenant_queue_commands.assert_any_call("SETEX", f"tenant_duplicate_document_indexing_task:{tenant_id}", 3600, 1)
        mock_task_func.delay.assert_called_once_with(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
        )

    @patch("tasks.duplicate_document_indexing_task.convert_legacy_document_indexing_delivery", autospec=True)
    def test_tenant_queue_wrapper_propagates_conversion_error_without_advancing(
        self,
        convert_legacy: MagicMock,
        tenant_queue_commands: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that tenant queue wrapper handles errors from core function."""
        # Arrange
        mock_task_func = Mock()
        convert_legacy.side_effect = RuntimeError("database unavailable")

        # Act
        with pytest.raises(RuntimeError, match="database unavailable"):
            _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        tenant_queue_commands.assert_not_called()


class TestNormalDuplicateDocumentIndexingTask:
    """Tests for normal_duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue", autospec=True)
    def test_normal_task_calls_tenant_queue_wrapper(
        self,
        mock_wrapper_func: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that normal task calls tenant queue wrapper."""
        # Act
        normal_duplicate_document_indexing_task(tenant_id, dataset_id, document_ids)

        # Assert
        mock_wrapper_func.assert_called_once_with(
            tenant_id, dataset_id, document_ids, normal_duplicate_document_indexing_task
        )

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue", autospec=True)
    def test_normal_task_with_empty_document_ids(
        self,
        mock_wrapper_func: MagicMock,
        tenant_id: str,
        dataset_id: str,
    ) -> None:
        """Test normal task with empty document_ids list."""
        # Arrange
        document_ids = []

        # Act
        normal_duplicate_document_indexing_task(tenant_id, dataset_id, document_ids)

        # Assert
        mock_wrapper_func.assert_called_once_with(
            tenant_id, dataset_id, document_ids, normal_duplicate_document_indexing_task
        )


class TestPriorityDuplicateDocumentIndexingTask:
    """Tests for priority_duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue", autospec=True)
    def test_priority_task_calls_tenant_queue_wrapper(
        self,
        mock_wrapper_func: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that priority task calls tenant queue wrapper."""
        # Act
        priority_duplicate_document_indexing_task(tenant_id, dataset_id, document_ids)

        # Assert
        mock_wrapper_func.assert_called_once_with(
            tenant_id, dataset_id, document_ids, priority_duplicate_document_indexing_task
        )

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue", autospec=True)
    def test_priority_task_with_single_document(
        self,
        mock_wrapper_func: MagicMock,
        tenant_id: str,
        dataset_id: str,
    ) -> None:
        """Test priority task with single document."""
        # Arrange
        document_ids = ["doc-1"]

        # Act
        priority_duplicate_document_indexing_task(tenant_id, dataset_id, document_ids)

        # Assert
        mock_wrapper_func.assert_called_once_with(
            tenant_id, dataset_id, document_ids, priority_duplicate_document_indexing_task
        )

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue", autospec=True)
    def test_priority_task_with_large_batch(
        self,
        mock_wrapper_func: MagicMock,
        tenant_id: str,
        dataset_id: str,
    ) -> None:
        """Test priority task with large batch of documents."""
        # Arrange
        document_ids = [f"doc-{i}" for i in range(100)]

        # Act
        priority_duplicate_document_indexing_task(tenant_id, dataset_id, document_ids)

        # Assert
        mock_wrapper_func.assert_called_once_with(
            tenant_id, dataset_id, document_ids, priority_duplicate_document_indexing_task
        )
