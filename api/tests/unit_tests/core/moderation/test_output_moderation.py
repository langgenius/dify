from collections.abc import Callable

import pytest

from core.moderation.base import ModerationAction, ModerationOutputsResult
from core.moderation.output_moderation import ModerationRule, OutputModeration
from extensions.ext_code_based_extension import code_based_extension
from services.moderation_invocation_errors import ModerationUnavailableInvocationError


class RecordingEvaluator:
    def __init__(self, action: ModerationAction = ModerationAction.DIRECT_OUTPUT) -> None:
        self.calls: list[str] = []
        self.action = action
        self.error: Exception | None = None

    def __call__(self, text: str) -> ModerationOutputsResult:
        self.calls.append(text)
        if self.error is not None:
            raise self.error
        return ModerationOutputsResult(
            flagged="blocked" in text,
            action=self.action,
            preset_response="Refused",
            text=text.replace("blocked", "masked"),
        )


def make_handler(evaluator: RecordingEvaluator) -> OutputModeration:
    return OutputModeration(
        tenant_id="tenant-1",
        app_id="app-1",
        rule=ModerationRule(type="api", config={}),
        output_evaluator=evaluator,
    )


def test_stream_checks_new_segments_and_only_the_unchecked_tail(config_overrides: Callable[..., None]) -> None:
    config_overrides(MODERATION_BUFFER_SIZE=5)
    evaluator = RecordingEvaluator()
    handler = make_handler(evaluator)
    assert handler.append_new_token("abc") is None
    assert evaluator.calls == []
    assert handler.append_new_token("de") is None
    assert handler.append_new_token("fghij") is None
    assert handler.append_new_token("kl") is None
    assert evaluator.calls == ["abcde", "fghij"]
    assert handler.moderation_completion("abcdefghijkl") == ("abcdefghijkl", False)
    assert evaluator.calls == ["abcde", "fghij", "kl"]
    assert handler.moderation_completion("abcdefghijkl") == ("abcdefghijkl", False)
    assert evaluator.calls == ["abcde", "fghij", "kl"]


def test_exact_stream_boundary_has_no_final_check(config_overrides: Callable[..., None]) -> None:
    config_overrides(MODERATION_BUFFER_SIZE=5)
    evaluator = RecordingEvaluator()
    handler = make_handler(evaluator)
    handler.append_new_token("abcde")
    assert handler.moderation_completion("abcde") == ("abcde", False)
    assert evaluator.calls == ["abcde"]


def test_direct_output_replaces_the_whole_answer_and_stops_checks(config_overrides: Callable[..., None]) -> None:
    config_overrides(MODERATION_BUFFER_SIZE=5)
    evaluator = RecordingEvaluator()
    handler = make_handler(evaluator)
    handler.append_new_token("safe ")
    assert handler.append_new_token("blocked") == "Refused"
    assert handler.should_direct_output()
    assert handler.get_final_output() == "Refused"
    assert handler.append_new_token("never checked") is None
    assert handler.moderation_completion("safe blocked") == ("Refused", True)
    assert evaluator.calls == ["safe ", "blocked"]


def test_override_preserves_previous_output_and_later_deltas(config_overrides: Callable[..., None]) -> None:
    config_overrides(MODERATION_BUFFER_SIZE=5)
    evaluator = RecordingEvaluator(ModerationAction.OVERRIDDEN)
    handler = make_handler(evaluator)
    handler.append_new_token("safe ")
    assert handler.append_new_token("blocked") == "safe masked"
    assert not handler.should_direct_output()
    handler.append_new_token(" tail")
    assert handler.moderation_completion("safe blocked tail") == ("safe masked tail", True)
    assert evaluator.calls == ["safe ", "blocked", " tail"]


def test_failure_is_terminal_without_a_background_or_completion_retry(config_overrides: Callable[..., None]) -> None:
    config_overrides(MODERATION_BUFFER_SIZE=5)
    evaluator = RecordingEvaluator()
    failure = ModerationUnavailableInvocationError()
    evaluator.error = failure
    handler = make_handler(evaluator)
    with pytest.raises(ModerationUnavailableInvocationError) as raised:
        handler.append_new_token("hello")
    assert raised.value is failure
    evaluator.error = None
    with pytest.raises(ModerationUnavailableInvocationError):
        handler.moderation_completion("hello")
    with pytest.raises(ModerationUnavailableInvocationError):
        handler.append_new_token("later")
    assert evaluator.calls == ["hello"]


def test_blocking_result_uses_non_stream_segments(config_overrides: Callable[..., None]) -> None:
    config_overrides(MODERATION_NON_STREAM_SEGMENT_SIZE=4)
    evaluator = RecordingEvaluator()
    handler = make_handler(evaluator)
    assert handler.moderation_completion("abcdefghij") == ("abcdefghij", False)
    assert evaluator.calls == ["abcd", "efgh", "ij"]


def test_changed_final_result_is_checked_instead_of_inheriting_approval(config_overrides: Callable[..., None]) -> None:
    config_overrides(MODERATION_BUFFER_SIZE=5)
    evaluator = RecordingEvaluator()
    handler = make_handler(evaluator)
    handler.append_new_token("safe ")
    assert handler.moderation_completion("blocked") == ("Refused", True)
    assert evaluator.calls == ["safe ", "blocked"]


def test_completion_checks_only_an_unstreamed_suffix(config_overrides: Callable[..., None]) -> None:
    config_overrides(MODERATION_BUFFER_SIZE=5)
    evaluator = RecordingEvaluator()
    handler = make_handler(evaluator)
    handler.append_new_token("safe ")
    assert handler.moderation_completion("safe tail") == ("safe tail", False)
    assert evaluator.calls == ["safe ", "tail"]


def test_resumed_output_preserves_the_existing_prefix(config_overrides: Callable[..., None]) -> None:
    config_overrides(MODERATION_BUFFER_SIZE=5)
    evaluator = RecordingEvaluator()
    handler = make_handler(evaluator)
    assert handler.append_new_token("blocked", prefix="existing ") == "Refused"
    assert evaluator.calls == ["blocked"]


def test_independent_legacy_keyword_backend_retains_replacement() -> None:
    code_based_extension.init()
    handler = OutputModeration(
        tenant_id="tenant-1",
        app_id="app-1",
        rule=ModerationRule(
            type="keywords",
            config={
                "keywords": "blocked",
                "inputs_config": {"enabled": False, "preset_response": ""},
                "outputs_config": {"enabled": True, "preset_response": "Refused"},
            },
        ),
    )
    assert handler.moderation_completion("blocked") == ("Refused", True)


def test_empty_completion_does_not_issue_an_empty_check() -> None:
    evaluator = RecordingEvaluator()
    handler = make_handler(evaluator)
    assert handler.moderation_completion("") == ("", False)
    assert evaluator.calls == []


@pytest.mark.parametrize("action", [ModerationAction.DIRECT_OUTPUT, ModerationAction.OVERRIDDEN])
def test_a_flagged_verdict_stays_flagged_when_its_replacement_matches_the_source(action: ModerationAction) -> None:
    def evaluate(text: str) -> ModerationOutputsResult:
        return ModerationOutputsResult(flagged=True, action=action, preset_response=text, text=text)

    handler = OutputModeration(
        tenant_id="tenant-1", app_id="app-1", rule=ModerationRule(type="api", config={}), output_evaluator=evaluate
    )
    assert handler.moderation_completion("blocked") == ("blocked", True)
