"""Integration tests for dataset indexing tasks using testcontainers DB."""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from core.indexing_runner import DocumentIsPausedError
from enums.cloud_plan import CloudPlan
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document
from tasks.document_indexing_task import _document_indexing, document_indexing_task


@pytest.fixture(autouse=True)
def _ensure_testcontainers_db(db_session_with_containers):
    """Ensure this suite always runs on testcontainers infrastructure."""
    return db_session_with_containers


@pytest.fixture
def mock_external_service_dependencies():
    """Patch external services while keeping ORM reads/writes real."""
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
    """SQL-oriented integration tests migrated from the unit suite."""

    def _create_test_dataset_and_documents(self, db_session_with_containers, document_count=3):
        """Create one tenant dataset and optional waiting documents for indexing tests."""
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

        documents = []
        for position in range(document_count):
            document = Document(
                id=fake.uuid4(),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=position,
                data_source_type="upload_file",
                batch="test_batch",
                name=fake.file_name(),
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

    def _query_document(self, db_session_with_containers, document_id):
        """Load the latest persisted document state from the testcontainers DB."""
        return db_session_with_containers.query(Document).where(Document.id == document_id).first()

    def test_legacy_document_indexing_task_still_works(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Ensure the legacy task entrypoint still updates parsing state."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]

        # Act
        document_indexing_task(dataset.id, document_ids)

        # Assert
        db_session_with_containers.expire_all()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()
        for doc_id in document_ids:
            updated = self._query_document(db_session_with_containers, doc_id)
            assert updated is not None
            assert updated.indexing_status == "parsing"
            assert updated.processing_started_at is not None

    def test_batch_processing_multiple_documents(self, db_session_with_containers, mock_external_service_dependencies):
        """Verify batch indexing updates every document and runs once."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=3)
        document_ids = [doc.id for doc in documents]

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        db_session_with_containers.expire_all()
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        run_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args[0][0]
        assert len(run_args) == 3

        for doc_id in document_ids:
            updated = self._query_document(db_session_with_containers, doc_id)
            assert updated is not None
            assert updated.indexing_status == "parsing"
            assert updated.processing_started_at is not None

    def test_batch_processing_with_limit_check(self, db_session_with_containers, mock_external_service_dependencies):
        """Mark documents as error when batch size exceeds upload limit."""
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
        db_session_with_containers.expire_all()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

        for doc_id in document_ids:
            updated = self._query_document(db_session_with_containers, doc_id)
            assert updated is not None
            assert updated.indexing_status == "error"
            assert updated.error is not None
            assert "batch upload limit" in updated.error
            assert updated.stopped_at is not None

    def test_batch_processing_sandbox_plan_single_document_only(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Reject batch upload for sandbox tenants and persist error status."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]

        features = mock_external_service_dependencies["features"]
        features.billing.enabled = True
        features.billing.subscription.plan = CloudPlan.SANDBOX

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        db_session_with_containers.expire_all()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

        for doc_id in document_ids:
            updated = self._query_document(db_session_with_containers, doc_id)
            assert updated is not None
            assert updated.indexing_status == "error"
            assert updated.error is not None
            assert "does not support batch upload" in updated.error
            assert updated.stopped_at is not None

    def test_vector_space_limit_reached(self, db_session_with_containers, mock_external_service_dependencies):
        """Persist over-limit error when vector quota has no remaining space."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_ids = [doc.id for doc in documents]

        features = mock_external_service_dependencies["features"]
        features.billing.enabled = True
        features.billing.subscription.plan = CloudPlan.PROFESSIONAL
        features.vector_space.limit = 10
        features.vector_space.size = 10

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        db_session_with_containers.expire_all()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

        updated = self._query_document(db_session_with_containers, document_ids[0])
        assert updated is not None
        assert updated.indexing_status == "error"
        assert updated.error is not None
        assert "over the limit" in updated.error
        assert updated.stopped_at is not None

    def test_batch_processing_empty_document_list(self, db_session_with_containers, mock_external_service_dependencies):
        """Accept empty input and still call runner with an empty list."""
        # Arrange
        dataset, _ = self._create_test_dataset_and_documents(db_session_with_containers, document_count=0)

        # Act
        _document_indexing(dataset.id, [])

        # Assert
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once_with([])

    def test_dataset_not_found_error_handling(self, mock_external_service_dependencies):
        """No-op when dataset id is missing from DB."""
        # Arrange
        missing_dataset_id = str(uuid.uuid4())
        missing_document_id = str(uuid.uuid4())

        # Act
        _document_indexing(missing_dataset_id, [missing_document_id])

        # Assert
        mock_external_service_dependencies["indexing_runner"].assert_not_called()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

    def test_error_handling_during_indexing_runner(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Keep documents in parsing state when runner raises a generic error."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = Exception("runner failed")

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        db_session_with_containers.expire_all()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        for doc_id in document_ids:
            updated = self._query_document(db_session_with_containers, doc_id)
            assert updated is not None
            assert updated.indexing_status == "parsing"
            assert updated.processing_started_at is not None

    def test_document_paused_error_handling(self, db_session_with_containers, mock_external_service_dependencies):
        """Keep documents in parsing state when runner raises paused error."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=2)
        document_ids = [doc.id for doc in documents]
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = DocumentIsPausedError("paused")

        # Act
        _document_indexing(dataset.id, document_ids)

        # Assert
        db_session_with_containers.expire_all()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        for doc_id in document_ids:
            updated = self._query_document(db_session_with_containers, doc_id)
            assert updated is not None
            assert updated.indexing_status == "parsing"
            assert updated.processing_started_at is not None

    def test_single_document_processing(self, db_session_with_containers, mock_external_service_dependencies):
        """Process one document and persist parsing status fields."""
        # Arrange
        dataset, documents = self._create_test_dataset_and_documents(db_session_with_containers, document_count=1)
        document_id = documents[0].id

        # Act
        _document_indexing(dataset.id, [document_id])

        # Assert
        db_session_with_containers.expire_all()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        updated = self._query_document(db_session_with_containers, document_id)
        assert updated is not None
        assert updated.indexing_status == "parsing"
        assert updated.processing_started_at is not None
