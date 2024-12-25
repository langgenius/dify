import os

import dashscope  # type: ignore
import pytest

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.tongyi.rerank.rerank import GTERerankModel


def test_validate_credentials():
    model = GTERerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="get-rank", credentials={"dashscope_api_key": "invalid_key"})

    model.validate_credentials(
        model="get-rank", credentials={"dashscope_api_key": os.environ.get("TONGYI_DASHSCOPE_API_KEY")}
    )


def test_invoke_model():
    model = GTERerankModel()

    result = model.invoke(
        model=dashscope.TextReRank.Models.gte_rerank,
        credentials={"dashscope_api_key": os.environ.get("TONGYI_DASHSCOPE_API_KEY")},
        query="什么是文本排序模型",
        docs=[
            "文本排序模型广泛用于搜索引擎和推荐系统中，它们根据文本相关性对候选文本进行排序",
            "量子计算是计算科学的一个前沿领域",
            "预训练语言模型的发展给文本排序模型带来了新的进展",
        ],
        score_threshold=0.7,
    )

    assert isinstance(result, RerankResult)
    assert len(result.docs) == 1
    assert result.docs[0].index == 0
    assert result.docs[0].score >= 0.7
