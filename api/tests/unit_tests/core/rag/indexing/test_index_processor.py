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
