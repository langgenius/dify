import datetime
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessor
from core.workflow.nodes.knowledge_index.protocols import Preview, PreviewItem
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus


def _dataset() -> Dataset:
    dataset = Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        created_by="00000000-0000-0000-0000-000000000001",
        chunk_structure="text_model",
    )
    dataset.summary_index_setting = None
    return dataset


def _document(document_id: str = "doc-1") -> Document:
    document = Document(
        id=document_id,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.WEB,
        created_by="00000000-0000-0000-0000-000000000001",
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        archived=False,
        doc_form="text_model",
        word_count=0,
        tokens=0,
        need_summary=False,
    )
    document.created_at = datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC)
    return document


def _segment(index_node_id: str | None) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="original-doc",
        position=1,
        content="old content",
        word_count=2,
        tokens=2,
        created_by="00000000-0000-0000-0000-000000000001",
        index_node_id=index_node_id,
        status=SegmentStatus.COMPLETED,
    )
    segment.id = "segment-1"
    return segment


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

    def test_index_and_clean_ends_transactions_around_index_io(self) -> None:
        document = _document("document-1")
        dataset = _dataset()
        session = MagicMock()
        session.scalar.side_effect = [dataset, document, 3]
        phase_events: list[str] = []
        session.commit.side_effect = lambda: phase_events.append("commit")

        index_processor = MagicMock()
        index_processor.index.side_effect = lambda *args: phase_events.append("index")

        with patch("core.rag.index_processor.index_processor.IndexProcessorFactory") as index_processor_factory:
            index_processor_factory.return_value.init_index_processor.return_value = index_processor
            IndexProcessor().index_and_clean(
                dataset_id=dataset.id,
                document_id=document.id,
                original_document_id="",
                chunks={"general_chunks": ["content"]},
                batch="batch-1",
                session=session,
            )

        assert phase_events == ["commit", "index", "commit"]

    def test_index_and_clean_scopes_replacement_queries_to_dataset_owner(self) -> None:
        dataset = _dataset()
        document = _document()
        segment = _segment("node-1")
        session = MagicMock()

        def resolve_owner(statement):
            entity = statement.column_descriptions[0]["entity"]
            if entity is Dataset:
                return dataset
            if entity is Document:
                return document
            return 3

        session.scalar.side_effect = resolve_owner
        session.scalars.return_value.all.return_value = [segment]

        with patch("core.rag.index_processor.index_processor.IndexProcessorFactory") as index_processor_factory:
            index_backend = index_processor_factory.return_value.init_index_processor.return_value
            IndexProcessor().index_and_clean(
                dataset_id="dataset-1",
                document_id="doc-1",
                original_document_id="original-doc",
                chunks={},
                batch="batch-1",
                session=session,
            )

        document_statement = next(
            call.args[0]
            for call in session.scalar.call_args_list
            if call.args[0].column_descriptions[0]["entity"] is Document
        )
        segment_statement = session.scalars.call_args.args[0]
        delete_statement = session.execute.call_args_list[0].args[0]
        word_count_statement = session.scalar.call_args_list[-1].args[0]
        segment_update_statement = session.execute.call_args_list[1].args[0]
        document_owner = {"doc-1", "dataset-1", "tenant-1"}
        original_document_owner = {"original-doc", "dataset-1", "tenant-1"}

        assert document_owner <= set(document_statement.compile().params.values())
        assert original_document_owner <= set(segment_statement.compile().params.values())
        assert original_document_owner <= set(delete_statement.compile().params.values())
        assert document_owner <= set(word_count_statement.compile().params.values())
        assert document_owner <= set(segment_update_statement.compile().params.values())
        index_backend.clean.assert_called_once_with(
            dataset,
            ["node-1"],
            with_keywords=True,
            delete_child_chunks=True,
            delete_summaries=True,
            segment_ids=["segment-1"],
            session=session,
        )
        index_backend.index.assert_called_once_with(dataset, document, {}, session)

    def test_index_and_clean_removes_summaries_when_replaced_segments_have_no_vector_ids(self) -> None:
        dataset = _dataset()
        document = _document()
        segment = _segment(None)
        session = MagicMock()

        def resolve_owner(statement):
            entity = statement.column_descriptions[0]["entity"]
            if entity is Dataset:
                return dataset
            if entity is Document:
                return document
            return 0

        session.scalar.side_effect = resolve_owner
        session.scalars.return_value.all.return_value = [segment]

        with patch("core.rag.index_processor.index_processor.IndexProcessorFactory") as index_processor_factory:
            index_backend = index_processor_factory.return_value.init_index_processor.return_value
            IndexProcessor().index_and_clean(
                dataset_id="dataset-1",
                document_id="doc-1",
                original_document_id="original-doc",
                chunks={},
                batch="batch-1",
                session=session,
            )

        index_backend.clean.assert_called_once_with(
            dataset,
            [],
            with_keywords=True,
            delete_child_chunks=True,
            delete_summaries=True,
            segment_ids=["segment-1"],
            session=session,
        )
        assert any("DELETE FROM document_segments" in str(call.args[0]) for call in session.execute.call_args_list)

    def test_get_preview_output_scopes_document_to_dataset_owner(self) -> None:
        dataset = SimpleNamespace(
            id="dataset-1",
            tenant_id="tenant-1",
            indexing_technique=IndexTechniqueType.ECONOMY,
            summary_index_setting=None,
        )
        document = SimpleNamespace(doc_language="English")
        session = MagicMock()

        def resolve_owner(statement):
            entity = statement.column_descriptions[0]["entity"]
            if entity is Dataset:
                return dataset
            if entity is Document:
                return document
            raise AssertionError(f"Unexpected entity: {entity}")

        session.scalar.side_effect = resolve_owner
        processor = IndexProcessor()
        expected_preview = MagicMock()

        with patch.object(processor, "format_preview", return_value=expected_preview):
            result = processor.get_preview_output(
                chunks={},
                dataset_id="dataset-1",
                document_id="doc-1",
                chunk_structure="text_model",
                summary_index_setting=None,
                session=session,
            )

        document_statement = next(
            call.args[0]
            for call in session.scalar.call_args_list
            if call.args[0].column_descriptions[0]["entity"] is Document
        )
        assert {"doc-1", "dataset-1", "tenant-1"} <= set(document_statement.compile().params.values())
        assert result is expected_preview

    def test_preview_summary_releases_caller_session_before_workers(self) -> None:
        caller_session = MagicMock()
        phase_events: list[str] = []
        caller_session.commit.side_effect = lambda: phase_events.append("commit")
        caller_session.scalar.return_value = SimpleNamespace(
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            summary_index_setting={"enable": True},
            tenant_id="tenant-1",
        )
        preview = Preview(
            chunk_structure="text_model",
            total_segments=2,
            preview=[PreviewItem(content="chunk-1"), PreviewItem(content="chunk-2")],
        )
        flask_app = SimpleNamespace(app_context=lambda: nullcontext())
        processor = IndexProcessor()

        def generate_summary_side_effect(**_kwargs: object) -> tuple[str, None]:
            assert phase_events
            assert phase_events[0] == "commit"
            phase_events.append("summary")
            return "summary", None

        with (
            patch.object(processor, "format_preview", return_value=preview),
            patch(
                "core.rag.index_processor.index_processor.current_app",
                SimpleNamespace(_get_current_object=lambda: flask_app),
            ),
            patch(
                "core.rag.index_processor.index_processor.ParagraphIndexProcessor.generate_summary",
                side_effect=generate_summary_side_effect,
            ) as generate_summary_mock,
        ):
            result = processor.get_preview_output(
                chunks=[],
                dataset_id="dataset-1",
                document_id="",
                chunk_structure="text_model",
                summary_index_setting={"enable": True},
                session=caller_session,
            )

        assert all(item.summary == "summary" for item in result.preview)
        assert phase_events == ["commit", "summary", "summary"]
        assert all("session" not in call.kwargs for call in generate_summary_mock.call_args_list)
        assert {call.kwargs["text"] for call in generate_summary_mock.call_args_list} == {"chunk-1", "chunk-2"}
