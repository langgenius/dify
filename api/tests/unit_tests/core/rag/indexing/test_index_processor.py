import datetime
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.index_processor import IndexProcessor
from core.workflow.nodes.knowledge_index.protocols import Preview, PreviewItem
from models.dataset import Dataset, Document


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
        document = SimpleNamespace(
            id="document-1",
            name="Document",
            created_at=datetime.datetime(2026, 1, 1),
            indexing_latency=None,
            indexing_status=None,
            completed_at=None,
            word_count=0,
            need_summary=False,
        )
        dataset = SimpleNamespace(
            id="dataset-1",
            tenant_id="tenant-1",
            name="Dataset",
            chunk_structure="text_model",
            summary_index_setting=None,
        )
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
        dataset = SimpleNamespace(
            id="dataset-1",
            tenant_id="tenant-1",
            name="Dataset",
            summary_index_setting=None,
            chunk_structure="text_model",
        )
        document = SimpleNamespace(
            id="doc-1",
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            name="Document",
            created_at=datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC),
        )
        segment = SimpleNamespace(index_node_id="node-1")
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
            session=session,
        )
        index_backend.index.assert_called_once_with(dataset, document, {}, session)

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

    def test_preview_summary_workers_use_independent_sessions(self) -> None:
        caller_session = MagicMock()
        phase_events: list[str] = []
        caller_session.commit.side_effect = lambda: phase_events.append("commit")
        caller_session.scalar.return_value = SimpleNamespace(
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            summary_index_setting={"enable": True},
            tenant_id="tenant-1",
        )
        worker_sessions = [MagicMock(), MagicMock()]
        preview = Preview(
            chunk_structure="text_model",
            total_segments=2,
            preview=[PreviewItem(content="chunk-1"), PreviewItem(content="chunk-2")],
        )
        flask_app = SimpleNamespace(app_context=lambda: nullcontext())
        processor = IndexProcessor()
        worker_contexts = iter(nullcontext(worker_session) for worker_session in worker_sessions)

        def create_worker_session():
            phase_events.append("worker")
            return next(worker_contexts)

        with (
            patch.object(processor, "format_preview", return_value=preview),
            patch(
                "core.rag.index_processor.index_processor.current_app",
                SimpleNamespace(_get_current_object=lambda: flask_app),
            ),
            patch(
                "core.rag.index_processor.index_processor.session_factory.create_session",
                side_effect=create_worker_session,
            ),
            patch(
                "core.rag.index_processor.index_processor.ParagraphIndexProcessor.generate_summary",
                return_value=("summary", None),
            ) as generate_summary,
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
        assert phase_events == ["commit", "worker", "worker"]
        call_sessions = [call.kwargs["session"] for call in generate_summary.call_args_list]
        assert all(call_session is not caller_session for call_session in call_sessions)
        assert all(
            any(call_session is worker_session for worker_session in worker_sessions) for call_session in call_sessions
        )
