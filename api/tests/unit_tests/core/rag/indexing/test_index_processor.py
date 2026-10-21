import uuid
from contextlib import nullcontext
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from flask import Flask
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor import index_processor as index_processor_module
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessor
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.models.document import AttachmentDocument
from core.workflow.nodes.knowledge_index.protocols import Preview, PreviewItem
from extensions.ext_application_services import ApplicationServices
from extensions.ext_login import bind_account_loader
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, SegmentStatus
from models.model import KnowledgeUploadFileReference
from repositories.knowledge.segment_repository import SQLAlchemySegmentAttachmentWriter
from repositories.knowledge.upload_file_repository import claim_orphan_upload_files
from services.knowledge.indexing.adapters.execution import PipelineIndexProcessor
from services.knowledge.indexing.cleanup import UploadFileCleanup
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError
from tests.unit_tests.model_factories import make_upload_file

_PIPELINE_EXECUTION_ID = "f54bd430-0ca9-4a59-97ea-423658cb294e"


@dataclass(slots=True)
class _OwnershipState:
    lost: bool = False

    def assert_owned(self) -> None:
        if self.lost:
            raise DocumentIndexingGenerationChangedError("document-1")


@dataclass(frozen=True, slots=True)
class _LosingIndexBackend:
    ownership: _OwnershipState

    def index(self, *_args: object, **_kwargs: object) -> None:
        self.ownership.lost = True

    def clean(self, *_args: object, **_kwargs: object) -> None:
        return None


@dataclass(frozen=True, slots=True)
class _IndexProcessorFactory:
    backend: _LosingIndexBackend

    def init_index_processor(self) -> _LosingIndexBackend:
        return self.backend


class _AdmissionService:
    def ensure_pipeline_can_be_indexed(self, **_kwargs: object) -> None:
        return None


class TestIndexingAccountLookup:
    def test_indexes_attachments_with_the_registered_account_loader(
        self, sqlite_session: Session, account_application_services: ApplicationServices
    ) -> None:
        app = Flask(__name__)
        bind_account_loader(app, account_application_services.accounts.identity.load_user)
        dataset, document = _persist_dataset_and_document(sqlite_session)
        account = Account(name="Creator", email="creator@example.com")
        account.id = document.created_by
        tenant = Tenant(name="Creator workspace")
        tenant.id = dataset.tenant_id
        sqlite_session.add_all(
            [
                account,
                tenant,
                TenantAccountJoin(
                    tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True
                ),
            ]
        )
        sqlite_session.commit()
        attachment = AttachmentDocument(page_content="image", metadata={})

        with (
            app.app_context(),
            patch.object(ParagraphIndexProcessor, "_get_content_files", return_value=[attachment]) as content_files,
            patch("core.rag.index_processor.processor.paragraph_index_processor.DatasetDocumentStore", new=Mock()),
            patch("core.rag.index_processor.processor.paragraph_index_processor.Vector", new=Mock()),
            patch(
                "core.rag.index_processor.processor.paragraph_index_processor.calculate_segment_token_counts",
                return_value=[1],
            ),
        ):
            result = PipelineIndexProcessor(
                attachment_writer=SQLAlchemySegmentAttachmentWriter(),
                execution=DocumentIndexingExecution(None, lambda: None, execution_id=_PIPELINE_EXECUTION_ID),
                repair_stale_execution=lambda: None,
            ).index_and_clean(
                dataset_id=dataset.id,
                document_id=document.id,
                original_document_id=document.id,
                chunks={"general_chunks": [{"content": "Image content"}]},
                batch="batch-1",
                session=sqlite_session,
            )

        assert result["display_status"] == "completed"
        assert content_files.call_args.kwargs["current_user"].id == account.id
        assert content_files.call_args.kwargs["session"] is sqlite_session


def _persist_dataset_and_document(
    session: Session,
    *,
    indexing_technique: IndexTechniqueType = IndexTechniqueType.HIGH_QUALITY,
    summary_index_setting: dict[str, object] | None = None,
) -> tuple[Dataset, Document]:
    tenant_id = str(uuid.uuid4())
    created_by = str(uuid.uuid4())
    dataset = Dataset(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name="Dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=indexing_technique,
        chunk_structure="text_model",
        summary_index_setting=summary_index_setting,
        created_by=created_by,
    )
    document = Document(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.WEB,
        created_by=created_by,
        doc_language="English",
        indexing_execution_id=_PIPELINE_EXECUTION_ID,
    )
    session.add_all([dataset, document])
    session.flush()
    return dataset, document


class TestIndexProcessor:
    def test_format_preview_supports_qa_preview_shape(self) -> None:
        preview = IndexProcessor().format_preview(
            "qa_model",
            {"qa_chunks": [{"question": "Q1", "answer": "A1"}]},
        )

        assert preview.chunk_structure == "qa_model"
        assert preview.total_segments == 1
        assert len(preview.qa_preview) == 1
        assert preview.qa_preview[0].question == "Q1"
        assert preview.qa_preview[0].answer == "A1"

    def test_index_and_clean_ends_transactions_around_index_io(self, sqlite_session: Session) -> None:
        dataset, document = _persist_dataset_and_document(sqlite_session)
        phase_events: list[str] = []
        event.listen(sqlite_session, "after_commit", lambda _session: phase_events.append("commit"))

        index_processor = MagicMock()
        index_processor.index.side_effect = lambda *args: phase_events.append("index")
        processor = PipelineIndexProcessor(
            attachment_writer=SQLAlchemySegmentAttachmentWriter(),
            execution=DocumentIndexingExecution(None, lambda: None, execution_id=_PIPELINE_EXECUTION_ID),
            repair_stale_execution=lambda: None,
        )
        admission_service = MagicMock()
        chunks = {"general_chunks": ["content"]}

        with (
            patch(
                "services.knowledge.indexing.adapters.execution.VectorSpaceAdmissionService",
                return_value=admission_service,
            ),
            patch("services.knowledge.indexing.adapters.execution.IndexProcessorFactory") as index_processor_factory,
        ):
            index_processor_factory.return_value.init_index_processor.return_value = index_processor
            processor.index_and_clean(
                dataset_id=dataset.id,
                document_id=document.id,
                original_document_id="",
                chunks=chunks,
                batch="batch-1",
                session=sqlite_session,
            )

        assert phase_events == ["commit", "index", "commit", "commit"]
        admission_service.ensure_pipeline_can_be_indexed.assert_called_once_with(
            dataset=dataset,
            document_id=document.id,
            chunk_structure=dataset.chunk_structure,
            chunks=chunks,
            include_summaries=False,
            session=sqlite_session,
        )

    def test_index_and_clean_enqueues_repair_when_generation_changes_after_vector_write(
        self, sqlite_session: Session
    ) -> None:
        dataset, document = _persist_dataset_and_document(sqlite_session)
        ownership = _OwnershipState()
        recovery_events: list[str] = []
        event.listen(sqlite_session, "after_rollback", lambda _session: recovery_events.append("rollback"))
        processor = PipelineIndexProcessor(
            attachment_writer=SQLAlchemySegmentAttachmentWriter(),
            execution=DocumentIndexingExecution(
                None,
                ownership.assert_owned,
                execution_id=_PIPELINE_EXECUTION_ID,
            ),
            repair_stale_execution=lambda: recovery_events.append(f"repair:{document.id}"),
        )

        with (
            patch(
                "services.knowledge.indexing.adapters.execution.VectorSpaceAdmissionService",
                return_value=_AdmissionService(),
            ),
            patch(
                "services.knowledge.indexing.adapters.execution.IndexProcessorFactory",
                return_value=_IndexProcessorFactory(_LosingIndexBackend(ownership)),
            ),
            pytest.raises(DocumentIndexingGenerationChangedError),
        ):
            processor.index_and_clean(
                dataset_id=dataset.id,
                document_id=document.id,
                original_document_id="",
                chunks={"general_chunks": ["content"]},
                batch="batch-1",
                session=sqlite_session,
            )

        assert recovery_events == ["rollback", f"repair:{document.id}"]

    def test_index_and_clean_skips_admission_for_replacement_without_existing_vector_points(
        self, sqlite_session: Session
    ) -> None:
        dataset, document = _persist_dataset_and_document(sqlite_session)
        index_processor = MagicMock()
        processor = PipelineIndexProcessor(
            attachment_writer=SQLAlchemySegmentAttachmentWriter(),
            execution=DocumentIndexingExecution(None, lambda: None, execution_id=_PIPELINE_EXECUTION_ID),
            repair_stale_execution=lambda: None,
        )
        chunks = {"general_chunks": ["content"]}

        with (
            patch(
                "services.knowledge.indexing.adapters.execution.VectorSpaceAdmissionService"
            ) as admission_service_class,
            patch("services.knowledge.indexing.adapters.execution.IndexProcessorFactory") as index_processor_factory,
        ):
            index_processor_factory.return_value.init_index_processor.return_value = index_processor
            processor.index_and_clean(
                dataset_id=dataset.id,
                document_id=document.id,
                original_document_id=document.id,
                chunks=chunks,
                batch="batch-1",
                session=sqlite_session,
            )

        admission_service_class.assert_not_called()

    def test_index_and_clean_scopes_replacement_queries_to_dataset_owner(self, sqlite_session: Session) -> None:
        dataset, document = _persist_dataset_and_document(sqlite_session)
        upload = make_upload_file(tenant_id=dataset.tenant_id, key="files/reused-image")
        original_document = Document(
            id=str(uuid.uuid4()),
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=2,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch-1",
            name="Original document",
            created_from=DocumentCreatedFrom.WEB,
            created_by=dataset.created_by,
        )
        segment = DocumentSegment(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=original_document.id,
            position=1,
            content=f"![old image](/files/{upload.id}/file-preview)",
            word_count=3,
            tokens=3,
            created_by=dataset.created_by,
            index_node_id="node-1",
            status=SegmentStatus.COMPLETED,
        )
        control_segment = DocumentSegment(
            tenant_id=str(uuid.uuid4()),
            dataset_id=str(uuid.uuid4()),
            document_id=original_document.id,
            position=1,
            content="other tenant content",
            word_count=4,
            tokens=4,
            created_by=str(uuid.uuid4()),
            index_node_id="other-node",
            status=SegmentStatus.COMPLETED,
        )
        sqlite_session.add_all([original_document, segment, control_segment, upload])
        sqlite_session.flush()
        sqlite_session.add(
            KnowledgeUploadFileReference(
                tenant_id=dataset.tenant_id,
                upload_file_id=upload.id,
                dataset_id=dataset.id,
                document_id=original_document.id,
                kind="segment_image",
                resource_id=segment.id,
            )
        )
        sqlite_session.flush()

        attachment_writer = SQLAlchemySegmentAttachmentWriter()
        processor = PipelineIndexProcessor(
            attachment_writer=attachment_writer,
            execution=DocumentIndexingExecution(None, lambda: None, execution_id=_PIPELINE_EXECUTION_ID),
            repair_stale_execution=lambda: None,
        )
        phase_events: list[str] = []

        def record_commit(_session: Session) -> None:
            phase_events.append("commit")

        event.listen(sqlite_session, "after_commit", record_commit)
        try:
            with (
                patch(
                    "services.knowledge.indexing.adapters.execution.VectorSpaceAdmissionService"
                ) as admission_service_class,
                patch(
                    "services.knowledge.indexing.adapters.execution.IndexProcessorFactory"
                ) as index_processor_factory,
            ):
                index_backend = index_processor_factory.return_value.init_index_processor.return_value
                index_backend.clean.side_effect = lambda *args, **kwargs: phase_events.append("clean")

                def save_replacement(
                    replacement_dataset: Dataset,
                    replacement_document: Document,
                    _chunks: object,
                    session: Session,
                ) -> None:
                    phase_events.append("index")
                    replacement_segment = DocumentSegment(
                        tenant_id=replacement_dataset.tenant_id,
                        dataset_id=replacement_dataset.id,
                        document_id=replacement_document.id,
                        position=1,
                        content=f"![reused image](/files/{upload.id}/file-preview)",
                        word_count=2,
                        tokens=2,
                        created_by=replacement_dataset.created_by,
                        index_node_id="replacement-node",
                        status=SegmentStatus.INDEXING,
                    )
                    session.add(replacement_segment)
                    session.flush()
                    attachment_writer.replace_content_references(
                        session,
                        tenant_id=replacement_dataset.tenant_id,
                        dataset_id=replacement_dataset.id,
                        document_id=replacement_document.id,
                        segment_id=replacement_segment.id,
                        content=replacement_segment.content,
                    )

                index_backend.index.side_effect = save_replacement
                processor.index_and_clean(
                    dataset_id=dataset.id,
                    document_id=document.id,
                    original_document_id=original_document.id,
                    chunks={},
                    batch="batch-1",
                    session=sqlite_session,
                )
        finally:
            event.remove(sqlite_session, "after_commit", record_commit)

        assert sqlite_session.get(DocumentSegment, segment.id) is None
        assert sqlite_session.get(DocumentSegment, control_segment.id) is control_segment
        persisted_document = sqlite_session.get(Document, document.id)
        assert persisted_document is not None
        assert persisted_document.indexing_status == "completed"
        index_backend.clean.assert_called_once_with(
            dataset,
            ["node-1"],
            with_keywords=True,
            delete_child_chunks=False,
            session=sqlite_session,
        )
        index_backend.index.assert_called_once_with(dataset, document, {}, sqlite_session)
        admission_service_class.assert_not_called()
        assert phase_events == ["commit", "clean", "commit", "index", "commit", "commit"]
        assert (
            claim_orphan_upload_files(
                sqlite_session,
                tenant_id=dataset.tenant_id,
                files=(UploadFileCleanup(id=upload.id, key=upload.key),),
            )
            == ()
        )

    def test_get_preview_output_scopes_document_to_dataset_owner(self, sqlite_session: Session) -> None:
        dataset, document = _persist_dataset_and_document(sqlite_session, indexing_technique=IndexTechniqueType.ECONOMY)
        processor = IndexProcessor()
        expected_preview = MagicMock()

        with patch.object(processor, "format_preview", return_value=expected_preview):
            result = processor.get_preview_output(
                chunks={},
                dataset_id=dataset.id,
                document_id=document.id,
                chunk_structure="text_model",
                summary_index_setting=None,
                session=sqlite_session,
            )

        assert result is expected_preview

    def test_preview_summary_workers_use_independent_sessions(
        self, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        dataset, _ = _persist_dataset_and_document(
            sqlite_session,
            summary_index_setting={"enable": True},
        )
        phase_events: list[str] = []
        event.listen(sqlite_session, "after_commit", lambda _session: phase_events.append("commit"))
        worker_sessions: list[Session] = []
        preview = Preview(
            chunk_structure="text_model",
            total_segments=2,
            preview=[PreviewItem(content="chunk-1"), PreviewItem(content="chunk-2")],
        )
        flask_app = SimpleNamespace(app_context=lambda: nullcontext())
        processor = IndexProcessor()

        def generate_summary(*_args: object, **kwargs: object) -> tuple[str, None]:
            phase_events.append("worker")
            worker_session = kwargs["session"]
            assert isinstance(worker_session, Session)
            worker_sessions.append(worker_session)
            return "summary", None

        with (
            patch.object(processor, "format_preview", return_value=preview),
            patch(
                "core.rag.index_processor.index_processor.current_app",
                SimpleNamespace(_get_current_object=lambda: flask_app),
            ),
            patch.object(index_processor_module.session_factory, "create_session", sqlite_session_factory),
            patch.object(
                index_processor_module.ParagraphIndexProcessor,
                "generate_summary",
                side_effect=generate_summary,
            ) as generate_summary,
        ):
            result = processor.get_preview_output(
                chunks=[],
                dataset_id=dataset.id,
                document_id="",
                chunk_structure="text_model",
                summary_index_setting={"enable": True},
                session=sqlite_session,
            )

        assert all(item.summary == "summary" for item in result.preview)
        assert phase_events == ["commit", "worker", "worker"]
        call_sessions = [call.kwargs["session"] for call in generate_summary.call_args_list]
        assert all(call_session is not sqlite_session for call_session in call_sessions)
        assert call_sessions == worker_sessions
