import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.rag.index_processor.index_processor import IndexProcessor


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
            name="Dataset",
            chunk_structure="text_model",
            summary_index_setting=None,
        )
        session = MagicMock()
        session.scalar.side_effect = [document, dataset, 3]
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
