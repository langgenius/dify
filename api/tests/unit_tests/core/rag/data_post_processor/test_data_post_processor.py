from unittest.mock import MagicMock, patch

from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError

from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.data_post_processor.reorder import ReorderRunner
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode


def _doc(content: str) -> Document:
    return Document(page_content=content)


class TestDataPostProcessor:
    def test_init_sets_rerank_and_reorder_runners(self):
        rerank_runner = object()
        reorder_runner = object()

        with patch.object(DataPostProcessor, "_get_rerank_runner", return_value=rerank_runner) as rerank_mock:
            with patch.object(DataPostProcessor, "_get_reorder_runner", return_value=reorder_runner) as reorder_mock:
                processor = DataPostProcessor(
                    tenant_id="tenant-1",
                    reranking_mode=RerankMode.WEIGHTED_SCORE,
                    reranking_model={"config": "value"},
                    weights={"weight": "value"},
                    reorder_enabled=True,
                )

        assert processor.rerank_runner is rerank_runner
        assert processor.reorder_runner is reorder_runner
        rerank_mock.assert_called_once_with(
            RerankMode.WEIGHTED_SCORE,
            "tenant-1",
            {"config": "value"},
            {"weight": "value"},
        )
        reorder_mock.assert_called_once_with(True)

    def test_invoke_applies_rerank_then_reorder(self):
        original_documents = [_doc("doc-a")]
        reranked_documents = [_doc("doc-b")]
        reordered_documents = [_doc("doc-c")]

        processor = DataPostProcessor.__new__(DataPostProcessor)
        processor.rerank_runner = MagicMock()
        processor.rerank_runner.run.return_value = reranked_documents
        processor.reorder_runner = MagicMock()
        processor.reorder_runner.run.return_value = reordered_documents

        result = processor.invoke(
            query="how to test",
            documents=original_documents,
            score_threshold=0.3,
            top_n=2,
            query_type=QueryType.IMAGE_QUERY,
        )

        processor.rerank_runner.run.assert_called_once_with(
            "how to test",
            original_documents,
            0.3,
            2,
            QueryType.IMAGE_QUERY,
        )
        processor.reorder_runner.run.assert_called_once_with(reranked_documents)
        assert result == reordered_documents

    def test_invoke_returns_original_documents_when_no_runner_is_configured(self):
        documents = [_doc("doc-a"), _doc("doc-b")]

        processor = DataPostProcessor.__new__(DataPostProcessor)
        processor.rerank_runner = None
        processor.reorder_runner = None

        assert processor.invoke(query="query", documents=documents) == documents

    def test_get_rerank_runner_for_weighted_score(self):
        weights_config = {
            "vector_setting": {
                "vector_weight": 0.7,
                "embedding_provider_name": "provider-x",
                "embedding_model_name": "embedding-y",
            },
            "keyword_setting": {"keyword_weight": 0.3},
        }
        expected_runner = object()
        processor = DataPostProcessor.__new__(DataPostProcessor)

        with patch(
            "core.rag.data_post_processor.data_post_processor.RerankRunnerFactory.create_rerank_runner",
            return_value=expected_runner,
        ) as factory_mock:
            result = processor._get_rerank_runner(
                reranking_mode=RerankMode.WEIGHTED_SCORE,
                tenant_id="tenant-1",
                reranking_model=None,
                weights=weights_config,
            )

        assert result is expected_runner
        kwargs = factory_mock.call_args.kwargs
        assert kwargs["runner_type"] == RerankMode.WEIGHTED_SCORE
        assert kwargs["tenant_id"] == "tenant-1"
        assert kwargs["weights"].vector_setting.vector_weight == 0.7
        assert kwargs["weights"].vector_setting.embedding_provider_name == "provider-x"
        assert kwargs["weights"].vector_setting.embedding_model_name == "embedding-y"
        assert kwargs["weights"].keyword_setting.keyword_weight == 0.3

    def test_get_rerank_runner_for_reranking_model_returns_none_without_model_instance(self):
        processor = DataPostProcessor.__new__(DataPostProcessor)
        reranking_model = {
            "reranking_provider_name": "provider-x",
            "reranking_model_name": "model-y",
        }

        with patch.object(DataPostProcessor, "_get_rerank_model_instance", return_value=None) as model_mock:
            with patch(
                "core.rag.data_post_processor.data_post_processor.RerankRunnerFactory.create_rerank_runner"
            ) as factory_mock:
                result = processor._get_rerank_runner(
                    reranking_mode=RerankMode.RERANKING_MODEL,
                    tenant_id="tenant-1",
                    reranking_model=reranking_model,
                    weights=None,
                )

        assert result is None
        model_mock.assert_called_once_with("tenant-1", reranking_model)
        factory_mock.assert_not_called()

    def test_get_rerank_runner_for_reranking_model_creates_runner_with_model_instance(self):
        processor = DataPostProcessor.__new__(DataPostProcessor)
        model_instance = object()
        expected_runner = object()

        with patch.object(DataPostProcessor, "_get_rerank_model_instance", return_value=model_instance):
            with patch(
                "core.rag.data_post_processor.data_post_processor.RerankRunnerFactory.create_rerank_runner",
                return_value=expected_runner,
            ) as factory_mock:
                result = processor._get_rerank_runner(
                    reranking_mode=RerankMode.RERANKING_MODEL,
                    tenant_id="tenant-1",
                    reranking_model={
                        "reranking_provider_name": "provider-x",
                        "reranking_model_name": "model-y",
                    },
                    weights=None,
                )

        assert result is expected_runner
        factory_mock.assert_called_once_with(
            runner_type=RerankMode.RERANKING_MODEL,
            rerank_model_instance=model_instance,
        )

    def test_get_rerank_runner_returns_none_for_unsupported_mode(self):
        processor = DataPostProcessor.__new__(DataPostProcessor)

        assert processor._get_rerank_runner("unsupported", "tenant-1", None, None) is None
        assert processor._get_rerank_runner(RerankMode.WEIGHTED_SCORE, "tenant-1", None, None) is None

    def test_get_reorder_runner_by_flag(self):
        processor = DataPostProcessor.__new__(DataPostProcessor)

        assert isinstance(processor._get_reorder_runner(True), ReorderRunner)
        assert processor._get_reorder_runner(False) is None

    def test_get_rerank_model_instance_returns_none_when_config_is_missing(self):
        processor = DataPostProcessor.__new__(DataPostProcessor)
        assert processor._get_rerank_model_instance("tenant-1", None) is None

    def test_get_rerank_model_instance_returns_none_for_incomplete_config(self):
        processor = DataPostProcessor.__new__(DataPostProcessor)

        with patch("core.rag.data_post_processor.data_post_processor.ModelManager.for_tenant") as for_tenant_mock:
            result = processor._get_rerank_model_instance(
                tenant_id="tenant-1",
                reranking_model={"reranking_provider_name": "provider-x"},
            )

        assert result is None
        for_tenant_mock.assert_called_once_with(tenant_id="tenant-1")

    def test_get_rerank_model_instance_success(self):
        processor = DataPostProcessor.__new__(DataPostProcessor)
        model_instance = object()

        with patch("core.rag.data_post_processor.data_post_processor.ModelManager.for_tenant") as for_tenant_mock:
            manager_instance = for_tenant_mock.return_value
            manager_instance.get_model_instance.return_value = model_instance

            result = processor._get_rerank_model_instance(
                tenant_id="tenant-1",
                reranking_model={
                    "reranking_provider_name": "provider-x",
                    "reranking_model_name": "reranker-1",
                },
            )

        assert result is model_instance
        for_tenant_mock.assert_called_once_with(tenant_id="tenant-1")
        manager_instance.get_model_instance.assert_called_once_with(
            tenant_id="tenant-1",
            provider="provider-x",
            model_type=ModelType.RERANK,
            model="reranker-1",
        )

    def test_get_rerank_model_instance_handles_authorization_error(self):
        processor = DataPostProcessor.__new__(DataPostProcessor)

        with patch("core.rag.data_post_processor.data_post_processor.ModelManager.for_tenant") as for_tenant_mock:
            manager_instance = for_tenant_mock.return_value
            manager_instance.get_model_instance.side_effect = InvokeAuthorizationError("not authorized")

            result = processor._get_rerank_model_instance(
                tenant_id="tenant-1",
                reranking_model={
                    "reranking_provider_name": "provider-x",
                    "reranking_model_name": "reranker-1",
                },
            )

        assert result is None
        for_tenant_mock.assert_called_once_with(tenant_id="tenant-1")


class TestDataPostProcessorFallbackFiltering:
    """Tests for the score-threshold fallback path in DataPostProcessor.invoke.

    The fallback activates when rerank_runner is None but score_threshold is set
    (e.g. after a model authorisation failure).  It filters documents by their
    metadata["score"] value, defaulting missing or absent scores to 0.
    """

    def _doc_with_score(self, content: str, score: float) -> Document:
        return Document(page_content=content, metadata={"score": score})

    def test_filters_documents_below_score_threshold(self):
        docs = [
            self._doc_with_score("low", 0.3),
            self._doc_with_score("exact", 0.5),
            self._doc_with_score("high", 0.8),
        ]
        processor = DataPostProcessor.__new__(DataPostProcessor)
        processor.rerank_runner = None
        processor.reorder_runner = None

        result = processor.invoke(query="q", documents=docs, score_threshold=0.5)

        assert [d.page_content for d in result] == ["exact", "high"]

    def test_passes_all_documents_when_score_threshold_is_none(self):
        docs = [
            self._doc_with_score("a", 0.1),
            self._doc_with_score("b", 0.9),
        ]
        processor = DataPostProcessor.__new__(DataPostProcessor)
        processor.rerank_runner = None
        processor.reorder_runner = None

        result = processor.invoke(query="q", documents=docs, score_threshold=None)

        assert result == docs

    def test_filters_document_without_metadata(self):
        # A document with no metadata at all has an effective score of 0
        # and must be removed when the threshold is > 0.
        doc_no_meta = Document(page_content="no-meta")
        doc_with_score = self._doc_with_score("scored", 0.6)
        processor = DataPostProcessor.__new__(DataPostProcessor)
        processor.rerank_runner = None
        processor.reorder_runner = None

        result = processor.invoke(query="q", documents=[doc_no_meta, doc_with_score], score_threshold=0.5)

        assert result == [doc_with_score]

    def test_filters_document_with_missing_score_key(self):
        # metadata present but 'score' key absent → defaults to 0.
        doc_no_score_key = Document(page_content="no-key", metadata={"doc_id": "x"})
        doc_with_score = self._doc_with_score("scored", 0.7)
        processor = DataPostProcessor.__new__(DataPostProcessor)
        processor.rerank_runner = None
        processor.reorder_runner = None

        result = processor.invoke(query="q", documents=[doc_no_score_key, doc_with_score], score_threshold=0.5)

        assert result == [doc_with_score]

    def test_fallback_still_applies_reorder_runner(self):
        docs = [
            self._doc_with_score("0", 0.9),
            self._doc_with_score("1", 0.8),
            self._doc_with_score("2", 0.7),
            self._doc_with_score("3", 0.6),
        ]
        reordered = [self._doc_with_score("reordered", 1.0)]

        processor = DataPostProcessor.__new__(DataPostProcessor)
        processor.rerank_runner = None
        processor.reorder_runner = MagicMock()
        processor.reorder_runner.run.return_value = reordered

        result = processor.invoke(query="q", documents=docs, score_threshold=0.7)

        # score_threshold=0.7 keeps docs with scores 0.9, 0.8, 0.7
        filtered = [d for d in docs if d.metadata["score"] >= 0.7]
        processor.reorder_runner.run.assert_called_once_with(filtered)
        assert result == reordered


class TestReorderRunner:
    def test_run_reorders_even_sized_document_list(self):
        documents = [_doc("0"), _doc("1"), _doc("2"), _doc("3"), _doc("4"), _doc("5")]

        reordered = ReorderRunner().run(documents)

        assert [document.page_content for document in reordered] == ["0", "2", "4", "5", "3", "1"]

    def test_run_handles_odd_sized_and_empty_document_lists(self):
        odd_documents = [_doc("0"), _doc("1"), _doc("2"), _doc("3"), _doc("4")]
        runner = ReorderRunner()

        odd_reordered = runner.run(odd_documents)

        assert [document.page_content for document in odd_reordered] == ["0", "2", "4", "3", "1"]
        assert runner.run([]) == []
