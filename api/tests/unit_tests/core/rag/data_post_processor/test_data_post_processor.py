from unittest.mock import patch

from sqlalchemy.orm import sessionmaker

from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.data_post_processor.reorder import ReorderRunner
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.rerank_base import BaseRerankRunner
from core.rag.rerank.rerank_type import RerankMode
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError


def _doc(content: str) -> Document:
    return Document(page_content=content)


class RecordingRerankRunner(BaseRerankRunner):
    def __init__(self, result: list[Document]) -> None:
        self.result = result
        self.calls: list[tuple[str, list[Document], float | None, int | None, QueryType]] = []

    def run(
        self,
        query: str,
        documents: list[Document],
        score_threshold: float | None,
        top_n: int | None,
        query_type: QueryType,
    ) -> list[Document]:
        self.calls.append((query, documents, score_threshold, top_n, query_type))
        return self.result


class RecordingReorderRunner(ReorderRunner):
    def __init__(self, result: list[Document]) -> None:
        self.result = result
        self.calls: list[list[Document]] = []

    def run(self, documents: list[Document]) -> list[Document]:
        self.calls.append(documents)
        return self.result


class TestDataPostProcessor:
    def test_init_sets_rerank_and_reorder_runners(self):
        rerank_runner = object()
        reorder_runner = object()
        session_factory = sessionmaker()

        with patch.object(DataPostProcessor, "_get_rerank_runner", return_value=rerank_runner) as rerank_mock:
            with patch.object(DataPostProcessor, "_get_reorder_runner", return_value=reorder_runner) as reorder_mock:
                processor = DataPostProcessor(
                    tenant_id="tenant-1",
                    reranking_mode=RerankMode.WEIGHTED_SCORE,
                    reranking_model={"config": "value"},
                    weights={"weight": "value"},
                    reorder_enabled=True,
                    session_factory=session_factory,
                    dataset_document_filters={"dataset-1": None},
                )

        assert processor.rerank_runner is rerank_runner
        assert processor.reorder_runner is reorder_runner
        rerank_mock.assert_called_once_with(
            RerankMode.WEIGHTED_SCORE,
            "tenant-1",
            {"config": "value"},
            {"weight": "value"},
            session_factory=session_factory,
            dataset_document_filters={"dataset-1": None},
        )
        reorder_mock.assert_called_once_with(True)

    def test_invoke_applies_rerank_then_reorder(self):
        original_documents = [_doc("doc-a")]
        reranked_documents = [_doc("doc-b")]
        reordered_documents = [_doc("doc-c")]

        processor = DataPostProcessor.__new__(DataPostProcessor)
        rerank_runner = RecordingRerankRunner(reranked_documents)
        reorder_runner = RecordingReorderRunner(reordered_documents)
        processor.rerank_runner = rerank_runner
        processor.reorder_runner = reorder_runner

        result = processor.invoke(
            query="how to test",
            documents=original_documents,
            score_threshold=0.3,
            top_n=2,
            query_type=QueryType.IMAGE_QUERY,
        )

        assert rerank_runner.calls == [("how to test", original_documents, 0.3, 2, QueryType.IMAGE_QUERY)]
        assert reorder_runner.calls == [reranked_documents]
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
        session_factory = sessionmaker()

        with patch(
            "core.rag.data_post_processor.data_post_processor.RerankRunnerFactory.create_rerank_runner",
            return_value=expected_runner,
        ) as factory_mock:
            result = processor._get_rerank_runner(
                reranking_mode=RerankMode.WEIGHTED_SCORE,
                tenant_id="tenant-1",
                reranking_model=None,
                weights=weights_config,
                session_factory=session_factory,
                dataset_document_filters={"dataset-1": None},
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
        session_factory = sessionmaker()
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
                    session_factory=session_factory,
                    dataset_document_filters={"dataset-1": None},
                )

        assert result is None
        model_mock.assert_called_once_with("tenant-1", reranking_model)
        factory_mock.assert_not_called()

    def test_get_rerank_runner_for_reranking_model_creates_runner_with_model_instance(self):
        processor = DataPostProcessor.__new__(DataPostProcessor)
        model_instance = object()
        expected_runner = object()
        session_factory = sessionmaker()

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
                    session_factory=session_factory,
                    dataset_document_filters={"dataset-1": ("document-1",)},
                )

        assert result is expected_runner
        factory_mock.assert_called_once_with(
            runner_type=RerankMode.RERANKING_MODEL,
            rerank_model_instance=model_instance,
            tenant_id="tenant-1",
            session_factory=session_factory,
            dataset_document_filters={"dataset-1": ("document-1",)},
        )

    def test_get_rerank_runner_returns_none_for_unsupported_mode(self):
        processor = DataPostProcessor.__new__(DataPostProcessor)
        session_factory = sessionmaker()

        assert (
            processor._get_rerank_runner(
                "unsupported",
                "tenant-1",
                None,
                None,
                session_factory=session_factory,
                dataset_document_filters={},
            )
            is None
        )
        assert (
            processor._get_rerank_runner(
                RerankMode.WEIGHTED_SCORE,
                "tenant-1",
                None,
                None,
                session_factory=session_factory,
                dataset_document_filters={},
            )
            is None
        )

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
