import os

import pytest
from api.core.model_runtime.entities.rerank_entities import RerankResult

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.localai.rerank.rerank import LocalaiRerankModel


def test_validate_credentials_for_chat_model():
    model = LocalaiRerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='bge-reranker-v2-m3',
            credentials={
                'server_url': 'hahahaha',
                'completion_type': 'completion',
            }
        )

    model.validate_credentials(
        model='bge-reranker-base',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'completion_type': 'completion',
        }
    )

def test_invoke_rerank_model():
    model = LocalaiRerankModel()

    response = model.invoke(
        model='bge-reranker-base',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL')
        },
        query='Organic skincare products for sensitive skin',
        docs=[
            "Eco-friendly kitchenware for modern homes",
            "Biodegradable cleaning supplies for eco-conscious consumers",
            "Organic cotton baby clothes for sensitive skin",
            "Natural organic skincare range for sensitive skin",
            "Tech gadgets for smart homes: 2024 edition",
            "Sustainable gardening tools and compost solutions",
            "Sensitive skin-friendly facial cleansers and toners",
            "Organic food wraps and storage solutions",
            "Yoga mats made from recycled materials"
        ],
        top_n=3,
        score_threshold=0.75,
        user="abc-123"
    )

    assert isinstance(response, RerankResult)
    assert len(response.docs) == 3
import os

import pytest
from api.core.model_runtime.entities.rerank_entities import RerankDocument, RerankResult

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.localai.rerank.rerank import LocalaiRerankModel


def test_validate_credentials_for_chat_model():
    model = LocalaiRerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='bge-reranker-v2-m3',
            credentials={
                'server_url': 'hahahaha',
                'completion_type': 'completion',
            }
        )

    model.validate_credentials(
        model='bge-reranker-base',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'completion_type': 'completion',
        }
    )

def test_invoke_rerank_model():
    model = LocalaiRerankModel()

    response = model.invoke(
        model='bge-reranker-base',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL')
        },
        query='Organic skincare products for sensitive skin',
        docs=[
            "Eco-friendly kitchenware for modern homes",
            "Biodegradable cleaning supplies for eco-conscious consumers",
            "Organic cotton baby clothes for sensitive skin",
            "Natural organic skincare range for sensitive skin",
            "Tech gadgets for smart homes: 2024 edition",
            "Sustainable gardening tools and compost solutions",
            "Sensitive skin-friendly facial cleansers and toners",
            "Organic food wraps and storage solutions",
            "Yoga mats made from recycled materials"
        ],
        top_n=3,
        score_threshold=0.75,
        user="abc-123"
    )

    assert isinstance(response, RerankResult)
    assert len(response.docs) == 3

def test__invoke():
    model = LocalaiRerankModel()

    # Test case 1: Empty docs
    result = model._invoke(
        model='bge-reranker-base',
        credentials={
            'server_url': 'https://example.com',
            'api_key': '1234567890'
        },
        query='Organic skincare products for sensitive skin',
        docs=[],
        top_n=3,
        score_threshold=0.75,
        user="abc-123"
    )
    assert isinstance(result, RerankResult)
    assert len(result.docs) == 0

    # Test case 2: Valid invocation
    result = model._invoke(
        model='bge-reranker-base',
        credentials={
            'server_url': 'https://example.com',
            'api_key': '1234567890'
        },
        query='Organic skincare products for sensitive skin',
        docs=[
            "Eco-friendly kitchenware for modern homes",
            "Biodegradable cleaning supplies for eco-conscious consumers",
            "Organic cotton baby clothes for sensitive skin",
            "Natural organic skincare range for sensitive skin",
            "Tech gadgets for smart homes: 2024 edition",
            "Sustainable gardening tools and compost solutions",
            "Sensitive skin-friendly facial cleansers and toners",
            "Organic food wraps and storage solutions",
            "Yoga mats made from recycled materials"
        ],
        top_n=3,
        score_threshold=0.75,
        user="abc-123"
    )
    assert isinstance(result, RerankResult)
    assert len(result.docs) == 3
    assert all(isinstance(doc, RerankDocument) for doc in result.docs)