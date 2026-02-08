from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from tasks.document_indexing_update_task import document_indexing_update_task


class TestDocumentIndexingUpdateTask:
    @pytest.fixture
    def mock_external_dependencies(self):
        """Patch external collaborators used by the update task.
        - IndexProcessorFactory.init_index_processor().clean(...)
        - IndexingRunner.run([...])
        """
        with (
            patch("tasks.document_indexing_update_task.IndexProcessorFactory") as mock_factory,
            patch("tasks.document_indexing_update_task.IndexingRunner") as mock_runner,
        ):
            processor_instance = MagicMock()
            mock_factory.return_value.init_index_processor.return_value = processor_instance

            runner_instance = MagicMock()
            mock_runner.return_value = runner_instance

            yield {
                "factory": mock_factory,
                "processor": processor_instance,
                "runner": mock_runner,
                "runner_instance": runner_instance,
            }

    def _create_dataset_document_with_segments(self, db_session_with_containers, *, segment_count: int = 2):
        fake = Faker()

        # Account and tenant
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

        # Dataset and document
        dataset = Dataset(
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=64),
            data_source_type="upload_file",
            indexing_technique="high_quality",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        document = Document(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type="upload_file",
            batch="test_batch",
            name=fake.file_name(),
            created_from="upload_file",
            created_by=account.id,
            indexing_status="waiting",
            enabled=True,
            doc_form="text_model",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.commit()

        # Segments
        node_ids = []
        for i in range(segment_count):
            node_id = f"node-{i + 1}"
            seg = DocumentSegment(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=i,
                content=fake.text(max_nb_chars=32),
                answer=None,
                word_count=10,
                tokens=5,
                index_node_id=node_id,
                status="completed",
                created_by=account.id,
            )
            db_session_with_containers.add(seg)
            node_ids.append(node_id)
        db_session_with_containers.commit()

        # Refresh to ensure ORM state
        db_session_with_containers.refresh(dataset)
        db_session_with_containers.refresh(document)

        return dataset, document, node_ids

    def test_cleans_segments_and_reindexes(self, db_session_with_containers, mock_external_dependencies):
        dataset, document, node_ids = self._create_dataset_document_with_segments(db_session_with_containers)

        # Act
        document_indexing_update_task(dataset.id, document.id)

        # Ensure we see committed changes from another session
        db_session_with_containers.expire_all()

        # Assert document status updated before reindex
        updated = db_session_with_containers.query(Document).where(Document.id == document.id).first()
        assert updated.indexing_status == "parsing"
        assert updated.processing_started_at is not None

        # Segments should be deleted
        remaining = (
            db_session_with_containers.query(DocumentSegment).where(DocumentSegment.document_id == document.id).count()
        )
        assert remaining == 0

        # Assert index processor clean was called with expected args
        clean_call = mock_external_dependencies["processor"].clean.call_args
        assert clean_call is not None
        args, kwargs = clean_call
        # args[0] is a Dataset instance (from another session) — validate by id
        assert getattr(args[0], "id", None) == dataset.id
        # args[1] should contain our node_ids
        assert set(args[1]) == set(node_ids)
        assert kwargs.get("with_keywords") is True
        assert kwargs.get("delete_child_chunks") is True

        # Assert indexing runner invoked with the updated document
        run_call = mock_external_dependencies["runner_instance"].run.call_args
        assert run_call is not None
        run_docs = run_call[0][0]
        assert len(run_docs) == 1
        first = run_docs[0]
        assert getattr(first, "id", None) == document.id

    def test_clean_error_is_logged_and_indexing_continues(self, db_session_with_containers, mock_external_dependencies):
        dataset, document, node_ids = self._create_dataset_document_with_segments(db_session_with_containers)

        # Force clean to raise; task should continue to indexing
        mock_external_dependencies["processor"].clean.side_effect = Exception("boom")

        document_indexing_update_task(dataset.id, document.id)

        # Ensure we see committed changes from another session
        db_session_with_containers.expire_all()

        # Indexing should still be triggered
        mock_external_dependencies["runner_instance"].run.assert_called_once()

        # Segments should remain (since clean failed before DB delete)
        remaining = (
            db_session_with_containers.query(DocumentSegment).where(DocumentSegment.document_id == document.id).count()
        )
        assert remaining > 0

    def test_document_not_found_noop(self, db_session_with_containers, mock_external_dependencies):
        fake = Faker()
        # Act with non-existent document id
        document_indexing_update_task(dataset_id=fake.uuid4(), document_id=fake.uuid4())

        # Neither processor nor runner should be called
        mock_external_dependencies["processor"].clean.assert_not_called()
        mock_external_dependencies["runner_instance"].run.assert_not_called()
