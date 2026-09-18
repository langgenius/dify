"""App names derived from the creating prompt (App Builder spec, board N)."""

from datetime import datetime

import pytest

from core.dify_builder import naming

NOW = datetime(2026, 9, 7, 14, 2)


def test_derives_the_name_from_the_first_clause():
    # The spec's own example: the trailing noun is dropped at the word boundary
    # that keeps the name inside MAX_NAME_LENGTH.
    assert naming.derive_app_name("Refund approval for ecommerce orders", now=NOW) == "Refund approval for ecommerce"


def test_drops_an_imperative_lead_in_and_recases_the_fragment():
    assert (
        naming.derive_app_name(
            "Set up an expense reimbursement process — check claims against our policy",
            now=NOW,
        )
        == "Expense reimbursement process"
    )


def test_peels_nested_lead_ins():
    assert naming.derive_app_name("Please help me build an expense report app", now=NOW) == "Expense report app"


def test_keeps_a_name_that_is_already_a_noun_phrase():
    assert naming.derive_app_name("Daily ticket summary", now=NOW) == "Daily ticket summary"


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
def test_chinese_prompts_keep_their_own_language(prompt: str, expected: str):
    # The name is cut out of the prompt, so it needs no translation.
    assert naming.derive_app_name(prompt, now=NOW) == expected


def test_a_version_or_model_string_is_not_a_clause_boundary():
    assert naming.derive_app_name("Build a workflow using gpt-4o-mini. Classify tickets.", now=NOW) == (
        "Workflow using gpt-4o-mini"
    )


def test_a_cjk_terminator_ends_the_clause_without_a_trailing_space():
    assert naming.derive_app_name("文章摘要生成器。它读取网页", now=NOW) == "文章摘要生成器"


@pytest.mark.parametrize("prompt", ["", "   ", "??? !!!", "123 456"])
def test_a_prompt_with_nothing_nameable_falls_back(prompt: str):
    assert naming.derive_app_name(prompt, now=NOW) == "New app · Sep 7, 14:02"


def test_peeling_never_empties_the_name():
    # "app" is all that is left; peeling the article too would leave nothing.
    assert naming.derive_app_name("Build me an app", now=NOW) == "App"


def test_a_long_unspaced_name_is_cut_at_the_character():
    # CJK has no word boundary to back off to, so the cut lands on the limit.
    prompt = "报" * 50
    assert naming.derive_app_name(prompt, now=NOW) == "报" * naming.MAX_NAME_LENGTH


def test_the_cut_never_severs_a_word_in_a_spaced_script():
    name = naming.derive_app_name("Invoices to spreadsheet for my daily expense in company", now=NOW)
    assert len(name) <= naming.MAX_NAME_LENGTH
    assert not name.endswith(" ")
    assert name == "Invoices to spreadsheet for my"


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
def test_the_fallback_is_localized(language: str, expected: str):
    assert naming.fallback_app_name(NOW, language) == expected


def test_every_console_locale_has_a_fallback_stem():
    from constants.languages import languages

    assert set(languages) <= set(naming._FALLBACK_STEM)


def test_normalize_proposed_name_unwraps_and_caps_a_model_answer():
    assert naming.normalize_proposed_name('  "Expense Reimbursement Approval"  ') == "Expense Reimbursement Approval"


@pytest.mark.parametrize("proposal", ["", "   ", '""', "!!!"])
def test_normalize_proposed_name_yields_nothing_for_an_unusable_answer(proposal: str):
    # "" tells the caller to keep the name already derived from the prompt.
    assert naming.normalize_proposed_name(proposal) == ""
