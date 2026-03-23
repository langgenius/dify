"""
Integration tests for document_indexing_sync_task using testcontainers.

This module validates SQL-backed behavior for document sync flows:
- Notion sync precondition checks
- Segment cleanup and document state updates
- Credential and indexing error handling
"""

import json
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from tasks.document_indexing_sync_task import document_indexing_sync_task


class DocumentIndexingSyncTaskTestDataFactory:
    """Create real DB entities for document indexing sync integration tests."""

    @staticmethod
    def create_account_with_tenant(db_session_with_containers) -> tuple[Account, Tenant]:
        account = Account(
            email=f"{uuid4()}@example.com",
            name=f"user-{uuid4()}",
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.flush()

        tenant = Tenant(name=f"tenant-{account.id}", status="normal")
        db_session_with_containers.add(tenant)
        db_session_with_containers.flush()

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        return account, tenant

    @staticmethod
    def create_dataset(db_session_with_containers, tenant_id: str, created_by: str) -> Dataset:
        dataset = Dataset(
            tenant_id=tenant_id,
            name=f"dataset-{uuid4()}",
            description="sync test dataset",
            data_source_type="notion_import",
            indexing_technique="high_quality",
            created_by=created_by,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        return dataset

    @staticmethod
    def create_document(
        db_session_with_containers,
        *,
        tenant_id: str,
        dataset_id: str,
        created_by: str,
        data_source_info: dict | None,
        indexing_status: str = "completed",
    ) -> Document:
        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=0,
            data_source_type="notion_import",
            data_source_info=json.dumps(data_source_info) if data_source_info is not None else None,
            batch="test-batch",
            name=f"doc-{uuid4()}",
            created_from="notion_import",
            created_by=created_by,
            indexing_status=indexing_status,
            enabled=True,
            doc_form="text_model",
            doc_language="en",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.commit()
        return document

    @staticmethod
    def create_segments(
        db_session_with_containers,
        *,
        tenant_id: str,
        dataset_id: str,
        document_id: str,
        created_by: str,
        count: int = 3,
    ) -> list[DocumentSegment]:
        segments: list[DocumentSegment] = []
        for i in range(count):
            segment = DocumentSegment(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                position=i,
                content=f"segment-{i}",
                answer=None,
                word_count=10,
                tokens=5,
                index_node_id=f"node-{document_id}-{i}",
                status="completed",
                created_by=created_by,
            )
            db_session_with_containers.add(segment)
            segments.append(segment)
        db_session_with_containers.commit()
        return segments


class TestDocumentIndexingSyncTask:
    """Integration tests for document_indexing_sync_task with real database assertions."""

    @pytest.fixture
    def mock_external_dependencies(self):
        """Patch only external collaborators; keep DB access real."""
        with (
            patch("tasks.document_indexing_sync_task.DatasourceProviderService") as mock_datasource_service_class,
            patch("tasks.document_indexing_sync_task.NotionExtractor") as mock_notion_extractor_class,
            patch("tasks.document_indexing_sync_task.IndexProcessorFactory") as mock_index_processor_factory,
            patch("tasks.document_indexing_sync_task.IndexingRunner") as mock_indexing_runner_class,
        ):
            datasource_service = Mock()
            datasource_service.get_datasource_credentials.return_value = {"integration_secret": "test_token"}
            mock_datasource_service_class.return_value = datasource_service

            notion_extractor = Mock()
            notion_extractor.get_notion_last_edited_time.return_value = "2024-01-02T00:00:00Z"
            mock_notion_extractor_class.return_value = notion_extractor

            index_processor = Mock()
            index_processor.clean = Mock()
            mock_index_processor_factory.return_value.init_index_processor.return_value = index_processor

            indexing_runner = Mock(spec=IndexingRunner)
            indexing_runner.run = Mock()
            mock_indexing_runner_class.return_value = indexing_runner

            yield {
                "datasource_service": datasource_service,
                "notion_extractor": notion_extractor,
                "notion_extractor_class": mock_notion_extractor_class,
                "index_processor": index_processor,
                "index_processor_factory": mock_index_processor_factory,
                "indexing_runner": indexing_runner,
            }

    def _create_notion_sync_context(self, db_session_with_containers, *, data_source_info: dict | None = None):
        account, tenant = DocumentIndexingSyncTaskTestDataFactory.create_account_with_tenant(db_session_with_containers)
        dataset = DocumentIndexingSyncTaskTestDataFactory.create_dataset(
            db_session_with_containers,
            tenant_id=tenant.id,
            created_by=account.id,
        )

        notion_info = data_source_info or {
            "notion_workspace_id": str(uuid4()),
            "notion_page_id": str(uuid4()),
            "type": "page",
            "last_edited_time": "2024-01-01T00:00:00Z",
            "credential_id": str(uuid4()),
        }

        document = DocumentIndexingSyncTaskTestDataFactory.create_document(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            created_by=account.id,
            data_source_info=notion_info,
            indexing_status="completed",
        )

        segments = DocumentIndexingSyncTaskTestDataFactory.create_segments(
            db_session_with_containers,
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            created_by=account.id,
            count=3,
        )

        return {
            "account": account,
            "tenant": tenant,
            "dataset": dataset,
            "document": document,
            "segments": segments,
            "node_ids": [segment.index_node_id for segment in segments],
            "notion_info": notion_info,
        }

    def test_document_not_found(self, db_session_with_containers, mock_external_dependencies):
        """Test that task handles missing document gracefully."""
        # Arrange
        dataset_id = str(uuid4())
        document_id = str(uuid4())

        # Act
        document_indexing_sync_task(dataset_id, document_id)

        # Assert
        mock_external_dependencies["datasource_service"].get_datasource_credentials.assert_not_called()
        mock_external_dependencies["indexing_runner"].run.assert_not_called()

    def test_missing_notion_workspace_id(self, db_session_with_containers, mock_external_dependencies):
        """Test that task raises error when notion_workspace_id is missing."""
        # Arrange
        context = self._create_notion_sync_context(
            db_session_with_containers,
            data_source_info={
                "notion_page_id": str(uuid4()),
                "type": "page",
                "last_edited_time": "2024-01-01T00:00:00Z",
            },
        )

        # Act & Assert
        with pytest.raises(ValueError, match="no notion page found"):
            document_indexing_sync_task(context["dataset"].id, context["document"].id)

    def test_missing_notion_page_id(self, db_session_with_containers, mock_external_dependencies):
        """Test that task raises error when notion_page_id is missing."""
        # Arrange
        context = self._create_notion_sync_context(
            db_session_with_containers,
            data_source_info={
                "notion_workspace_id": str(uuid4()),
                "type": "page",
                "last_edited_time": "2024-01-01T00:00:00Z",
            },
        )

        # Act & Assert
        with pytest.raises(ValueError, match="no notion page found"):
            document_indexing_sync_task(context["dataset"].id, context["document"].id)

    def test_empty_data_source_info(self, db_session_with_containers, mock_external_dependencies):
        """Test that task raises error when data_source_info is empty."""
        # Arrange
        context = self._create_notion_sync_context(db_session_with_containers, data_source_info=None)
        db_session_with_containers.query(Document).where(Document.id == context["document"].id).update(
            {"data_source_info": None}
        )
        db_session_with_containers.commit()

        # Act & Assert
        with pytest.raises(ValueError, match="no notion page found"):
            document_indexing_sync_task(context["dataset"].id, context["document"].id)

    def test_credential_not_found(self, db_session_with_containers, mock_external_dependencies):
        """Test that task sets document error state when credential is missing."""
        # Arrange
        context = self._create_notion_sync_context(db_session_with_containers)
        mock_external_dependencies["datasource_service"].get_datasource_credentials.return_value = None

        # Act
        document_indexing_sync_task(context["dataset"].id, context["document"].id)

        # Assert
        db_session_with_containers.expire_all()
        updated_document = (
            db_session_with_containers.query(Document).where(Document.id == context["document"].id).first()
        )
        assert updated_document is not None
        assert updated_document.indexing_status == "error"
        assert "Datasource credential not found" in updated_document.error
        assert updated_document.stopped_at is not None
        mock_external_dependencies["indexing_runner"].run.assert_not_called()

    def test_page_not_updated(self, db_session_with_containers, mock_external_dependencies):
        """Test that task exits early when notion page is unchanged."""
        # Arrange
        context = self._create_notion_sync_context(db_session_with_containers)
        mock_external_dependencies["notion_extractor"].get_notion_last_edited_time.return_value = "2024-01-01T00:00:00Z"

        # Act
        document_indexing_sync_task(context["dataset"].id, context["document"].id)

        # Assert
        db_session_with_containers.expire_all()
        updated_document = (
            db_session_with_containers.query(Document).where(Document.id == context["document"].id).first()
        )
        remaining_segments = (
            db_session_with_containers.query(DocumentSegment)
            .where(DocumentSegment.document_id == context["document"].id)
            .count()
        )
        assert updated_document is not None
        assert updated_document.indexing_status == "completed"
        assert updated_document.processing_started_at is None
        assert remaining_segments == 3
        mock_external_dependencies["index_processor"].clean.assert_not_called()
        mock_external_dependencies["indexing_runner"].run.assert_not_called()

    def test_successful_sync_when_page_updated(self, db_session_with_containers, mock_external_dependencies):
        """Test full successful sync flow with SQL state updates and side effects."""
        # Arrange
        context = self._create_notion_sync_context(db_session_with_containers)

        # Act
        document_indexing_sync_task(context["dataset"].id, context["document"].id)

        # Assert
        db_session_with_containers.expire_all()
        updated_document = (
            db_session_with_containers.query(Document).where(Document.id == context["document"].id).first()
        )
        remaining_segments = (
            db_session_with_containers.query(DocumentSegment)
            .where(DocumentSegment.document_id == context["document"].id)
            .count()
        )

        assert updated_document is not None
        assert updated_document.indexing_status == "parsing"
        assert updated_document.processing_started_at is not None
        assert updated_document.data_source_info_dict.get("last_edited_time") == "2024-01-02T00:00:00Z"
        assert remaining_segments == 0

        clean_call_args = mock_external_dependencies["index_processor"].clean.call_args
        assert clean_call_args is not None
        clean_args, clean_kwargs = clean_call_args
        assert getattr(clean_args[0], "id", None) == context["dataset"].id
        assert set(clean_args[1]) == set(context["node_ids"])
        assert clean_kwargs.get("with_keywords") is True
        assert clean_kwargs.get("delete_child_chunks") is True

        run_call_args = mock_external_dependencies["indexing_runner"].run.call_args
        assert run_call_args is not None
        run_documents = run_call_args[0][0]
        assert len(run_documents) == 1
        assert getattr(run_documents[0], "id", None) == context["document"].id

    def test_dataset_not_found_during_cleaning(self, db_session_with_containers, mock_external_dependencies):
        """Test that task still updates document and reindexes if dataset vanishes before clean."""
        # Arrange
        context = self._create_notion_sync_context(db_session_with_containers)

        def _delete_dataset_before_clean() -> str:
            db_session_with_containers.query(Dataset).where(Dataset.id == context["dataset"].id).delete()
            db_session_with_containers.commit()
            return "2024-01-02T00:00:00Z"

        mock_external_dependencies[
            "notion_extractor"
        ].get_notion_last_edited_time.side_effect = _delete_dataset_before_clean

        # Act
        document_indexing_sync_task(context["dataset"].id, context["document"].id)

        # Assert
        db_session_with_containers.expire_all()
        updated_document = (
            db_session_with_containers.query(Document).where(Document.id == context["document"].id).first()
        )
        assert updated_document is not None
        assert updated_document.indexing_status == "parsing"
        mock_external_dependencies["index_processor"].clean.assert_not_called()
        mock_external_dependencies["indexing_runner"].run.assert_called_once()

    def test_cleaning_error_continues_to_indexing(self, db_session_with_containers, mock_external_dependencies):
        """Test that indexing continues when index cleanup fails."""
        # Arrange
        context = self._create_notion_sync_context(db_session_with_containers)
        mock_external_dependencies["index_processor"].clean.side_effect = Exception("Cleaning error")

        # Act
        document_indexing_sync_task(context["dataset"].id, context["document"].id)

        # Assert
        db_session_with_containers.expire_all()
        updated_document = (
            db_session_with_containers.query(Document).where(Document.id == context["document"].id).first()
        )
        remaining_segments = (
            db_session_with_containers.query(DocumentSegment)
            .where(DocumentSegment.document_id == context["document"].id)
            .count()
        )
        assert updated_document is not None
        assert updated_document.indexing_status == "parsing"
        assert remaining_segments == 0
        mock_external_dependencies["indexing_runner"].run.assert_called_once()

    def test_indexing_runner_document_paused_error(self, db_session_with_containers, mock_external_dependencies):
        """Test that DocumentIsPausedError does not flip document into error state."""
        # Arrange
        context = self._create_notion_sync_context(db_session_with_containers)
        mock_external_dependencies["indexing_runner"].run.side_effect = DocumentIsPausedError("Document paused")

        # Act
        document_indexing_sync_task(context["dataset"].id, context["document"].id)

        # Assert
        db_session_with_containers.expire_all()
        updated_document = (
            db_session_with_containers.query(Document).where(Document.id == context["document"].id).first()
        )
        assert updated_document is not None
        assert updated_document.indexing_status == "parsing"
        assert updated_document.error is None

    def test_indexing_runner_general_error(self, db_session_with_containers, mock_external_dependencies):
        """Test that indexing errors are persisted to document state."""
        # Arrange
        context = self._create_notion_sync_context(db_session_with_containers)
        mock_external_dependencies["indexing_runner"].run.side_effect = Exception("Indexing error")

        # Act
        document_indexing_sync_task(context["dataset"].id, context["document"].id)

        # Assert
        db_session_with_containers.expire_all()
        updated_document = (
            db_session_with_containers.query(Document).where(Document.id == context["document"].id).first()
        )
        assert updated_document is not None
        assert updated_document.indexing_status == "error"
        assert "Indexing error" in updated_document.error
        assert updated_document.stopped_at is not None

    def test_index_processor_clean_called_with_correct_params(
        self,
        db_session_with_containers,
        mock_external_dependencies,
    ):
        """Test that clean is called with dataset instance and collected node ids."""
        # Arrange
        context = self._create_notion_sync_context(db_session_with_containers)

        # Act
        document_indexing_sync_task(context["dataset"].id, context["document"].id)

        # Assert
        clean_call_args = mock_external_dependencies["index_processor"].clean.call_args
        assert clean_call_args is not None
        clean_args, clean_kwargs = clean_call_args
        assert getattr(clean_args[0], "id", None) == context["dataset"].id
        assert set(clean_args[1]) == set(context["node_ids"])
        assert clean_kwargs.get("with_keywords") is True
        assert clean_kwargs.get("delete_child_chunks") is True
