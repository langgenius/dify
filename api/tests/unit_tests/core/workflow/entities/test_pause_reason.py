"""
Tests for PauseReason discriminated union serialization/deserialization.
"""

import pytest
from pydantic import BaseModel, ValidationError

from core.workflow.entities.pause_reason import (
    HumanInputRequired,
    PauseReason,
    SchedulingPause,
)


class _Holder(BaseModel):
    """Helper model that embeds PauseReason for union tests."""

    reason: PauseReason


class TestPauseReasonDiscriminator:
    """Test suite for PauseReason union discriminator."""

    @pytest.mark.parametrize(
        ("dict_value", "expected"),
        [
            pytest.param(
                {
                    "reason": {
                        "TYPE": "human_input_required",
                        "form_id": "form_id",
                        "form_content": "form_content",
                        "node_id": "node_id",
                        "node_title": "node_title",
                    },
                },
                HumanInputRequired(
                    form_id="form_id",
                    form_content="form_content",
                    node_id="node_id",
                    node_title="node_title",
                ),
                id="HumanInputRequired",
            ),
            pytest.param(
                {
                    "reason": {
                        "TYPE": "scheduled_pause",
                        "message": "Hold on",
                    }
                },
                SchedulingPause(message="Hold on"),
                id="SchedulingPause",
            ),
        ],
    )
    def test_model_validate(self, dict_value, expected):
        """Ensure scheduled pause payloads with lowercase TYPE deserialize."""
        holder = _Holder.model_validate(dict_value)

        assert type(holder.reason) == type(expected)
        assert holder.reason == expected

    @pytest.mark.parametrize(
        "reason",
        [
            HumanInputRequired(
                form_id="form_id",
                form_content="form_content",
                node_id="node_id",
                node_title="node_title",
            ),
            SchedulingPause(message="Hold on"),
        ],
        ids=lambda x: type(x).__name__,
    )
    def test_model_construct(self, reason):
        holder = _Holder(reason=reason)
        assert holder.reason == reason

    def test_model_construct_with_invalid_type(self):
        with pytest.raises(ValidationError):
            holder = _Holder(reason=object())  # type: ignore

    def test_unknown_type_fails_validation(self):
        """Unknown TYPE values should raise a validation error."""
        with pytest.raises(ValidationError):
            _Holder.model_validate({"reason": {"TYPE": "UNKNOWN"}})
