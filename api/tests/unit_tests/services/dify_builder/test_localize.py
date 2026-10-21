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


@pytest.mark.parametrize("failure", ["missing", "exception", "invalid"])
def test_chinese_language_survives_model_detection_failure(monkeypatch: pytest.MonkeyPatch, failure: str) -> None:
    def invoke(*_args: object, **_kwargs: object) -> str:
        if failure == "exception":
            raise ConnectionRefusedError("provider unavailable")
        return "The language is Chinese."

    monkeypatch.setattr(localize.llm, "invoke_text", invoke)
    detector = LanguageDetector(lambda: None if failure == "missing" else object())
    assert detector.detect_language("帮我把工作流的模型换成 fable 5.1") == "zh-Hans"


def test_ambiguous_detection_failure_keeps_conversation_language() -> None:
    assert LanguageDetector(lambda: None, prior_language="zh-Hans").detect_language("OK") == "zh-Hans"


def test_fallback_allows_explicit_english_language_switch() -> None:
    detector = LanguageDetector(lambda: None, prior_language="zh-Hans")
    assert detector.detect_language("Please explain the current workflow in English") == "en"


def test_explicit_reply_language_switch_survives_literal_chinese_business_field() -> None:
    from services.dify_builder.agent.localize import LanguageDetector

    assert (
        LanguageDetector(lambda: None, prior_language="zh-Hans").detect_language(
            "Please reply in English and keep the field 订单编号 unchanged."
        )
        == "en"
    )
