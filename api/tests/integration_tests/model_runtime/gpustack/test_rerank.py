import os

import pytest

from core.model_runtime.entities.rerank_entities import RerankDocument, RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.gpustack.rerank.rerank import (
    GPUStackRerankModel,
)


def test_validate_credentials_for_rerank_model():
    model = GPUStackRerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="bge-reranker-v2-m3",
            credentials={
                "endpoint_url": "invalid_url",
                "api_key": "invalid_api_key",
            },
        )

    model.validate_credentials(
        model="bge-reranker-v2-m3",
        credentials={
            "endpoint_url": os.environ.get("GPUSTACK_SERVER_URL"),
            "api_key": os.environ.get("GPUSTACK_API_KEY"),
        },
    )


def test_invoke_rerank_model():
    model = GPUStackRerankModel()

    response = model.invoke(
        model="bge-reranker-v2-m3",
        credentials={
            "endpoint_url": os.environ.get("GPUSTACK_SERVER_URL"),
            "api_key": os.environ.get("GPUSTACK_API_KEY"),
        },
        query="Organic skincare products for sensitive skin",
        docs=[
            "Eco-friendly kitchenware for modern homes",
            "Biodegradable cleaning supplies for eco-conscious consumers",
            "Organic cotton baby clothes for sensitive skin",
            "Natural organic skincare range for sensitive skin",
            "Tech gadgets for smart homes: 2024 edition",
            "Sustainable gardening tools and compost solutions",
            "Sensitive skin-friendly facial cleansers and toners",
            "Organic food wraps and storage solutions",
            "Yoga mats made from recycled materials",
        ],
        top_n=3,
        score_threshold=-0.75,
        user="abc-123",
    )

    assert isinstance(response, RerankResult)
    assert len(response.docs) == 3


def test__invoke():
    model = GPUStackRerankModel()

    # Test case 1: Empty docs
    result = model._invoke(
        model="bge-reranker-v2-m3",
        credentials={
            "endpoint_url": os.environ.get("GPUSTACK_SERVER_URL"),
            "api_key": os.environ.get("GPUSTACK_API_KEY"),
        },
        query="Organic skincare products for sensitive skin",
        docs=[],
        top_n=3,
        score_threshold=0.75,
        user="abc-123",
    )
    assert isinstance(result, RerankResult)
    assert len(result.docs) == 0

    # Test case 2: Expected docs
    result = model._invoke(
        model="bge-reranker-v2-m3",
        credentials={
            "endpoint_url": os.environ.get("GPUSTACK_SERVER_URL"),
            "api_key": os.environ.get("GPUSTACK_API_KEY"),
        },
        query="Organic skincare products for sensitive skin",
        docs=[
            "Eco-friendly kitchenware for modern homes",
            "Biodegradable cleaning supplies for eco-conscious consumers",
            "Organic cotton baby clothes for sensitive skin",
            "Natural organic skincare range for sensitive skin",
            "Tech gadgets for smart homes: 2024 edition",
            "Sustainable gardening tools and compost solutions",
            "Sensitive skin-friendly facial cleansers and toners",
            "Organic food wraps and storage solutions",
            "Yoga mats made from recycled materials",
        ],
        top_n=3,
        score_threshold=-0.75,
        user="abc-123",
    )
    assert isinstance(result, RerankResult)
    assert len(result.docs) == 3
    assert all(isinstance(doc, RerankDocument) for doc in result.docs)
