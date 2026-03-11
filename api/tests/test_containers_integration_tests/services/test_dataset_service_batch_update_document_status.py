"""Integration tests for DocumentService.batch_update_document_status.

This suite validates SQL-backed batch status updates with testcontainers.
It keeps database access real and only patches non-DB side effects.
"""

import datetime
import json
from dataclasses import dataclass
from unittest.mock import call, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models.dataset import Dataset, Document
from services.dataset_service import DocumentService
from services.errors.document import DocumentIndexingError

FIXED_TIME = datetime.datetime(2023, 1, 1, 12, 0, 0)


@dataclass
class UserDouble:
    """Minimal user object for batch update operations."""

    id: str


class DocumentBatchUpdateIntegrationDataFactory:
    """Factory for creating persisted entities used in integration tests."""

    @staticmethod
    def create_dataset(
        db_session_with_containers: Session,
        dataset_id: str | None = None,
        tenant_id: str | None = None,
        name: str = "Test Dataset",
        created_by: str | None = None,
    ) -> Dataset:
        """Create and persist a dataset."""
        dataset = Dataset(
            tenant_id=tenant_id or str(uuid4()),
            name=name,
            data_source_type="upload_file",
            created_by=created_by or str(uuid4()),
        )
        if dataset_id:
            dataset.id = dataset_id

        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        return dataset

    @staticmethod
    def create_document(
        db_session_with_containers: Session,
        dataset: Dataset,
        document_id: str | None = None,
        name: str = "test_document.pdf",
        enabled: bool = True,
        archived: bool = False,
        indexing_status: str = "completed",
        completed_at: datetime.datetime | None = None,
        position: int = 1,
        created_by: str | None = None,
        commit: bool = True,
        **kwargs,
    ) -> Document:
        """Create a document bound to the given dataset and persist it."""
        document = Document(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=position,
            data_source_type="upload_file",
            data_source_info=json.dumps({"upload_file_id": str(uuid4())}),
            batch=f"batch-{uuid4()}",
            name=name,
            created_from="web",
            created_by=created_by or str(uuid4()),
            doc_form="text_model",
        )
        document.id = document_id or str(uuid4())
        document.enabled = enabled
        document.archived = archived
        document.indexing_status = indexing_status
        document.completed_at = (
            completed_at if completed_at is not None else (FIXED_TIME if indexing_status == "completed" else None)
        )

        for key, value in kwargs.items():
            setattr(document, key, value)

        db_session_with_containers.add(document)
        if commit:
            db_session_with_containers.commit()
        return document

    @staticmethod
    def create_multiple_documents(
        db_session_with_containers: Session,
        dataset: Dataset,
        document_ids: list[str],
        enabled: bool = True,
        archived: bool = False,
        indexing_status: str = "completed",
    ) -> list[Document]:
        """Create and persist multiple documents for one dataset in a single transaction."""
        documents: list[Document] = []
        for index, doc_id in enumerate(document_ids, start=1):
            document = DocumentBatchUpdateIntegrationDataFactory.create_document(
                db_session_with_containers,
                dataset=dataset,
                document_id=doc_id,
                name=f"document_{doc_id}.pdf",
                enabled=enabled,
                archived=archived,
                indexing_status=indexing_status,
                position=index,
                commit=False,
            )
            documents.append(document)
        db_session_with_containers.commit()
        return documents

    @staticmethod
    def create_user(user_id: str | None = None) -> UserDouble:
        """Create a lightweight user for update metadata fields."""
        return UserDouble(id=user_id or str(uuid4()))


class TestDatasetServiceBatchUpdateDocumentStatus:
    """Integration coverage for batch document status updates."""

    @pytest.fixture
    def patched_dependencies(self):
        """Patch non-DB collaborators only."""
        with (
            patch("services.dataset_service.redis_client") as redis_client,
            patch("services.dataset_service.add_document_to_index_task") as add_task,
            patch("services.dataset_service.remove_document_from_index_task") as remove_task,
            patch("services.dataset_service.naive_utc_now") as naive_utc_now,
        ):
            naive_utc_now.return_value = FIXED_TIME
            redis_client.get.return_value = None
            yield {
                "redis_client": redis_client,
                "add_task": add_task,
                "remove_task": remove_task,
                "naive_utc_now": naive_utc_now,
            }

    def _assert_document_enabled(self, document: Document, current_time: datetime.datetime):
        """Verify enabled-state fields after action=enable."""
        assert document.enabled is True
        assert document.disabled_at is None
        assert document.disabled_by is None
        assert document.updated_at == current_time

    def _assert_document_disabled(self, document: Document, user_id: str, current_time: datetime.datetime):
        """Verify disabled-state fields after action=disable."""
        assert document.enabled is False
        assert document.disabled_at == current_time
        assert document.disabled_by == user_id
        assert document.updated_at == current_time

    def _assert_document_archived(self, document: Document, user_id: str, current_time: datetime.datetime):
        """Verify archived-state fields after action=archive."""
        assert document.archived is True
        assert document.archived_at == current_time
        assert document.archived_by == user_id
        assert document.updated_at == current_time

    def _assert_document_unarchived(self, document: Document):
        """Verify unarchived-state fields after action=un_archive."""
        assert document.archived is False
        assert document.archived_at is None
        assert document.archived_by is None

    def test_batch_update_enable_documents_success(self, db_session_with_containers: Session, patched_dependencies):
        """Enable disabled documents and trigger indexing side effects."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document_ids = [str(uuid4()), str(uuid4())]
        disabled_docs = DocumentBatchUpdateIntegrationDataFactory.create_multiple_documents(
            db_session_with_containers,
            dataset=dataset,
            document_ids=document_ids,
            enabled=False,
        )

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=document_ids, action="enable", user=user
        )

        # Assert
        for document in disabled_docs:
            db_session_with_containers.refresh(document)
            self._assert_document_enabled(document, FIXED_TIME)

        expected_get_calls = [call(f"document_{doc_id}_indexing") for doc_id in document_ids]
        expected_setex_calls = [call(f"document_{doc_id}_indexing", 600, 1) for doc_id in document_ids]
        expected_add_calls = [call(doc_id) for doc_id in document_ids]
        patched_dependencies["redis_client"].get.assert_has_calls(expected_get_calls)
        patched_dependencies["redis_client"].setex.assert_has_calls(expected_setex_calls)
        patched_dependencies["add_task"].delay.assert_has_calls(expected_add_calls)

    def test_batch_update_enable_already_enabled_document_skipped(
        self, db_session_with_containers: Session, patched_dependencies
    ):
        """Skip enable operation for already-enabled documents."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=True
        )

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=[document.id],
            action="enable",
            user=user,
        )

        # Assert
        db_session_with_containers.refresh(document)
        assert document.enabled is True
        patched_dependencies["redis_client"].setex.assert_not_called()
        patched_dependencies["add_task"].delay.assert_not_called()

    def test_batch_update_disable_documents_success(self, db_session_with_containers: Session, patched_dependencies):
        """Disable completed documents and trigger remove-index tasks."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document_ids = [str(uuid4()), str(uuid4())]
        enabled_docs = DocumentBatchUpdateIntegrationDataFactory.create_multiple_documents(
            db_session_with_containers,
            dataset=dataset,
            document_ids=document_ids,
            enabled=True,
            indexing_status="completed",
        )

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=document_ids,
            action="disable",
            user=user,
        )

        # Assert
        for document in enabled_docs:
            db_session_with_containers.refresh(document)
            self._assert_document_disabled(document, user.id, FIXED_TIME)

        expected_get_calls = [call(f"document_{doc_id}_indexing") for doc_id in document_ids]
        expected_setex_calls = [call(f"document_{doc_id}_indexing", 600, 1) for doc_id in document_ids]
        expected_remove_calls = [call(doc_id) for doc_id in document_ids]
        patched_dependencies["redis_client"].get.assert_has_calls(expected_get_calls)
        patched_dependencies["redis_client"].setex.assert_has_calls(expected_setex_calls)
        patched_dependencies["remove_task"].delay.assert_has_calls(expected_remove_calls)

    def test_batch_update_disable_already_disabled_document_skipped(
        self, db_session_with_containers: Session, patched_dependencies
    ):
        """Skip disable operation for already-disabled documents."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        disabled_doc = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers,
            dataset=dataset,
            enabled=False,
            indexing_status="completed",
            completed_at=FIXED_TIME,
        )

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=[disabled_doc.id],
            action="disable",
            user=user,
        )

        # Assert
        db_session_with_containers.refresh(disabled_doc)
        assert disabled_doc.enabled is False
        patched_dependencies["redis_client"].setex.assert_not_called()
        patched_dependencies["remove_task"].delay.assert_not_called()

    def test_batch_update_disable_non_completed_document_error(
        self, db_session_with_containers: Session, patched_dependencies
    ):
        """Raise error when disabling a non-completed document."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        non_completed_doc = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers,
            dataset=dataset,
            enabled=True,
            indexing_status="indexing",
            completed_at=None,
        )

        # Act / Assert
        with pytest.raises(DocumentIndexingError, match="is not completed"):
            DocumentService.batch_update_document_status(
                dataset=dataset,
                document_ids=[non_completed_doc.id],
                action="disable",
                user=user,
            )

    def test_batch_update_archive_documents_success(self, db_session_with_containers: Session, patched_dependencies):
        """Archive enabled documents and trigger remove-index task."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=True, archived=False
        )

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=[document.id],
            action="archive",
            user=user,
        )

        # Assert
        db_session_with_containers.refresh(document)
        self._assert_document_archived(document, user.id, FIXED_TIME)
        patched_dependencies["redis_client"].get.assert_called_once_with(f"document_{document.id}_indexing")
        patched_dependencies["redis_client"].setex.assert_called_once_with(f"document_{document.id}_indexing", 600, 1)
        patched_dependencies["remove_task"].delay.assert_called_once_with(document.id)

    def test_batch_update_archive_already_archived_document_skipped(
        self, db_session_with_containers: Session, patched_dependencies
    ):
        """Skip archive operation for already-archived documents."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=True, archived=True
        )

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=[document.id],
            action="archive",
            user=user,
        )

        # Assert
        db_session_with_containers.refresh(document)
        assert document.archived is True
        patched_dependencies["redis_client"].setex.assert_not_called()
        patched_dependencies["remove_task"].delay.assert_not_called()

    def test_batch_update_archive_disabled_document_no_index_removal(
        self, db_session_with_containers: Session, patched_dependencies
    ):
        """Archive disabled document without index-removal side effects."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=False, archived=False
        )

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=[document.id],
            action="archive",
            user=user,
        )

        # Assert
        db_session_with_containers.refresh(document)
        self._assert_document_archived(document, user.id, FIXED_TIME)
        patched_dependencies["redis_client"].setex.assert_not_called()
        patched_dependencies["remove_task"].delay.assert_not_called()

    def test_batch_update_unarchive_documents_success(self, db_session_with_containers: Session, patched_dependencies):
        """Unarchive enabled documents and trigger add-index task."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=True, archived=True
        )

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=[document.id],
            action="un_archive",
            user=user,
        )

        # Assert
        db_session_with_containers.refresh(document)
        self._assert_document_unarchived(document)
        assert document.updated_at == FIXED_TIME
        patched_dependencies["redis_client"].get.assert_called_once_with(f"document_{document.id}_indexing")
        patched_dependencies["redis_client"].setex.assert_called_once_with(f"document_{document.id}_indexing", 600, 1)
        patched_dependencies["add_task"].delay.assert_called_once_with(document.id)

    def test_batch_update_unarchive_already_unarchived_document_skipped(
        self, db_session_with_containers: Session, patched_dependencies
    ):
        """Skip unarchive operation for already-unarchived documents."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=True, archived=False
        )

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=[document.id],
            action="un_archive",
            user=user,
        )

        # Assert
        db_session_with_containers.refresh(document)
        assert document.archived is False
        patched_dependencies["redis_client"].setex.assert_not_called()
        patched_dependencies["add_task"].delay.assert_not_called()

    def test_batch_update_unarchive_disabled_document_no_index_addition(
        self, db_session_with_containers: Session, patched_dependencies
    ):
        """Unarchive disabled document without index-add side effects."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=False, archived=True
        )

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=[document.id],
            action="un_archive",
            user=user,
        )

        # Assert
        db_session_with_containers.refresh(document)
        self._assert_document_unarchived(document)
        assert document.updated_at == FIXED_TIME
        patched_dependencies["redis_client"].setex.assert_not_called()
        patched_dependencies["add_task"].delay.assert_not_called()

    def test_batch_update_document_indexing_error_redis_cache_hit(
        self, db_session_with_containers: Session, patched_dependencies
    ):
        """Raise DocumentIndexingError when redis indicates active indexing."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers,
            dataset=dataset,
            name="test_document.pdf",
            enabled=True,
        )
        patched_dependencies["redis_client"].get.return_value = "indexing"

        # Act / Assert
        with pytest.raises(DocumentIndexingError, match="is being indexed") as exc_info:
            DocumentService.batch_update_document_status(
                dataset=dataset,
                document_ids=[document.id],
                action="enable",
                user=user,
            )

        assert "test_document.pdf" in str(exc_info.value)
        patched_dependencies["redis_client"].get.assert_called_once_with(f"document_{document.id}_indexing")

    def test_batch_update_async_task_error_handling(self, db_session_with_containers: Session, patched_dependencies):
        """Persist DB update, then propagate async task error."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=False
        )
        patched_dependencies["add_task"].delay.side_effect = Exception("Celery task error")

        # Act / Assert
        with pytest.raises(Exception, match="Celery task error"):
            DocumentService.batch_update_document_status(
                dataset=dataset,
                document_ids=[document.id],
                action="enable",
                user=user,
            )

        db_session_with_containers.refresh(document)
        self._assert_document_enabled(document, FIXED_TIME)
        patched_dependencies["redis_client"].setex.assert_called_once_with(f"document_{document.id}_indexing", 600, 1)

    def test_batch_update_empty_document_list(self, db_session_with_containers: Session, patched_dependencies):
        """Return early when document_ids is empty."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()

        # Act
        result = DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=[], action="enable", user=user
        )

        # Assert
        assert result is None
        patched_dependencies["redis_client"].get.assert_not_called()
        patched_dependencies["redis_client"].setex.assert_not_called()

    def test_batch_update_document_not_found_skipped(self, db_session_with_containers: Session, patched_dependencies):
        """Skip IDs that do not map to existing dataset documents."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        missing_document_id = str(uuid4())

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=[missing_document_id],
            action="enable",
            user=user,
        )

        # Assert
        patched_dependencies["redis_client"].get.assert_not_called()
        patched_dependencies["redis_client"].setex.assert_not_called()
        patched_dependencies["add_task"].delay.assert_not_called()

    def test_batch_update_mixed_document_states_and_actions(
        self, db_session_with_containers: Session, patched_dependencies
    ):
        """Process only the applicable document in a mixed-state enable batch."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        disabled_doc = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=False
        )
        enabled_doc = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers,
            dataset=dataset,
            enabled=True,
            position=2,
        )
        archived_doc = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers,
            dataset=dataset,
            enabled=True,
            archived=True,
            position=3,
        )
        document_ids = [disabled_doc.id, enabled_doc.id, archived_doc.id]

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=document_ids,
            action="enable",
            user=user,
        )

        # Assert
        db_session_with_containers.refresh(disabled_doc)
        db_session_with_containers.refresh(enabled_doc)
        db_session_with_containers.refresh(archived_doc)
        self._assert_document_enabled(disabled_doc, FIXED_TIME)
        assert enabled_doc.enabled is True
        assert archived_doc.enabled is True

        patched_dependencies["redis_client"].setex.assert_called_once_with(
            f"document_{disabled_doc.id}_indexing",
            600,
            1,
        )
        patched_dependencies["add_task"].delay.assert_called_once_with(disabled_doc.id)

    def test_batch_update_large_document_list_performance(
        self, db_session_with_containers: Session, patched_dependencies
    ):
        """Handle large document lists with consistent updates and side effects."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        document_ids = [str(uuid4()) for _ in range(100)]
        documents = DocumentBatchUpdateIntegrationDataFactory.create_multiple_documents(
            db_session_with_containers,
            dataset=dataset,
            document_ids=document_ids,
            enabled=False,
        )

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=document_ids,
            action="enable",
            user=user,
        )

        # Assert
        for document in documents:
            db_session_with_containers.refresh(document)
            self._assert_document_enabled(document, FIXED_TIME)

        assert patched_dependencies["redis_client"].setex.call_count == len(document_ids)
        assert patched_dependencies["add_task"].delay.call_count == len(document_ids)

        expected_setex_calls = [call(f"document_{doc_id}_indexing", 600, 1) for doc_id in document_ids]
        expected_task_calls = [call(doc_id) for doc_id in document_ids]
        patched_dependencies["redis_client"].setex.assert_has_calls(expected_setex_calls)
        patched_dependencies["add_task"].delay.assert_has_calls(expected_task_calls)

    def test_batch_update_mixed_document_states_complex_scenario(
        self, db_session_with_containers: Session, patched_dependencies
    ):
        """Process a complex mixed-state batch and update only eligible records."""
        # Arrange
        dataset = DocumentBatchUpdateIntegrationDataFactory.create_dataset(db_session_with_containers)
        user = DocumentBatchUpdateIntegrationDataFactory.create_user()
        doc1 = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=False
        )
        doc2 = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=True, position=2
        )
        doc3 = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=True, position=3
        )
        doc4 = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers, dataset=dataset, enabled=True, position=4
        )
        doc5 = DocumentBatchUpdateIntegrationDataFactory.create_document(
            db_session_with_containers,
            dataset=dataset,
            enabled=True,
            archived=True,
            position=5,
        )
        missing_id = str(uuid4())

        document_ids = [doc1.id, doc2.id, doc3.id, doc4.id, doc5.id, missing_id]

        # Act
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=document_ids,
            action="enable",
            user=user,
        )

        # Assert
        db_session_with_containers.refresh(doc1)
        db_session_with_containers.refresh(doc2)
        db_session_with_containers.refresh(doc3)
        db_session_with_containers.refresh(doc4)
        db_session_with_containers.refresh(doc5)
        self._assert_document_enabled(doc1, FIXED_TIME)
        assert doc2.enabled is True
        assert doc3.enabled is True
        assert doc4.enabled is True
        assert doc5.enabled is True

        patched_dependencies["redis_client"].setex.assert_called_once_with(f"document_{doc1.id}_indexing", 600, 1)
        patched_dependencies["add_task"].delay.assert_called_once_with(doc1.id)
