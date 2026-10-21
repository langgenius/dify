from collections.abc import Generator
from typing import TypedDict
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from faker import Faker
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from models.knowledge_task import KnowledgeTaskOutbox
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind, KnowledgeTaskRequeuedError
from tasks.document_indexing_update_task import document_indexing_update_task


class ExternalDependencies(TypedDict):
    factory: MagicMock
    processor: MagicMock
    runner: MagicMock
    runner_instance: MagicMock


class TestDocumentIndexingUpdateTask:
    @pytest.fixture
    def mock_external_dependencies(self) -> Generator[ExternalDependencies]:
        """Patch external collaborators used by the update task.
        - IndexProcessorFactory.init_index_processor().clean(...)
        - build_document_indexing_service.run([...])
        """
        with (
            patch("tasks.document_indexing_update_task.IndexProcessorFactory", autospec=True) as mock_factory,
            patch("tasks.document_indexing_update_task.build_document_indexing_service", autospec=True) as mock_runner,
        ):
            processor_instance = MagicMock()
            mock_factory.return_value.init_index_processor.return_value = processor_instance

            runner_instance = mock_runner.return_value
            yield {
                "factory": mock_factory,
                "processor": processor_instance,
                "runner": mock_runner,
                "runner_instance": runner_instance,
            }

    def _run_durable_update(
        self,
        session: Session,
        *,
        tenant_id: str,
        dataset_id: str,
        document_id: str,
    ) -> str:
        """Execute the production update task with a persisted generation-fenced intent."""
        generation = str(uuid4())
        document = session.scalar(
            select(Document).where(
                Document.tenant_id == tenant_id,
                Document.dataset_id == dataset_id,
                Document.id == document_id,
            )
        )
        if document is not None:
            document.indexing_generation = generation
        intent = KnowledgeTaskOutbox(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            resource_id=document_id,
            task_kind=KnowledgeTaskKind.DOCUMENT_INDEX_UPDATE.value,
            payload={
                "dataset_id": dataset_id,
                "document_id": document_id,
                "generation": generation,
                "attachment_ids": [],
            },
            status="dispatched",
        )
        session.add(intent)
        session.commit()
        document_indexing_update_task.run(dataset_id, document_id, generation, [], intent.id)
        return intent.id

    def _create_dataset_document_with_segments(
        self, db_session_with_containers: Session, *, segment_count: int = 2
    ) -> tuple[Dataset, Document, list[str]]:
        fake = Faker()

        # Account and tenant
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status=AccountStatus.ACTIVE,
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(name=fake.company(), status=TenantStatus.NORMAL)
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
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        document = Document(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=0,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="test_batch",
            name=fake.file_name(),
            created_from=DocumentCreatedFrom.WEB,
            created_by=account.id,
            indexing_status=IndexingStatus.WAITING,
            enabled=True,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
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
                status=SegmentStatus.COMPLETED,
                created_by=account.id,
            )
            db_session_with_containers.add(seg)
            node_ids.append(node_id)
        db_session_with_containers.commit()

        # Refresh to ensure ORM state
        db_session_with_containers.refresh(dataset)
        db_session_with_containers.refresh(document)

        return dataset, document, node_ids

    def test_cleans_segments_and_reindexes(
        self, db_session_with_containers: Session, mock_external_dependencies: ExternalDependencies
    ) -> None:
        dataset, document, node_ids = self._create_dataset_document_with_segments(db_session_with_containers)

        # Act
        self._run_durable_update(
            db_session_with_containers,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
        )

        # Ensure we see committed changes from another session
        db_session_with_containers.expire_all()

        # Assert document status updated before reindex
        updated = db_session_with_containers.scalar(select(Document).where(Document.id == document.id).limit(1))
        assert updated is not None
        assert updated.indexing_status == IndexingStatus.PARSING
        assert updated.processing_started_at is not None

        # Segments should be deleted
        remaining = db_session_with_containers.scalar(
            select(func.count()).select_from(DocumentSegment).where(DocumentSegment.document_id == document.id)
        )
        assert remaining == 0

        # Assert index processor clean was called with expected args
        clean_call = mock_external_dependencies["processor"].clean.call_args
        assert clean_call is not None
        args, kwargs = clean_call
        # args[0] is a Dataset instance (from another session), so validate by id.
        assert args[0].id == dataset.id
        # args[1] should contain our node_ids.
        assert set(args[1]) == set(node_ids)
        assert kwargs.get("with_keywords") is True
        assert kwargs.get("delete_child_chunks") is False

        # Reindexing receives the detached reference with its complete ownership chain.
        run_call = mock_external_dependencies["runner_instance"].run.call_args
        assert run_call is not None
        assert run_call.args[0] == [DatasetRef(dataset.tenant_id, dataset.id).document(document.id)]
        assert document.id in run_call.kwargs["executions"]

    def test_clean_error_requeues_before_indexing(
        self, db_session_with_containers: Session, mock_external_dependencies: ExternalDependencies
    ) -> None:
        dataset, document, node_ids = self._create_dataset_document_with_segments(db_session_with_containers)

        # A failed destructive cleanup must durably retry before provider work.
        mock_external_dependencies["processor"].clean.side_effect = Exception("boom")

        with pytest.raises(KnowledgeTaskRequeuedError):
            self._run_durable_update(
                db_session_with_containers,
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
            )

        # Ensure we see committed changes from another session
        db_session_with_containers.expire_all()

        # Destructive cleanup must finish before provider work can begin.
        mock_external_dependencies["runner_instance"].run.assert_not_called()

        # Segments should remain (since clean failed before DB delete)
        remaining = db_session_with_containers.scalar(
            select(func.count()).select_from(DocumentSegment).where(DocumentSegment.document_id == document.id)
        )
        assert remaining is not None
        assert remaining > 0

    def test_document_not_found_noop(
        self, db_session_with_containers: Session, mock_external_dependencies: ExternalDependencies
    ) -> None:
        fake = Faker()
        # Act with non-existent document id
        self._run_durable_update(
            db_session_with_containers,
            tenant_id=fake.uuid4(),
            dataset_id=fake.uuid4(),
            document_id=fake.uuid4(),
        )

        # Neither processor nor runner should be called
        mock_external_dependencies["processor"].clean.assert_not_called()
        mock_external_dependencies["runner_instance"].run.assert_not_called()
