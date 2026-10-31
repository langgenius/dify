import pytest
from pydantic import ValidationError

from controllers.service_api.app.annotation import (
    AnnotationCreatePayload,
    AnnotationListQuery,
    AnnotationReplyActionPayload,
)


def test_payload_models_preserve_defaults_numeric_strings_and_zero_threshold() -> None:
    assert AnnotationListQuery.model_validate({}).model_dump() == {"page": 1, "limit": 20, "keyword": ""}
    assert AnnotationListQuery.model_validate({"page": "2", "limit": "5", "keyword": "refund"}).model_dump() == {
        "page": 2,
        "limit": 5,
        "keyword": "refund",
    }
    assert AnnotationCreatePayload(question="", answer="").model_dump() == {"question": "", "answer": ""}
    assert (
        AnnotationReplyActionPayload.model_validate(
            {"embedding_provider_name": "openai", "embedding_model_name": "embedding", "score_threshold": 0.0}
        ).score_threshold
        == 0.0
    )
    with pytest.raises(ValidationError):
        AnnotationCreatePayload.model_validate({"question": "Q"})
