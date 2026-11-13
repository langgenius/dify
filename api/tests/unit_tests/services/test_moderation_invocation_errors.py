import pytest

from core.app.apps.exc import AppGenerateError
from services.moderation_invocation_errors import (
    ModerationRejectedInvocationError,
    ModerationUnavailableInvocationError,
)
from services.moderation_service import ModerationError, ModerationPhase, ModerationRejectedError


@pytest.mark.parametrize("phase", ["input", "output"])
def test_rejection_preserves_use_case_identity_and_safe_fallback(phase: ModerationPhase) -> None:
    error = ModerationRejectedInvocationError(phase, "")

    assert isinstance(error, ModerationRejectedError)
    assert isinstance(error, AppGenerateError)
    assert error.phase == phase
    assert str(error) == f"Model {phase} was rejected by moderation."
    assert error.error_code == "moderation_rejected"
    assert error.status_code == 400


def test_unavailable_error_exposes_only_a_safe_retry_message() -> None:
    error = ModerationUnavailableInvocationError()

    assert isinstance(error, AppGenerateError)
    assert isinstance(error, ModerationError)
    assert str(error) == "This message can’t be processed right now. Please try again later."
    assert error.error_code == "moderation_unavailable"
    assert error.status_code == 503
