"""Only language detection can invoke a model; presentation never does."""

from typing import Never

import pytest

from services.dify_builder.agent import localize
from services.dify_builder.agent.localize import LanguageDetector


@pytest.mark.parametrize(
    ("detected", "expected"), [("ja", "ja"), ("zh-Hans", "zh-Hans"), ("The language is Japanese.", "en"), ("", "en")]
)
def test_language_detection_validates_the_model_response(
    monkeypatch: pytest.MonkeyPatch, detected: str, expected: str
) -> None:
    monkeypatch.setattr(localize.llm, "invoke_text", lambda *_args, **_kwargs: detected)
    assert LanguageDetector(lambda: object()).detect_language("Goal") == expected


def test_empty_user_text_never_resolves_a_model() -> None:
    def forbidden() -> Never:
        pytest.fail("empty text resolved a model")

    assert LanguageDetector(forbidden).detect_language("   ") == "en"


def test_detection_failure_defaults_to_english(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*_args: object, **_kwargs: object) -> Never:
        raise RuntimeError("unavailable")

    monkeypatch.setattr(localize.llm, "invoke_text", fail)
    assert LanguageDetector(lambda: object()).detect_language("hello") == "en"
