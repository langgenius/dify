import os
import pytest
from collections.abc import Generator

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
        model='bge-reranker-v2-m3',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'completion_type': 'completion',
        }
    )

def test_invoke_rerank_model():
    model = LocalaiRerankModel()

    response = model.invoke(
        model='bge-reranker-v2-m3',
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'completion_type': 'rerank',
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
