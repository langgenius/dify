import pytest

from services.model_billing_openai_audio_adapter import (
    OpenAIAudioSourceAdapterError,
    SourceAudioSettings,
)
from tests.helpers.unit.model_billing_negative_call import call_invalid


def test_positional_and_keyword_objects_reach_the_same_owner_by_identity() -> None:
    first, second = object(), {"invalid": object()}
    observed: list[tuple[object, object]] = []

    def owner(value: str, *, setting: int) -> tuple[object, object]:
        observed.append((value, setting))
        return value, setting

    result = call_invalid(owner, first, setting=second)
    assert observed == [result]
    assert result[0] is first
    assert result[1] is second


def test_missing_argument_is_rejected_by_owner_call_not_signature_binding() -> None:
    def owner(value: str) -> str:
        return value

    with pytest.raises(TypeError, match=r"owner.*missing 1 required positional argument: 'value'"):
        call_invalid(owner)


def test_omitted_default_is_not_applied_or_reconstructed() -> None:
    default = object()

    def owner(value: object = default) -> object:
        return value

    assert call_invalid(owner) is default


def test_owner_exception_propagates_as_the_exact_instance() -> None:
    rejection = ValueError("synthetic owner rejection")
    observed: list[object] = []
    invalid = object()

    def owner(value: str) -> None:
        observed.append(value)
        raise rejection

    with pytest.raises(ValueError, match="synthetic owner rejection") as error:
        call_invalid(owner, invalid)
    assert error.value is rejection
    assert observed[0] is invalid


def test_real_audio_constructor_owns_invalid_value_and_missing_argument_errors() -> None:
    with pytest.raises(OpenAIAudioSourceAdapterError, match="settings are not reviewed"):
        call_invalid(SourceAudioSettings, "unreviewed", "not_used", "not_used")
    with pytest.raises(TypeError, match="SourceAudioSettings.__init__.*required positional arguments"):
        call_invalid(SourceAudioSettings)
