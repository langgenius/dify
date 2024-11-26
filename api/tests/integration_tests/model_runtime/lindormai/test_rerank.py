import json
import os

import pytest

from core.model_runtime.entities.rerank_entities import RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.lindormai.rerank.rerank import LindormAIRerankModel


def test_validate_credentials():
    model = LindormAIRerankModel()
    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="rerank_bge",
            credentials={
                "lindormai_endpoint": os.environ.get("AI_ENDPOINT"),
                "lindormai_username": os.environ.get("AI_USERNAME"),
                "lindormai_password": os.environ.get("AI_PASSWORD"),
            },
        )

    model.validate_credentials(
        model="rerank_bge_v2_m3",
        credentials={
            "lindormai_endpoint": os.environ.get("AI_ENDPOINT"),
            "lindormai_username": os.environ.get("AI_USERNAME"),
            "lindormai_password": os.environ.get("AI_PASSWORD"),
        },
    )


def test_invoke_model():
    model = LindormAIRerankModel()
    result = model.invoke(
        model="rerank_bge_v2_m3",
        credentials={
            "lindormai_endpoint": os.environ.get("AI_ENDPOINT"),
            "lindormai_username": os.environ.get("AI_USERNAME"),
            "lindormai_password": os.environ.get("AI_PASSWORD"),
        },
        query="Who is Kasumi?",
        docs=[
            "Kasumi is a girl's name of Japanese origin meaning mist.",
            "Her music is a kawaii bass, a mix of future bass, pop, and kawaii music ",
            "and she leads a team named PopiParty.",
        ],
        score_threshold=0.0,
    )

    assert isinstance(result, RerankResult)
    assert len(result.docs) == 1
    assert result.docs[0].index == 0
    assert result.docs[0].score >= 0.0
