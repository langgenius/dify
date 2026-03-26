from unittest.mock import Mock, patch

from core.rag.index_processor.index_processor import IndexProcessor


class TestIndexProcessor:
    def test_format_preview_supports_qa_preview_shape(self) -> None:
        # QAIndexProcessor.format_preview returns a dict without a "preview" key.
        qa_preview_dict = {
            "chunk_structure": "qa_model",
            "qa_preview": [{"question": "Q1", "answer": "A1"}],
            "total_segments": 1,
        }

        mock_processor = Mock()
        mock_processor.format_preview.return_value = qa_preview_dict

        with patch(
            "core.rag.index_processor.index_processor.IndexProcessorFactory.init_index_processor",
            return_value=mock_processor,
        ):
            preview = IndexProcessor().format_preview("qa_model", {"qa_chunks": []})

        assert preview.chunk_structure == "qa_model"
        assert preview.total_segments == 1
        assert len(preview.qa_preview) == 1
        assert preview.qa_preview[0].question == "Q1"
        assert preview.qa_preview[0].answer == "A1"

