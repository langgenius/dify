from typing import Optional

from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.invoke import InvokeAuthorizationError
from core.rag.data_post_processor.reorder import ReorderRunner
from core.rag.models.document import Document
from core.rag.rerank.entity.weight import KeywordSetting, VectorSetting, Weights
from core.rag.rerank.rerank_base import BaseRerankRunner
from core.rag.rerank.rerank_factory import RerankRunnerFactory
from core.rag.rerank.rerank_type import RerankMode


class DataPostProcessor:
    """Interface for data post-processing document."""

    def __init__(
        self,
        tenant_id: str,
        reranking_mode: str,
        reranking_model: Optional[dict] = None,
        weights: Optional[dict] = None,
        reorder_enabled: bool = False,
    ):
        self.rerank_runner = self._get_rerank_runner(reranking_mode, tenant_id, reranking_model, weights)
        self.reorder_runner = self._get_reorder_runner(reorder_enabled)

    def invoke(
        self,
        query: str,
        documents: list[Document],
        score_threshold: Optional[float] = None,
        top_n: Optional[int] = None,
        user: Optional[str] = None,
    ) -> list[Document]:
        if self.rerank_runner:
            documents = self.rerank_runner.run(query, documents, score_threshold, top_n, user)

        if self.reorder_runner:
            documents = self.reorder_runner.run(documents)

        return documents

    def _get_rerank_runner(
        self,
        reranking_mode: str,
        tenant_id: str,
        reranking_model: Optional[dict] = None,
        weights: Optional[dict] = None,
    ) -> Optional[BaseRerankRunner]:
        if reranking_mode == RerankMode.WEIGHTED_SCORE.value and weights:
            runner = RerankRunnerFactory.create_rerank_runner(
                runner_type=reranking_mode,
                tenant_id=tenant_id,
                weights=Weights(
                    vector_setting=VectorSetting(
                        vector_weight=weights["vector_setting"]["vector_weight"],
                        embedding_provider_name=weights["vector_setting"]["embedding_provider_name"],
                        embedding_model_name=weights["vector_setting"]["embedding_model_name"],
                    ),
                    keyword_setting=KeywordSetting(
                        keyword_weight=weights["keyword_setting"]["keyword_weight"],
                    ),
                ),
            )
            return runner
        elif reranking_mode == RerankMode.RERANKING_MODEL.value:
            rerank_model_instance = self._get_rerank_model_instance(tenant_id, reranking_model)
            if rerank_model_instance is None:
                return None
            runner = RerankRunnerFactory.create_rerank_runner(
                runner_type=reranking_mode, rerank_model_instance=rerank_model_instance
            )
            return runner
        return None

    def _get_reorder_runner(self, reorder_enabled) -> Optional[ReorderRunner]:
        if reorder_enabled:
            return ReorderRunner()
        return None

    def _get_rerank_model_instance(self, tenant_id: str, reranking_model: Optional[dict]) -> ModelInstance | None:
        if reranking_model:
            try:
                model_manager = ModelManager()
                reranking_provider_name = reranking_model.get("reranking_provider_name")
                reranking_model_name = reranking_model.get("reranking_model_name")
                if not reranking_provider_name or not reranking_model_name:
                    return None
                rerank_model_instance = model_manager.get_model_instance(
                    tenant_id=tenant_id,
                    provider=reranking_provider_name,
                    model_type=ModelType.RERANK,
                    model=reranking_model_name,
                )
                return rerank_model_instance
            except InvokeAuthorizationError:
                return None
        return None
