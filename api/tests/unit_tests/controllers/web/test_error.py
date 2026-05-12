"""Unit tests for controllers.web.error HTTP exception classes."""

from __future__ import annotations

import pytest

from controllers.web.error import (
    AppMoreLikeThisDisabledError,
    AppSuggestedQuestionsAfterAnswerDisabledError,
    AppUnavailableError,
    AudioTooLargeError,
    CompletionRequestError,
    ConversationCompletedError,
    InvalidArgumentError,
    InvokeRateLimitError,
    NoAudioUploadedError,
    NotChatAppError,
    NotCompletionAppError,
    NotFoundError,
    NotWorkflowAppError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderNotSupportSpeechToTextError,
    ProviderQuotaExceededError,
    UnsupportedAudioTypeError,
    WebAppAuthAccessDeniedError,
    WebAppAuthRequiredError,
    WebFormRateLimitExceededError,
)

_ERROR_SPECS: list[tuple[type, str, int]] = [
    (AppUnavailableError, "app_unavailable", 400),
    (NotCompletionAppError, "not_completion_app", 400),
    (NotChatAppError, "not_chat_app", 400),
    (NotWorkflowAppError, "not_workflow_app", 400),
    (ConversationCompletedError, "conversation_completed", 400),
    (ProviderNotInitializeError, "provider_not_initialize", 400),
    (ProviderQuotaExceededError, "provider_quota_exceeded", 400),
    (ProviderModelCurrentlyNotSupportError, "model_currently_not_support", 400),
    (CompletionRequestError, "completion_request_error", 400),
    (AppMoreLikeThisDisabledError, "app_more_like_this_disabled", 403),
    (AppSuggestedQuestionsAfterAnswerDisabledError, "app_suggested_questions_after_answer_disabled", 403),
    (NoAudioUploadedError, "no_audio_uploaded", 400),
    (AudioTooLargeError, "audio_too_large", 413),
    (UnsupportedAudioTypeError, "unsupported_audio_type", 415),
    (ProviderNotSupportSpeechToTextError, "provider_not_support_speech_to_text", 400),
    (WebAppAuthRequiredError, "web_sso_auth_required", 401),
    (WebAppAuthAccessDeniedError, "web_app_access_denied", 401),
    (InvokeRateLimitError, "rate_limit_error", 429),
    (WebFormRateLimitExceededError, "web_form_rate_limit_exceeded", 429),
    (NotFoundError, "not_found", 404),
    (InvalidArgumentError, "invalid_param", 400),
]


@pytest.mark.parametrize(
    ("cls", "expected_code", "expected_status"),
    _ERROR_SPECS,
    ids=[cls.__name__ for cls, _, _ in _ERROR_SPECS],
)
def test_error_class_attributes(cls: type, expected_code: str, expected_status: int) -> None:
    """Each error class exposes the correct error_code and HTTP status code."""
    assert cls.error_code == expected_code
    assert cls.code == expected_status


def test_error_classes_have_description() -> None:
    """Every error class has a description (string or None for generic errors)."""
    # NotFoundError and InvalidArgumentError use None description by design
    _NO_DESCRIPTION = {NotFoundError, InvalidArgumentError}
    for cls, _, _ in _ERROR_SPECS:
        if cls in _NO_DESCRIPTION:
            continue
        assert isinstance(cls.description, str), f"{cls.__name__} missing description"
        assert len(cls.description) > 0, f"{cls.__name__} has empty description"
