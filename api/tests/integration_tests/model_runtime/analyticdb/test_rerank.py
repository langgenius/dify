import os

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.model_providers.analyticdb.rerank.rerank import AnalyticdbRerankModel


def test_invoke_reranker():
    model = AnalyticdbRerankModel()

    result = model.invoke(
        model="bge-reranker-v2-m3",
        credentials={
            "access_key_id": os.environ.get("ANALYTICDB_KEY_ID"),
            "access_key_secret": os.environ.get("ANALYTICDB_KEY_SECRET"),
            "region_id": os.environ.get("ANALYTICDB_REGION_ID"),
            "instance_id": os.environ.get("ANALYTICDB_INSTANCE_ID"),
        },
        query="什么是文本排序模型",
        docs=[
            "文本排序模型广泛用于搜索引擎和推荐系统中，它们根据文本相关性对候选文本进行排序",
            "量子计算是计算科学的一个前沿领域",
            "预训练语言模型的发展给文本排序模型带来了新的进展",
        ],
    )

    assert isinstance(result, RerankResult)
    assert result.docs[0].index == 0
