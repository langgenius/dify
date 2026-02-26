"""Integration tests for dataset indexing task SQL behaviors using testcontainers."""

import uuid
from collections.abc import Sequence
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from core.indexing_runner import DocumentIsPausedError
from enums.cloud_plan import CloudPlan
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document
from tasks.document_indexing_task import (
    _document_indexing,
    _document_indexing_with_tenant_queue,
    document_indexing_task,
    normal_document_indexing_task,
    priority_document_indexing_task,
)


class _TrackedSessionContext:
    def __init__(self, original_context_manager, opened_sessions: list, closed_sessions: list):
        self._original_context_manager = original_context_manager
        self._opened_sessions = opened_sessions
        self._closed_sessions = closed_sessions
        self._close_patcher = None
        self._session = None

    def __enter__(self):
        self._session = self._original_context_manager.__enter__()
        self._opened_sessions.append(self._session)
        original_close = self._session.close

        def _tracked_close(*args, **kwargs):
            self._closed_sessions.append(self._session)
            return original_close(*args, **kwargs)

        self._close_patcher = patch.object(self._session, "close", side_effect=_tracked_close)
        self._close_patcher.start()
        return self._session

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            return self._original_context_manager.__exit__(exc_type, exc_val, exc_tb)
        finally:
            if self._close_patcher is not None:
                self._close_patcher.stop()


@pytest.fixture(autouse=True)
def _ensure_testcontainers_db(db_session_with_containers):
    """Ensure this suite always runs on testcontainers infrastructure."""
    return db_session_with_containers


@pytest.fixture
def session_close_tracker():
    """Track all sessions opened by session_factory and which were closed."""
    opened_sessions = []
    closed_sessions = []

    from tasks import document_indexing_task as task_module

    original_create_session = task_module.session_factory.create_session

    def _tracked_create_session(*args, **kwargs):
        original_context_manager = original_create_session(*args, **kwargs)
        return _TrackedSessionContext(original_context_manager, opened_sessions, closed_sessions)

    with patch.object(task_module.session_factory, "create_session", side_effect=_tracked_create_session):
        yield {"opened_sessions": opened_sessions, "closed_sessions": closed_sessions}


@pytest.fixture
def mock_external_service_dependencies():
    """Patch non-DB collaborators while keeping database behavior real."""
    with (
        patch("tasks.document_indexing_task.IndexingRunner") as mock_indexing_runner,
        patch("tasks.document_indexing_task.FeatureService") as mock_feature_service,
        patch("tasks.document_indexing_task.generate_summary_index_task") as mock_summary_task,
    ):
        mock_runner_instance = MagicMock()
        mock_indexing_runner.return_value = mock_runner_instance

        mock_features = MagicMock()
        mock_features.billing.enabled = False
        mock_features.billing.subscription.plan = CloudPlan.PROFESSIONAL
        mock_features.vector_space.limit = 100
        mock_features.vector_space.size = 0
        mock_feature_service.get_features.return_value = mock_features

        yield {
            "indexing_runner": mock_indexing_runner,
            "indexing_runner_instance": mock_runner_instance,
            "feature_service": mock_feature_service,
            "features": mock_features,
            "summary_task": mock_summary_task,
        }


class TestDatasetIndexingTaskIntegration:
    """1:1 SQL test migration from unit tests to testcontainers integration tests."""

    def _create_test_dataset_and_documents(
        self,
        db_session_with_containers,
        *,
        document_count: int = 3,
        document_ids: Sequence[str] | None = None,
    ) -> tuple[Dataset, list[Document]]:
        """Create a tenant dataset and waiting documents used by indexing tests."""
        fake = Faker()

        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(name=fake.company(), status="normal")
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        dataset = Dataset(
            id=fake.uuid4(),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="upload_file",
            indexing_technique="high_quality",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        if document_ids is None:
            document_ids = [str(uuid.uuid4()) for _ in range(document_count)]

        documents = []
        for position, document_id in enumerate(document_ids):
            document = Document(
                id=document_id,
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=position,
                data_source_type="upload_file",
                batch="test_batch",
                name=f"doc-{position}.txt",
                created_from="upload_file",
                created_by=account.id,
                indexing_status="waiting",
                enabled=True,
            )
            db_session_with_containers.add(document)
            documents.append(document)

        db_session_with_containers.commit()
        db_session_with_containers.refresh(dataset)

        return dataset, documents

    def _query_document(self, db_session_with_containers, document_id: str) -> Document | None:
        """Return the latest persisted document state."""
        return db_session_with_containers.query(Document).where(Document.id == document_id).first()

    def _assert_documents_parsing(self, db_session_with_containers, document_ids: Sequence[str]) -> None:
        """Assert all target documents are persisted in parsing status."""
        db_session_with_containers.expire_all()
        for document_id in document_ids:
            updated = self._query_document(db_session_with_containers, document_id)
            assert updated is not None
            assert updated.indexing_status == "parsing"
            assert updated.processing_started_at is not None

    def _assert_documents_error_contains(
        self,
        db_session_with_containers,
        document_ids: Sequence[str],
        expected_error_substring: str,
    ) -> None:
        """Assert all target documents are persisted in error status with message."""
        db_session_with_containers.expire_all()
        for document_id in document_ids:
            updated = self._query_document(db_session_with_containers, document_id)
            assert updated is not None
            assert updated.indexing_status == "error"
            assert updated.error is not None
            assert expected_error_substring in updated.error
            assert updated.stopped_at is not None

    def test_legacy_document_indexing_task_still_works(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Ensure the legacy task entrypoint still updates parsing status."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]

        # Act
        document_indexing_task(dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()
        self._assert_documents_parsing(db_session_with_containers, document_ids)

    def test_batch_processing_multiple_documents(self, db_session_with_containers, mock_external_service_dependencies):
        """Process multiple documents in one batch."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=3)
        document_ids = [doc.id for doc in documents]

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()
        run_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args[0][0]
        assert len(run_args) == len(document_ids)
        self._assert_documents_parsing(db_session_with_containers, document_ids)

    def test_batch_processing_with_limit_check(self, db_session_with_containers, mock_external_service_dependencies):
        """Reject batches larger than configured upload limit."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=3)
        document_ids = [doc.id for doc in documents]
        features = mock_external_service_dependencies["features"]
        features.billing.enabled = True
        features.billing.subscription.plan = CloudPlan.PROFESSIONAL
        features.vector_space.limit = 100
        features.vector_space.size = 50

        # Act
        with patch("tasks.document_indexing_task.dify_config.BATCH_UPLOAD_LIMIT", "2"):
            _document_indexing(dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()
        self._assert_documents_error_contains(db_session_with_containers, document_ids, "batch upload limit")

    def test_batch_processing_sandbox_plan_single_document_only(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Reject multi-document upload under sandbox plan."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]
        features = mock_external_service_dependencies["features"]
        features.billing.enabled = True
        features.billing.subscription.plan = CloudPlan.SANDBOX

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()
        self._assert_documents_error_contains(db_session_with_containers, document_ids, "does not support batch upload")

    def test_batch_processing_empty_document_list(self, db_session_with_containers, mock_external_service_dependencies):
        """Handle empty list input without failing."""
        # Arrange
        dataset, _ = self._create_test_dataset_and_documents(db_session_with_containers, document_count=0)

        # Act
        _document_indexing(dataset.id, [])

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once_with([])

    def test_document_status_progression(self, db_session_with_containers, mock_external_service_dependencies):
        """Transition document status from waiting to parsing before runner execution."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=3)
        document_ids = [doc.id for doc in documents]

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        self._assert_documents_parsing(db_session_with_containers, document_ids)

    def test_processing_started_timestamp_set(self, db_session_with_containers, mock_external_service_dependencies):
        """Persist processing_started_at for every document in the batch."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=3)
        document_ids = [doc.id for doc in documents]

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        self._assert_documents_parsing(db_session_with_containers, document_ids)

    def test_tenant_queue_processes_next_task_after_completion(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Dispatch the next queued task after current tenant task completes."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_ids = [doc.id for doc in documents]
        next_task = {
            "tenant_id": dataset.tenant_id,
            "dataset_id": dataset.id,
            "document_ids": [str(uuid.uuid4())],
        }
        mock_task_func = MagicMock()

        # Act
        with (
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks", return_value=[next_task]),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.set_task_waiting_time") as mock_set_waiting,
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.delete_task_key") as mock_delete_key,
        ):
            _document_indexing_with_tenant_queue(dataset.tenant_id, dataset.id, document_ids, mock_task_func)

        # Assert
        mock_task_func.delay.assert_called_once_with(
            tenant_id=next_task["tenant_id"],
            dataset_id=next_task["dataset_id"],
            document_ids=next_task["document_ids"],
        )
        mock_set_waiting.assert_called_once()
        mock_delete_key.assert_not_called()

    def test_tenant_queue_clears_flag_when_no_more_tasks(self, db_session_with_containers, mock_external_service_dependencies):
        """Delete tenant running flag when queue has no pending tasks."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_ids = [doc.id for doc in documents]
        mock_task_func = MagicMock()

        # Act
        with (
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks", return_value=[]),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.delete_task_key") as mock_delete_key,
        ):
            _document_indexing_with_tenant_queue(dataset.tenant_id, dataset.id, document_ids, mock_task_func)

        # Assert
        mock_task_func.delay.assert_not_called()
        mock_delete_key.assert_called_once()

    def test_error_handling_sets_document_error_status(self, db_session_with_containers, mock_external_service_dependencies):
        """Set error status when validation fails before runner phase."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=3)
        document_ids = [doc.id for doc in documents]
        features = mock_external_service_dependencies["features"]
        features.billing.enabled = True
        features.billing.subscription.plan = CloudPlan.PROFESSIONAL
        features.vector_space.limit = 100
        features.vector_space.size = 100

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()
        self._assert_documents_error_contains(db_session_with_containers, document_ids, "over the limit")

    def test_error_handling_during_indexing_runner(self, db_session_with_containers, mock_external_service_dependencies):
        """Catch generic runner exceptions without crashing the task."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = Exception("runner failed")

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()
        self._assert_documents_parsing(db_session_with_containers, document_ids)

    def test_document_paused_error_handling(self, db_session_with_containers, mock_external_service_dependencies):
        """Handle DocumentIsPausedError and keep persisted state consistent."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = DocumentIsPausedError("paused")

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()
        self._assert_documents_parsing(db_session_with_containers, document_ids)

    def test_dataset_not_found_error_handling(self, mock_external_service_dependencies):
        """Exit gracefully when dataset does not exist."""
        # Arrange
        missing_dataset_id = str(uuid.uuid4())
        missing_document_id = str(uuid.uuid4())

        # Act
        _document_indexing(missing_dataset_id, [missing_document_id])

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

    def test_tenant_queue_error_handling_still_processes_next_task(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Even on current task failure, enqueue the next waiting tenant task."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_ids = [doc.id for doc in documents]
        next_task = {
            "tenant_id": dataset.tenant_id,
            "dataset_id": dataset.id,
            "document_ids": [str(uuid.uuid4())],
        }
        mock_task_func = MagicMock()

        # Act
        with (
            patch("tasks.document_indexing_task._document_indexing", side_effect=Exception("failed")),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks", return_value=[next_task]),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.set_task_waiting_time"),
        ):
            _document_indexing_with_tenant_queue(dataset.tenant_id, dataset.id, document_ids, mock_task_func)

        # Assert
        mock_task_func.delay.assert_called_once()

    def test_concurrent_task_limit_respected(self, db_session_with_containers, mock_external_service_dependencies):
        """Pull and dispatch only up to configured tenant concurrency limit."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_ids = [doc.id for doc in documents]
        concurrency_limit = 2
        pending_tasks = [
            {"tenant_id": dataset.tenant_id, "dataset_id": dataset.id, "document_ids": [f"doc_{idx}"]}
            for idx in range(5)
        ]
        mock_task_func = MagicMock()

        # Act
        with (
            patch("tasks.document_indexing_task.dify_config.TENANT_ISOLATED_TASK_CONCURRENCY", concurrency_limit),
            patch(
                "tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks",
                return_value=pending_tasks[:concurrency_limit],
            ),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.set_task_waiting_time"),
        ):
            _document_indexing_with_tenant_queue(dataset.tenant_id, dataset.id, document_ids, mock_task_func)

        # Assert
        assert mock_task_func.delay.call_count == concurrency_limit

    def test_task_key_deleted_when_queue_empty(self, db_session_with_containers, mock_external_service_dependencies):
        """Remove tenant running key when no follow-up tasks exist."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_ids = [doc.id for doc in documents]
        mock_task_func = MagicMock()

        # Act
        with (
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks", return_value=[]),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.delete_task_key") as mock_delete_key,
        ):
            _document_indexing_with_tenant_queue(dataset.tenant_id, dataset.id, document_ids, mock_task_func)

        # Assert
        mock_delete_key.assert_called_once()

    def test_session_cleanup_on_success(
        self,
        db_session_with_containers,
        mock_external_service_dependencies,
        session_close_tracker,
    ):
        """Close all opened sessions in successful indexing path."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        opened = session_close_tracker["opened_sessions"]
        closed = session_close_tracker["closed_sessions"]
        assert len(opened) >= 2
        assert len(closed) >= len(opened)

    def test_session_cleanup_on_error(
        self,
        db_session_with_containers,
        mock_external_service_dependencies,
        session_close_tracker,
    ):
        """Close opened sessions even when runner fails."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = Exception("boom")

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        opened = session_close_tracker["opened_sessions"]
        closed = session_close_tracker["closed_sessions"]
        assert len(opened) >= 2
        assert len(closed) >= len(opened)

    def test_multiple_documents_with_mixed_success_and_failure(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Process only existing documents when request includes missing ids."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        existing_ids = [doc.id for doc in documents]
        mixed_ids = [existing_ids[0], str(uuid.uuid4()), existing_ids[1]]

        # Act
        _document_indexing(dataset.id, mixed_ids)

        # Assert
        run_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args[0][0]
        assert len(run_args) == 2
        self._assert_documents_parsing(db_session_with_containers, existing_ids)

    def test_tenant_queue_with_multiple_concurrent_tasks(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Queue exactly the configured number of next tasks for a tenant."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_ids = [doc.id for doc in documents]
        concurrency_limit = 2
        pending_tasks = [
            {"tenant_id": dataset.tenant_id, "dataset_id": dataset.id, "document_ids": [f"doc_{idx}"]}
            for idx in range(5)
        ]
        mock_task_func = MagicMock()

        # Act
        with (
            patch("tasks.document_indexing_task.dify_config.TENANT_ISOLATED_TASK_CONCURRENCY", concurrency_limit),
            patch(
                "tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks",
                return_value=pending_tasks[:concurrency_limit],
            ),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.set_task_waiting_time") as mock_set_waiting,
        ):
            _document_indexing_with_tenant_queue(dataset.tenant_id, dataset.id, document_ids, mock_task_func)

        # Assert
        assert mock_task_func.delay.call_count == concurrency_limit
        assert mock_set_waiting.call_count == concurrency_limit

    def test_vector_space_limit_edge_case_at_exact_limit(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Reject upload when vector space size is exactly at plan limit."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=3)
        document_ids = [doc.id for doc in documents]
        features = mock_external_service_dependencies["features"]
        features.billing.enabled = True
        features.billing.subscription.plan = CloudPlan.PROFESSIONAL
        features.vector_space.limit = 100
        features.vector_space.size = 100

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        self._assert_documents_error_contains(db_session_with_containers, document_ids, "over the limit")

    def test_task_queue_fifo_ordering(self, db_session_with_containers, mock_external_service_dependencies):
        """Keep FIFO ordering when dispatching next queued tasks."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_ids = [doc.id for doc in documents]
        ordered_tasks = [
            {"tenant_id": dataset.tenant_id, "dataset_id": dataset.id, "document_ids": ["task_A"]},
            {"tenant_id": dataset.tenant_id, "dataset_id": dataset.id, "document_ids": ["task_B"]},
            {"tenant_id": dataset.tenant_id, "dataset_id": dataset.id, "document_ids": ["task_C"]},
        ]
        mock_task_func = MagicMock()

        # Act
        with (
            patch("tasks.document_indexing_task.dify_config.TENANT_ISOLATED_TASK_CONCURRENCY", 3),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks", return_value=ordered_tasks),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.set_task_waiting_time"),
        ):
            _document_indexing_with_tenant_queue(dataset.tenant_id, dataset.id, document_ids, mock_task_func)

        # Assert
        assert mock_task_func.delay.call_count == 3
        for index, expected_task in enumerate(ordered_tasks):
            assert mock_task_func.delay.call_args_list[index].kwargs["document_ids"] == expected_task["document_ids"]

    def test_empty_queue_after_task_completion_cleans_up(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Clean up task key when queue is empty right after completion."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_ids = [doc.id for doc in documents]
        mock_task_func = MagicMock()

        # Act
        with (
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks", return_value=[]),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.delete_task_key") as mock_delete_key,
        ):
            _document_indexing_with_tenant_queue(dataset.tenant_id, dataset.id, document_ids, mock_task_func)

        # Assert
        mock_delete_key.assert_called_once()

    def test_billing_disabled_skips_limit_checks(self, db_session_with_containers, mock_external_service_dependencies):
        """Skip limit checks when billing feature is disabled."""
        # Arrange
        large_document_ids = [str(uuid.uuid4()) for _ in range(100)]
        dataset, _ = self._create_test_dataset_and_documents(
            db_session_with_containers,
            document_ids=large_document_ids,
        )
        features = mock_external_service_dependencies["features"]
        features.billing.enabled = False

        # Act
        _document_indexing(dataset.id, large_document_ids)

        # Assert
        run_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args[0][0]
        assert len(run_args) == 100
        self._assert_documents_parsing(db_session_with_containers, large_document_ids)

    def test_complete_workflow_normal_task(self, db_session_with_containers, mock_external_service_dependencies):
        """Run end-to-end normal queue workflow with tenant queue cleanup."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]

        # Act
        with (
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks", return_value=[]),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.delete_task_key") as mock_delete_key,
        ):
            normal_document_indexing_task(dataset.tenant_id, dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()
        self._assert_documents_parsing(db_session_with_containers, document_ids)
        mock_delete_key.assert_called_once()

    def test_complete_workflow_priority_task(self, db_session_with_containers, mock_external_service_dependencies):
        """Run end-to-end priority queue workflow with tenant queue cleanup."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]

        # Act
        with (
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks", return_value=[]),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.delete_task_key") as mock_delete_key,
        ):
            priority_document_indexing_task(dataset.tenant_id, dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()
        self._assert_documents_parsing(db_session_with_containers, document_ids)
        mock_delete_key.assert_called_once()

    def test_queue_chain_processing(self, db_session_with_containers, mock_external_service_dependencies):
        """After one task finishes, enqueue the next queued task in the chain."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        task_1_ids = [doc.id for doc in documents]
        task_2_ids = [str(uuid.uuid4())]
        next_task = {
            "tenant_id": dataset.tenant_id,
            "dataset_id": dataset.id,
            "document_ids": task_2_ids,
        }
        mock_task_func = MagicMock()

        # Act
        with (
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks", return_value=[next_task]),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.set_task_waiting_time"),
        ):
            _document_indexing_with_tenant_queue(dataset.tenant_id, dataset.id, task_1_ids, mock_task_func)

        # Assert
        mock_task_func.delay.assert_called_once()
        assert mock_task_func.delay.call_args.kwargs["document_ids"] == task_2_ids

    def test_single_document_processing(self, db_session_with_containers, mock_external_service_dependencies):
        """Process the minimum batch size (single document)."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_id = documents[0].id

        # Act
        _document_indexing(dataset.id, [document_id])

        # Assert
        run_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args[0][0]
        assert len(run_args) == 1
        self._assert_documents_parsing(db_session_with_containers, [document_id])

    def test_document_with_special_characters_in_id(self, db_session_with_containers, mock_external_service_dependencies):
        """Handle standard UUID ids with hyphen characters safely."""
        # Arrange
        special_document_id = str(uuid.uuid4())
        dataset, _ = self._create_test_dataset_and_documents(
            db_session_with_containers,
            document_ids=[special_document_id],
        )

        # Act
        _document_indexing(dataset.id, [special_document_id])

        # Assert
        self._assert_documents_parsing(db_session_with_containers, [special_document_id])

    def test_zero_vector_space_limit_allows_unlimited(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Treat vector limit 0 as unlimited and continue indexing."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=3)
        document_ids = [doc.id for doc in documents]
        features = mock_external_service_dependencies["features"]
        features.billing.enabled = True
        features.billing.subscription.plan = CloudPlan.PROFESSIONAL
        features.vector_space.limit = 0
        features.vector_space.size = 1000

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()
        self._assert_documents_parsing(db_session_with_containers, document_ids)

    def test_negative_vector_space_values_handled_gracefully(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Treat negative vector limits as non-blocking and continue indexing."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=3)
        document_ids = [doc.id for doc in documents]
        features = mock_external_service_dependencies["features"]
        features.billing.enabled = True
        features.billing.subscription.plan = CloudPlan.PROFESSIONAL
        features.vector_space.limit = -1
        features.vector_space.size = 100

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()
        self._assert_documents_parsing(db_session_with_containers, document_ids)

    def test_large_document_batch_processing(self, db_session_with_containers, mock_external_service_dependencies):
        """Process a batch exactly at configured upload limit."""
        # Arrange
        batch_limit = 50
        document_ids = [str(uuid.uuid4()) for _ in range(batch_limit)]
        dataset, _ = self._create_test_dataset_and_documents(
            db_session_with_containers,
            document_ids=document_ids,
        )
        features = mock_external_service_dependencies["features"]
        features.billing.enabled = True
        features.billing.subscription.plan = CloudPlan.PROFESSIONAL
        features.vector_space.limit = 10000
        features.vector_space.size = 0

        # Act
        with patch("tasks.document_indexing_task.dify_config.BATCH_UPLOAD_LIMIT", str(batch_limit)):
            _document_indexing(dataset.id, document_ids)

        # Assert
        run_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args[0][0]
        assert len(run_args) == batch_limit
        self._assert_documents_parsing(db_session_with_containers, document_ids)

    def test_tenant_queue_handles_burst_traffic(self, db_session_with_containers, mock_external_service_dependencies):
        """Handle burst traffic by dispatching only up to concurrency limit."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_ids = [doc.id for doc in documents]
        num_tasks = 20
        concurrency_limit = 3
        pending_tasks = [
            {"tenant_id": dataset.tenant_id, "dataset_id": dataset.id, "document_ids": [f"doc_{idx}"]}
            for idx in range(num_tasks)
        ]
        mock_task_func = MagicMock()

        # Act
        with (
            patch("tasks.document_indexing_task.dify_config.TENANT_ISOLATED_TASK_CONCURRENCY", concurrency_limit),
            patch(
                "tasks.document_indexing_task.TenantIsolatedTaskQueue.pull_tasks",
                return_value=pending_tasks[:concurrency_limit],
            ),
            patch("tasks.document_indexing_task.TenantIsolatedTaskQueue.set_task_waiting_time"),
        ):
            _document_indexing_with_tenant_queue(dataset.tenant_id, dataset.id, document_ids, mock_task_func)

        # Assert
        assert mock_task_func.delay.call_count == concurrency_limit

    def test_indexing_runner_exception_does_not_crash_task(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Keep task flow resilient when runner raises unexpected runtime error."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=3)
        document_ids = [doc.id for doc in documents]
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = RuntimeError(
            "Unexpected indexing error"
        )

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()
        self._assert_documents_parsing(db_session_with_containers, document_ids)

    def test_database_session_always_closed_on_success(
        self,
        db_session_with_containers,
        mock_external_service_dependencies,
        session_close_tracker,
    ):
        """Close every opened DB session in successful execution path."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=3)
        document_ids = [doc.id for doc in documents]

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        opened = session_close_tracker["opened_sessions"]
        closed = session_close_tracker["closed_sessions"]
        assert len(opened) >= 2
        assert len(closed) >= len(opened)
