"""App names derived from the creating prompt (App Builder spec, board N)."""

from datetime import datetime

import pytest

from core.dify_builder import naming

NOW = datetime(2026, 9, 7, 14, 2)


def test_derives_the_name_from_the_first_clause() -> None:
    # The spec's own example: the trailing noun is dropped at the word boundary
    # that keeps the name inside MAX_NAME_LENGTH.
    assert naming.derive_app_name("Refund approval for ecommerce orders", now=NOW) == "Refund approval for ecommerce"


@pytest.mark.parametrize(
    ("prompt", "expected"),
    [
        ("帮我创建一个报销审批流程。检查金额并通知经理", "报销审批流程"),
        ("请设计一份文章摘要生成器", "文章摘要生成器"),
        # A quantifier left behind by the pronoun is peeled like an article.
        ("我要一个报销审批流程", "报销审批流程"),
        ("我想要一套客服机器人", "客服机器人"),
    ],
)
def test_chinese_prompts_keep_their_own_language(prompt: str, expected: str) -> None:
    # The name is cut out of the prompt, so it needs no translation.
    assert naming.derive_app_name(prompt, now=NOW) == expected


@pytest.mark.parametrize("prompt", ["", "   ", "??? !!!", "123 456"])
def test_a_prompt_with_nothing_nameable_falls_back(prompt: str) -> None:
    assert naming.derive_app_name(prompt, now=NOW) == "New app · Sep 7, 14:02"


def test_a_long_unspaced_name_is_cut_at_the_character() -> None:
    # CJK has no word boundary to back off to, so the cut lands on the limit.
    prompt = "报" * 50
    assert naming.derive_app_name(prompt, now=NOW) == "报" * naming.MAX_NAME_LENGTH


@pytest.mark.parametrize(
    ("language", "expected"),
    [
        ("en-US", "New app · Sep 7, 14:02"),
        ("zh-Hans", "新应用 · 9月7日 14:02"),
        ("ja-JP", "新しいアプリ · 9月7日 14:02"),
        ("ko-KR", "새 앱 · 9월 7일 14:02"),
        ("fr-FR", "Nouvelle application · Sep 7, 14:02"),
        # An unknown locale takes the English stem rather than raising.
        ("xx-YY", "New app · Sep 7, 14:02"),
    ],
)
def test_the_fallback_is_localized(language: str, expected: str) -> None:
    assert naming.fallback_app_name(NOW, language) == expected


def test_every_console_locale_has_a_fallback_stem() -> None:
    from constants.languages import languages

    assert set(languages) <= set(naming._FALLBACK_STEM)


@pytest.mark.parametrize("proposal", ["", "   ", '""', "!!!"])
def test_normalize_proposed_name_yields_nothing_for_an_unusable_answer(proposal: str) -> None:
    # "" tells the caller to keep the name already derived from the prompt.
    assert naming.normalize_proposed_name(proposal) == ""
