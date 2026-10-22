"""Unit tests for queue/wrapper behaviors in duplicate document indexing tasks (non-database logic)."""

import json
import uuid
from collections.abc import Sequence
from contextlib import nullcontext
from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest
from sqlalchemy.orm import Session

import tasks.duplicate_document_indexing_task as task_module
from enums import DeploymentEdition
from models.dataset import Dataset, Document
from models.enums import IndexingStatus
from services.knowledge.resource_scope import DocumentRef
from tasks.duplicate_document_indexing_task import (
    _duplicate_document_indexing_task,
    _duplicate_document_indexing_task_with_tenant_queue,
    duplicate_document_indexing_task,
    normal_duplicate_document_indexing_task,
    priority_duplicate_document_indexing_task,
)
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.model_factories import make_dataset, make_document


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

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_duplicate_document_indexing_task_calls_core_function(
        self, mock_core_func: MagicMock, dataset_id: str, document_ids: list[str]
    ) -> None:
        """Test that duplicate_document_indexing_task calls the core _duplicate_document_indexing_task function."""
        # Act
        duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        mock_core_func.assert_called_once_with(dataset_id, document_ids)

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_duplicate_document_indexing_task_with_empty_document_ids(
        self, mock_core_func: MagicMock, dataset_id: str
    ) -> None:
        """Test duplicate_document_indexing_task with empty document_ids list."""
        # Arrange
        document_ids = []

        # Act
        duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        mock_core_func.assert_called_once_with(dataset_id, document_ids)


@pytest.mark.parametrize("sqlite_session", [(Dataset, Document)], indirect=True)
def test_skips_duplicate_indexing_when_dataset_is_deleted_before_locked_admission(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = make_dataset(dataset_id=str(uuid.uuid4()), tenant_id=tenant_id)
    document = make_document(dataset_id=dataset.id, tenant_id=tenant_id)
    document.indexing_status = IndexingStatus.WAITING
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()

    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        lambda: Session(bind=sqlite_session.get_bind(), expire_on_commit=False),
    )
    monkeypatch.setattr(task_module, "dataset_operation_lock", lambda _dataset_id: nullcontext())
    monkeypatch.setattr(task_module, "lock_dataset_row", lambda _session, _dataset_id: None)
    with (
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY),
        patch.object(task_module, "IndexProcessorFactory") as processor_factory,
        patch.object(task_module, "build_document_indexing_service") as indexing_builder,
    ):
        task_module._duplicate_document_indexing_task(dataset.id, [document.id])

    processor_factory.assert_not_called()
    indexing_builder.assert_not_called()
    sqlite_session.refresh(document)
    assert document.indexing_status == IndexingStatus.WAITING


@pytest.mark.parametrize("sqlite_session", [(Dataset, Document)], indirect=True)
def test_commits_parsing_status_before_duplicate_indexing_starts(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = make_dataset(dataset_id=str(uuid.uuid4()), tenant_id=tenant_id)
    document = make_document(dataset_id=dataset.id, tenant_id=tenant_id)
    document.indexing_status = IndexingStatus.WAITING
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()
    bind = sqlite_session.get_bind()

    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        lambda: Session(bind=bind, expire_on_commit=False),
    )
    monkeypatch.setattr(task_module, "dataset_operation_lock", lambda _dataset_id: nullcontext())

    def assert_status_committed(document_refs: Sequence[DocumentRef]) -> None:
        with Session(bind=bind) as observer:
            stored_document = observer.get(Document, document.id)
            assert stored_document is not None
            assert stored_document.indexing_status == IndexingStatus.PARSING
        assert len(document_refs) == 1

    with (
        config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY),
        patch.object(task_module, "IndexProcessorFactory"),
        patch.object(task_module, "build_document_indexing_service") as runner,
    ):
        runner.return_value.run.side_effect = assert_status_committed
        task_module._duplicate_document_indexing_task(dataset.id, [document.id])
        runner.return_value.run.assert_called_once()


class TestDuplicateDocumentIndexingTaskWithTenantQueue:
    """Tests for _duplicate_document_indexing_task_with_tenant_queue function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    @pytest.mark.usefixtures("tenant_queue_commands")
    def test_tenant_queue_wrapper_calls_core_function(
        self,
        mock_core_func: MagicMock,
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
        mock_core_func.assert_called_once_with(dataset_id, document_ids)

    @patch(
        "tasks.duplicate_document_indexing_task._duplicate_document_indexing_task",
        new=create_autospec(_duplicate_document_indexing_task),
    )
    def test_tenant_queue_wrapper_deletes_key_when_no_tasks(
        self,
        tenant_queue_commands: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that tenant queue wrapper deletes task key when no more tasks."""
        # Arrange
        mock_task_func = Mock()
        tenant_queue_commands.return_value = None

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        tenant_queue_commands.assert_any_call("DEL", f"tenant_duplicate_document_indexing_task:{tenant_id}")

    @patch(
        "tasks.duplicate_document_indexing_task._duplicate_document_indexing_task",
        new=create_autospec(_duplicate_document_indexing_task),
    )
    def test_tenant_queue_wrapper_processes_next_tasks(
        self,
        tenant_queue_commands: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
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

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        tenant_queue_commands.assert_any_call("SETEX", f"tenant_duplicate_document_indexing_task:{tenant_id}", 3600, 1)
        mock_task_func.delay.assert_called_once_with(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
        )

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_tenant_queue_wrapper_handles_core_function_error(
        self,
        mock_core_func: MagicMock,
        tenant_queue_commands: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that tenant queue wrapper handles errors from core function."""
        # Arrange
        mock_task_func = Mock()
        mock_core_func.side_effect = Exception("Core function error")

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        # Should still check for next tasks even after error
        tenant_queue_commands.assert_any_call("RPOP", f"tenant_self_duplicate_document_indexing_task_queue:{tenant_id}")


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
