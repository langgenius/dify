import os

import pytest

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.xinference.rerank.rerank import XinferenceRerankModel
from tests.integration_tests.model_runtime.__mock.xinference import MOCK, setup_xinference_mock


@pytest.mark.parametrize('setup_xinference_mock', [['none']], indirect=True)
def test_validate_credentials(setup_xinference_mock):
    model = XinferenceRerankModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model='bge-reranker-base',
            credentials={
                'server_url': 'awdawdaw',
                'model_uid': os.environ.get('XINFERENCE_RERANK_MODEL_UID')
            }
        )

    model.validate_credentials(
        model='bge-reranker-base',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_uid': os.environ.get('XINFERENCE_RERANK_MODEL_UID')
        }
    )

@pytest.mark.parametrize('setup_xinference_mock', [['none']], indirect=True)
def test_invoke_model(setup_xinference_mock):
    model = XinferenceRerankModel()

    result = model.invoke(
        model='bge-reranker-base',
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_uid': os.environ.get('XINFERENCE_RERANK_MODEL_UID')
        },
        query="Who is Kasumi?",
        docs=[
            "Kasumi is a girl's name of Japanese origin meaning \"mist\".",
            "Her music is a kawaii bass, a mix of future bass, pop, and kawaii music ",
            "and she leads a team named PopiParty."
        ],
        score_threshold=0.8
    )

    assert isinstance(result, RerankResult)
    assert len(result.docs) == 1
    assert result.docs[0].index == 0
    assert result.docs[0].score >= 0.8
