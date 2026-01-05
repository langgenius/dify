import threading
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from flask import Flask, current_app

from core.rag.models.document import Document
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from models.dataset import Dataset


class TestRetrievalService:
    @pytest.fixture
    def mock_dataset(self) -> Dataset:
        dataset = Mock(spec=Dataset)
        dataset.id = str(uuid4())
        dataset.tenant_id = str(uuid4())
        dataset.name = "test_dataset"
        dataset.indexing_technique = "high_quality"
        dataset.provider = "dify"
        return dataset

    def test_multiple_retrieve_reranking_with_app_context(self, mock_dataset):
        """
        Repro test for current bug:
        reranking runs after `with flask_app.app_context():` exits.
        `_multiple_retrieve_thread` catches exceptions and stores them into `thread_exceptions`,
        so we must assert from that list (not from an outer try/except).
        """
        dataset_retrieval = DatasetRetrieval()
        flask_app = Flask(__name__)
        tenant_id = str(uuid4())

        # second dataset to ensure dataset_count > 1 reranking branch
        secondary_dataset = Mock(spec=Dataset)
        secondary_dataset.id = str(uuid4())
        secondary_dataset.provider = "dify"
        secondary_dataset.indexing_technique = "high_quality"

        # retriever returns 1 doc into internal list (all_documents_item)
        document = Document(
            page_content="Context aware doc",
            metadata={
                "doc_id": "doc1",
                "score": 0.95,
                "document_id": str(uuid4()),
                "dataset_id": mock_dataset.id,
            },
            provider="dify",
        )

        def fake_retriever(
            flask_app, dataset_id, query, top_k, all_documents, document_ids_filter, metadata_condition, attachment_ids
        ):
            all_documents.append(document)

        called = {"init": 0, "invoke": 0}

        class ContextRequiredPostProcessor:
            def __init__(self, *args, **kwargs):
                called["init"] += 1
                # will raise RuntimeError if no Flask app context exists
                _ = current_app.name

            def invoke(self, *args, **kwargs):
                called["invoke"] += 1
                _ = current_app.name
                return kwargs.get("documents") or args[1]

        # output list from _multiple_retrieve_thread
        all_documents: list[Document] = []

        # IMPORTANT: _multiple_retrieve_thread swallows exceptions and appends them here
        thread_exceptions: list[Exception] = []

        def target():
            with patch.object(dataset_retrieval, "_retriever", side_effect=fake_retriever):
                with patch(
                    "core.rag.retrieval.dataset_retrieval.DataPostProcessor",
                    ContextRequiredPostProcessor,
                ):
                    dataset_retrieval._multiple_retrieve_thread(
                        flask_app=flask_app,
                        available_datasets=[mock_dataset, secondary_dataset],
                        metadata_condition=None,
                        metadata_filter_document_ids=None,
                        all_documents=all_documents,
                        tenant_id=tenant_id,
                        reranking_enable=True,
                        reranking_mode="reranking_model",
                        reranking_model={
                            "reranking_provider_name": "cohere",
                            "reranking_model_name": "rerank-v2",
                        },
                        weights=None,
                        top_k=3,
                        score_threshold=0.0,
                        query="test query",
                        attachment_id=None,
                        dataset_count=2,  # force reranking branch
                        thread_exceptions=thread_exceptions,  # ✅ key
                    )

        t = threading.Thread(target=target)
        t.start()
        t.join()

        # Ensure reranking branch was actually executed
        assert called["init"] >= 1, "DataPostProcessor was never constructed; reranking branch may not have run."

        # Current buggy code should record an exception (not raise it)
        assert not thread_exceptions, thread_exceptions
