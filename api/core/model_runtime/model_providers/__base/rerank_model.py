from typing import Optional

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.model_providers.__base.ai_model import AIModel
from core.plugin.impl.model import PluginModelClient


class RerankModel(AIModel):
    """
    Base Model class for rerank model.
    """

    model_type: ModelType = ModelType.RERANK

    def invoke(
        self,
        model: str,
        credentials: dict,
        query: str,
        docs: list[str],
        score_threshold: Optional[float] = None,
        top_n: Optional[int] = None,
        user: Optional[str] = None,
    ) -> RerankResult:
        """
        Invoke rerank model

        :param model: model name
        :param credentials: model credentials
        :param query: search query
        :param docs: docs for reranking
        :param score_threshold: score threshold
        :param top_n: top n
        :param user: unique user id
        :return: rerank result
        """
        try:
            plugin_model_manager = PluginModelClient()
            return plugin_model_manager.invoke_rerank(
                tenant_id=self.tenant_id,
                user_id=user or "unknown",
                plugin_id=self.plugin_id,
                provider=self.provider_name,
                model=model,
                credentials=credentials,
                query=query,
                docs=docs,
                score_threshold=score_threshold,
                top_n=top_n,
            )
        except Exception as e:
            raise self._transform_invoke_error(e)
