import uuid
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor import index_processor as index_processor_module
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessor
from core.workflow.nodes.knowledge_index.protocols import Preview, PreviewItem
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, SegmentStatus


def _persist_dataset_and_document(
    session: Session,
    *,
    indexing_technique: IndexTechniqueType = IndexTechniqueType.HIGH_QUALITY,
    summary_index_setting: dict | None = None,
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
        processor = IndexProcessor()
        admission_service = MagicMock()
        chunks = {"general_chunks": ["content"]}

        with (
            patch(
                "core.rag.index_processor.index_processor.VectorSpaceAdmissionService",
                return_value=admission_service,
            ),
            patch("core.rag.index_processor.index_processor.IndexProcessorFactory") as index_processor_factory,
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

        assert phase_events == ["commit", "index", "commit"]
        admission_service.ensure_pipeline_can_be_indexed.assert_called_once_with(
            dataset=dataset,
            document_id=document.id,
            chunk_structure=dataset.chunk_structure,
            chunks=chunks,
            include_summaries=False,
            session=sqlite_session,
        )

    def test_index_and_clean_skips_admission_for_replacement_without_existing_vector_points(
        self, sqlite_session: Session
    ) -> None:
        dataset, document = _persist_dataset_and_document(sqlite_session)
        index_processor = MagicMock()
        processor = IndexProcessor()
        chunks = {"general_chunks": ["content"]}

        with (
            patch("core.rag.index_processor.index_processor.VectorSpaceAdmissionService") as admission_service_class,
            patch("core.rag.index_processor.index_processor.IndexProcessorFactory") as index_processor_factory,
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
            content="old content",
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
        sqlite_session.add_all([original_document, segment, control_segment])
        sqlite_session.flush()

        processor = IndexProcessor()
        with (
            patch("core.rag.index_processor.index_processor.VectorSpaceAdmissionService") as admission_service_class,
            patch("core.rag.index_processor.index_processor.IndexProcessorFactory") as index_processor_factory,
        ):
            index_backend = index_processor_factory.return_value.init_index_processor.return_value
            processor.index_and_clean(
                dataset_id=dataset.id,
                document_id=document.id,
                original_document_id=original_document.id,
                chunks={},
                batch="batch-1",
                session=sqlite_session,
            )

        assert sqlite_session.get(DocumentSegment, segment.id) is None
        assert sqlite_session.get(DocumentSegment, control_segment.id) is control_segment
        assert sqlite_session.get(Document, document.id).indexing_status == "completed"
        index_backend.clean.assert_called_once_with(
            dataset,
            ["node-1"],
            with_keywords=True,
            delete_child_chunks=True,
            session=sqlite_session,
        )
        index_backend.index.assert_called_once_with(dataset, document, {}, sqlite_session)
        admission_service_class.assert_not_called()

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

        def generate_summary(*_args, **kwargs):
            phase_events.append("worker")
            worker_sessions.append(kwargs["session"])
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
