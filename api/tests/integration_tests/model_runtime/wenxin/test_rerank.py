import os
from time import sleep

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.model_providers.wenxin.rerank.rerank import WenxinRerankModel


def test_invoke_bce_reranker_base_v1():
    sleep(3)
    model = WenxinRerankModel()

    response = model.invoke(
        model="bce-reranker-base_v1",
        credentials={"api_key": os.environ.get("WENXIN_API_KEY"), "secret_key": os.environ.get("WENXIN_SECRET_KEY")},
        query="What is Deep Learning?",
        docs=["Deep Learning is ...", "My Book is ..."],
        user="abc-123",
    )

    assert isinstance(response, RerankResult)
    assert len(response.docs) == 2
