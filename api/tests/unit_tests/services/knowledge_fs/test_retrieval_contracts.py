from __future__ import annotations

import pytest

from services.knowledge_fs.retrieval_contracts import KnowledgeFSPublicFailureResponse


@pytest.mark.parametrize(
    ("code", "category", "retry_policy", "action", "stage", "message"),
    [
        (
            "MODEL_RUNTIME_RESPONSE_INVALID",
            "dependency",
            "manual",
            "retry",
            "semantic_chunking",
            "The model service returned a result that did not meet processing requirements. "
            "Retry processing the document.",
        ),
        (
            "DOCUMENT_SEMANTIC_GROUNDING_FAILED",
            "dependency",
            "manual",
            "retry",
            "semantic_chunking",
            "Some entities or relationships returned by the model could not be matched to the document's source text. "
            "Retry processing the document.",
        ),
        (
            "DOCUMENT_SOURCE_NOT_FOUND",
            "not_found",
            "never",
            "reupload",
            "parsing",
            "The original file is no longer available. Upload the document again.",
        ),
    ],
)
def test_document_failure_preserves_specific_code_stage_and_safe_actionable_message(
    code: str, category: str, retry_policy: str, action: str, stage: str, message: str
) -> None:
    failure = KnowledgeFSPublicFailureResponse.model_validate(
        {
            "action": action,
            "category": category,
            "code": code,
            "message": "Private source text and provider diagnostics",
            "retryPolicy": retry_policy,
            "stage": stage,
            "traceId": "trace-grounding-test",
        }
    )

    assert failure.model_dump(mode="json", by_alias=True, exclude_none=True) == {
        "action": action,
        "category": category,
        "code": code,
        "message": message,
        "retryPolicy": retry_policy,
        "stage": stage,
        "traceId": "trace-grounding-test",
    }
    assert "Private source text" not in failure.model_dump_json()
