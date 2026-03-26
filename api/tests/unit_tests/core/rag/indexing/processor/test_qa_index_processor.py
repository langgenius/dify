from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pandas as pd
import pytest
from werkzeug.datastructures import FileStorage

from core.entities.knowledge_entities import PreviewDetail
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.processor.qa_index_processor import QAIndexProcessor
from core.rag.models.document import AttachmentDocument, Document


class _ImmediateThread:
    def __init__(self, target, args=(), kwargs=None):
        self._target = target
        self._args = args
        self._kwargs = kwargs or {}

    def start(self) -> None:
        self._target(*self._args, **self._kwargs)

    def join(self) -> None:
        return None


class TestQAIndexProcessor:
    @pytest.fixture
    def processor(self) -> QAIndexProcessor:
        return QAIndexProcessor()

    @pytest.fixture
    def dataset(self) -> Mock:
        dataset = Mock()
        dataset.id = "dataset-1"
        dataset.tenant_id = "tenant-1"
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.is_multimodal = True
        return dataset

    @pytest.fixture
    def dataset_document(self) -> Mock:
        document = Mock()
        document.id = "doc-1"
        document.created_by = "user-1"
        return document

    @pytest.fixture
    def process_rule(self) -> dict:
        return {
            "mode": "custom",
            "rules": {"segmentation": {"max_tokens": 256, "chunk_overlap": 10, "separator": "\n"}},
        }

    def _rules(self) -> SimpleNamespace:
        segmentation = SimpleNamespace(max_tokens=256, chunk_overlap=10, separator="\n")
        return SimpleNamespace(segmentation=segmentation)

    def test_extract_forwards_automatic_flag(self, processor: QAIndexProcessor) -> None:
        extract_setting = Mock()
        expected_docs = [Document(page_content="chunk", metadata={})]

        with patch("core.rag.index_processor.processor.qa_index_processor.ExtractProcessor.extract") as mock_extract:
            mock_extract.return_value = expected_docs

            docs = processor.extract(extract_setting, process_rule_mode="automatic")

        assert docs == expected_docs
        mock_extract.assert_called_once_with(extract_setting=extract_setting, is_automatic=True)

    def test_transform_rejects_none_process_rule(self, processor: QAIndexProcessor) -> None:
        with pytest.raises(ValueError, match="No process rule found"):
            processor.transform([Document(page_content="text", metadata={})], process_rule=None)

    def test_transform_rejects_missing_rules_key(self, processor: QAIndexProcessor) -> None:
        with pytest.raises(ValueError, match="No rules found in process rule"):
            processor.transform([Document(page_content="text", metadata={})], process_rule={"mode": "custom"})

    def test_transform_preview_calls_formatter_once(
        self, processor: QAIndexProcessor, process_rule: dict, fake_flask_app
    ) -> None:
        document = Document(page_content="raw text", metadata={"dataset_id": "dataset-1", "document_id": "doc-1"})
        split_node = Document(page_content=".question", metadata={})
        splitter = Mock()
        splitter.split_documents.return_value = [split_node]

        def _append_document(flask_app, tenant_id, document_node, all_qa_documents, document_language):
            all_qa_documents.append(Document(page_content="Q1", metadata={"answer": "A1"}))

        with (
            patch(
                "core.rag.index_processor.processor.qa_index_processor.Rule.model_validate", return_value=self._rules()
            ),
            patch.object(processor, "_get_splitter", return_value=splitter),
            patch(
                "core.rag.index_processor.processor.qa_index_processor.CleanProcessor.clean", return_value="clean text"
            ),
            patch(
                "core.rag.index_processor.processor.qa_index_processor.helper.generate_text_hash", return_value="hash"
            ),
            patch(
                "core.rag.index_processor.processor.qa_index_processor.remove_leading_symbols",
                side_effect=lambda text: text.lstrip("."),
            ),
            patch.object(processor, "_format_qa_document", side_effect=_append_document) as mock_format,
            patch("core.rag.index_processor.processor.qa_index_processor.current_app") as mock_current_app,
        ):
            mock_current_app._get_current_object.return_value = fake_flask_app
            result = processor.transform(
                [document],
                process_rule=process_rule,
                preview=True,
                tenant_id="tenant-1",
                doc_language="English",
            )

        assert len(result) == 1
        assert result[0].metadata["answer"] == "A1"
        mock_format.assert_called_once()

    def test_transform_non_preview_uses_thread_batches(
        self, processor: QAIndexProcessor, process_rule: dict, fake_flask_app
    ) -> None:
        documents = [
            Document(page_content="doc-1", metadata={"document_id": "doc-1", "dataset_id": "dataset-1"}),
            Document(page_content="doc-2", metadata={"document_id": "doc-2", "dataset_id": "dataset-1"}),
        ]
        split_node = Document(page_content="question", metadata={})
        splitter = Mock()
        splitter.split_documents.return_value = [split_node]

        def _append_document(flask_app, tenant_id, document_node, all_qa_documents, document_language):
            all_qa_documents.append(Document(page_content=f"Q-{document_node.page_content}", metadata={"answer": "A"}))

        with (
            patch(
                "core.rag.index_processor.processor.qa_index_processor.Rule.model_validate", return_value=self._rules()
            ),
            patch.object(processor, "_get_splitter", return_value=splitter),
            patch(
                "core.rag.index_processor.processor.qa_index_processor.CleanProcessor.clean",
                side_effect=lambda text, _: text,
            ),
            patch(
                "core.rag.index_processor.processor.qa_index_processor.helper.generate_text_hash", return_value="hash"
            ),
            patch(
                "core.rag.index_processor.processor.qa_index_processor.remove_leading_symbols",
                side_effect=lambda text: text,
            ),
            patch.object(processor, "_format_qa_document", side_effect=_append_document) as mock_format,
            patch("core.rag.index_processor.processor.qa_index_processor.current_app") as mock_current_app,
            patch(
                "core.rag.index_processor.processor.qa_index_processor.threading.Thread", side_effect=_ImmediateThread
            ),
        ):
            mock_current_app._get_current_object.return_value = fake_flask_app
            result = processor.transform(documents, process_rule=process_rule, preview=False, tenant_id="tenant-1")

        assert len(result) == 2
        assert mock_format.call_count == 2

    def test_format_by_template_validates_file_type(self, processor: QAIndexProcessor) -> None:
        not_csv_file = Mock(spec=FileStorage)
        not_csv_file.filename = "qa.txt"

        with pytest.raises(ValueError, match="Only CSV files"):
            processor.format_by_template(not_csv_file)

    def test_format_by_template_parses_csv_rows(self, processor: QAIndexProcessor) -> None:
        csv_file = Mock(spec=FileStorage)
        csv_file.filename = "qa.csv"
        dataframe = pd.DataFrame([["Q1", "A1"], ["Q2", "A2"]])

        with patch("core.rag.index_processor.processor.qa_index_processor.pd.read_csv", return_value=dataframe):
            docs = processor.format_by_template(csv_file)

        assert [doc.page_content for doc in docs] == ["Q1", "Q2"]
        assert [doc.metadata["answer"] for doc in docs] == ["A1", "A2"]

    def test_format_by_template_raises_on_empty_csv(self, processor: QAIndexProcessor) -> None:
        csv_file = Mock(spec=FileStorage)
        csv_file.filename = "qa.csv"

        with patch("core.rag.index_processor.processor.qa_index_processor.pd.read_csv", return_value=pd.DataFrame()):
            with pytest.raises(ValueError, match="empty"):
                processor.format_by_template(csv_file)

    def test_format_by_template_raises_on_invalid_csv(self, processor: QAIndexProcessor) -> None:
        csv_file = Mock(spec=FileStorage)
        csv_file.filename = "qa.csv"

        with patch(
            "core.rag.index_processor.processor.qa_index_processor.pd.read_csv", side_effect=Exception("bad csv")
        ):
            with pytest.raises(ValueError, match="bad csv"):
                processor.format_by_template(csv_file)

    def test_load_creates_vectors_for_high_quality_dataset(self, processor: QAIndexProcessor, dataset: Mock) -> None:
        docs = [Document(page_content="Q1", metadata={"answer": "A1"})]
        multimodal_docs = [AttachmentDocument(page_content="image", metadata={})]

        with patch("core.rag.index_processor.processor.qa_index_processor.Vector") as mock_vector_cls:
            vector = mock_vector_cls.return_value
            processor.load(dataset, docs, multimodal_documents=multimodal_docs)

        vector.create.assert_called_once_with(docs)
        vector.create_multimodal.assert_called_once_with(multimodal_docs)

    def test_load_skips_vector_for_non_high_quality(self, processor: QAIndexProcessor, dataset: Mock) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        docs = [Document(page_content="Q1", metadata={"answer": "A1"})]

        with patch("core.rag.index_processor.processor.qa_index_processor.Vector") as mock_vector_cls:
            processor.load(dataset, docs)

        mock_vector_cls.assert_not_called()

    def test_clean_handles_summary_deletion_and_vector_cleanup(
        self, processor: QAIndexProcessor, dataset: Mock
    ) -> None:
        mock_segment = SimpleNamespace(id="seg-1")
        mock_query = Mock()
        mock_query.filter.return_value.all.return_value = [mock_segment]
        mock_session = Mock()
        mock_session.query.return_value = mock_query
        session_context = MagicMock()
        session_context.__enter__.return_value = mock_session
        session_context.__exit__.return_value = False

        with (
            patch(
                "core.rag.index_processor.processor.qa_index_processor.session_factory.create_session",
                return_value=session_context,
            ),
            patch(
                "core.rag.index_processor.processor.qa_index_processor.SummaryIndexService.delete_summaries_for_segments"
            ) as mock_summary,
            patch("core.rag.index_processor.processor.qa_index_processor.Vector") as mock_vector_cls,
        ):
            vector = mock_vector_cls.return_value
            processor.clean(dataset, ["node-1"], delete_summaries=True)

        mock_summary.assert_called_once_with(dataset, ["seg-1"])
        vector.delete_by_ids.assert_called_once_with(["node-1"])

    def test_clean_handles_dataset_wide_cleanup(self, processor: QAIndexProcessor, dataset: Mock) -> None:
        with (
            patch(
                "core.rag.index_processor.processor.qa_index_processor.SummaryIndexService.delete_summaries_for_segments"
            ) as mock_summary,
            patch("core.rag.index_processor.processor.qa_index_processor.Vector") as mock_vector_cls,
        ):
            vector = mock_vector_cls.return_value
            processor.clean(dataset, None, delete_summaries=True)

        mock_summary.assert_called_once_with(dataset, None)
        vector.delete.assert_called_once()

    def test_retrieve_filters_by_score_threshold(self, processor: QAIndexProcessor, dataset: Mock) -> None:
        result_ok = SimpleNamespace(page_content="accepted", metadata={"source": "a"}, score=0.9)
        result_low = SimpleNamespace(page_content="rejected", metadata={"source": "b"}, score=0.1)

        with patch("core.rag.index_processor.processor.qa_index_processor.RetrievalService.retrieve") as mock_retrieve:
            mock_retrieve.return_value = [result_ok, result_low]
            reranking_model = {"reranking_provider_name": "", "reranking_model_name": ""}
            docs = processor.retrieve("semantic_search", "query", dataset, 5, 0.5, reranking_model)

        assert len(docs) == 1
        assert docs[0].page_content == "accepted"
        assert docs[0].metadata["score"] == 0.9

    def test_index_adds_documents_and_vectors_for_high_quality(
        self, processor: QAIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
        qa_chunks = SimpleNamespace(
            qa_chunks=[
                SimpleNamespace(question="Q1", answer="A1"),
                SimpleNamespace(question="Q2", answer="A2"),
            ]
        )

        with (
            patch(
                "core.rag.index_processor.processor.qa_index_processor.QAStructureChunk.model_validate",
                return_value=qa_chunks,
            ),
            patch(
                "core.rag.index_processor.processor.qa_index_processor.helper.generate_text_hash", return_value="hash"
            ),
            patch("core.rag.index_processor.processor.qa_index_processor.DatasetDocumentStore") as mock_store_cls,
            patch("core.rag.index_processor.processor.qa_index_processor.Vector") as mock_vector_cls,
        ):
            processor.index(dataset, dataset_document, {"qa_chunks": []})

        mock_store_cls.return_value.add_documents.assert_called_once()
        mock_vector_cls.return_value.create.assert_called_once()

    def test_index_requires_high_quality(
        self, processor: QAIndexProcessor, dataset: Mock, dataset_document: Mock
    ) -> None:
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        qa_chunks = SimpleNamespace(qa_chunks=[SimpleNamespace(question="Q1", answer="A1")])

        with (
            patch(
                "core.rag.index_processor.processor.qa_index_processor.QAStructureChunk.model_validate",
                return_value=qa_chunks,
            ),
            patch(
                "core.rag.index_processor.processor.qa_index_processor.helper.generate_text_hash", return_value="hash"
            ),
            patch("core.rag.index_processor.processor.qa_index_processor.DatasetDocumentStore"),
        ):
            with pytest.raises(ValueError, match="must be high quality"):
                processor.index(dataset, dataset_document, {"qa_chunks": []})

    def test_format_preview_returns_qa_preview(self, processor: QAIndexProcessor) -> None:
        qa_chunks = SimpleNamespace(qa_chunks=[SimpleNamespace(question="Q1", answer="A1")])

        with patch(
            "core.rag.index_processor.processor.qa_index_processor.QAStructureChunk.model_validate",
            return_value=qa_chunks,
        ):
            preview = processor.format_preview({"qa_chunks": []})

        assert preview["chunk_structure"] == "qa_model"
        assert preview["total_segments"] == 1
        assert preview["qa_preview"] == [{"question": "Q1", "answer": "A1"}]

    def test_generate_summary_preview_returns_input(self, processor: QAIndexProcessor) -> None:
        preview_items = [PreviewDetail(content="Q1")]
        assert processor.generate_summary_preview("tenant-1", preview_items, {}) is preview_items

    def test_format_qa_document_ignores_blank_text(self, processor: QAIndexProcessor, fake_flask_app) -> None:
        all_qa_documents: list[Document] = []
        blank_document = Document(page_content="   ", metadata={})

        processor._format_qa_document(fake_flask_app, "tenant-1", blank_document, all_qa_documents, "English")

        assert all_qa_documents == []

    def test_format_qa_document_builds_question_answer_documents(
        self, processor: QAIndexProcessor, fake_flask_app
    ) -> None:
        all_qa_documents: list[Document] = []
        source_document = Document(page_content="source text", metadata={"origin": "doc-1"})

        with (
            patch(
                "core.rag.index_processor.processor.qa_index_processor.LLMGenerator.generate_qa_document",
                return_value="Q1: What is this?\nA1: A test.\nQ2: Why?\nA2: Coverage.",
            ),
            patch(
                "core.rag.index_processor.processor.qa_index_processor.helper.generate_text_hash", return_value="hash"
            ),
        ):
            processor._format_qa_document(fake_flask_app, "tenant-1", source_document, all_qa_documents, "English")

        assert len(all_qa_documents) == 2
        assert all_qa_documents[0].page_content == "What is this?"
        assert all_qa_documents[0].metadata["answer"] == "A test."
        assert all_qa_documents[1].metadata["answer"] == "Coverage."

    def test_format_qa_document_logs_errors(self, processor: QAIndexProcessor, fake_flask_app) -> None:
        all_qa_documents: list[Document] = []
        source_document = Document(page_content="source text", metadata={"origin": "doc-1"})

        with (
            patch(
                "core.rag.index_processor.processor.qa_index_processor.LLMGenerator.generate_qa_document",
                side_effect=RuntimeError("llm failure"),
            ),
            patch("core.rag.index_processor.processor.qa_index_processor.logger") as mock_logger,
        ):
            processor._format_qa_document(fake_flask_app, "tenant-1", source_document, all_qa_documents, "English")

        assert all_qa_documents == []
        mock_logger.exception.assert_called_once_with("Failed to format qa document")

    def test_format_split_text_extracts_question_answer_pairs(self, processor: QAIndexProcessor) -> None:
        parsed = processor._format_split_text("Q1: First?\nA1: One.\nQ2: Second?\nA2: Two.\n")

        assert parsed == [{"question": "First?", "answer": "One."}, {"question": "Second?", "answer": "Two."}]
