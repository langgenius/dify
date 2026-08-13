from __future__ import annotations

import pytest

from benchmarks.staging_public_artifact_safety import (
    PublicArtifactSafetyError,
    validate_public_artifact_payload,
    validate_public_artifact_text,
)


def test_allows_declared_non_secret_api_key_source_metadata() -> None:
    validate_public_artifact_payload({"environment": {"api_key_source": "environment"}})


@pytest.mark.parametrize(
    ("payload", "expected_code"),
    [
        ({"stats": {"conversation-id": "private"}}, "private_artifact_field"),
        ({"stats": {"message": "Bearer private-value"}}, "secret_value_detected"),
        ({"stats": {"message": "app-1234567890abcdefgh"}}, "secret_value_detected"),
        ({"stats": {"message": "e2b_1234567890abcdefgh"}}, "secret_value_detected"),
        ({"stats": {"message": "contains opaque-private-id"}}, "secret_value_detected"),
    ],
)
def test_rejects_private_dynamic_fields_and_values(
    payload: dict[str, object],
    expected_code: str,
) -> None:
    with pytest.raises(PublicArtifactSafetyError) as raised:
        validate_public_artifact_payload(
            payload,
            forbidden_values=("opaque-private-id",),
        )

    assert raised.value.code == expected_code
    assert "private-value" not in raised.value.safe_message
    assert "opaque-private-id" not in raised.value.safe_message


def test_rejects_private_field_assignments_and_exact_values_in_text() -> None:
    with pytest.raises(PublicArtifactSafetyError) as field_error:
        validate_public_artifact_text("conversation_id=private")
    assert field_error.value.code == "private_artifact_field"

    with pytest.raises(PublicArtifactSafetyError) as value_error:
        validate_public_artifact_text(
            "diagnostic contains benchmark-agent-uuid",
            forbidden_values=("benchmark-agent-uuid",),
        )
    assert value_error.value.code == "secret_value_detected"

    with pytest.raises(PublicArtifactSafetyError) as label_error:
        validate_public_artifact_text("request failed for Conversation ID: private-value")
    assert label_error.value.code == "secret_value_detected"
