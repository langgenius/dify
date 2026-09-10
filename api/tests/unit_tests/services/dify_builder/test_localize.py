"""M2 Localizer: detect language, translate only catalog/template strings, cache."""

import pytest

from core.dify_builder.models import ConversationItem
from services.dify_builder.agent import localize as localize_mod
from services.dify_builder.agent.localize import Localizer


@pytest.fixture(autouse=True)
def _clear_translation_cache():
    # _TRANSLATION_CACHE is module-level (shared across Localizer instances so a
    # language's finite vocabulary is really translated once process-wide). Tests
    # must not leak cache entries into each other, so clear it before every test --
    # this keeps e.g. test_localize_caches_translations' translate_calls == 1
    # assertion deterministic regardless of test order.
    localize_mod._TRANSLATION_CACHE.clear()
    yield
    localize_mod._TRANSLATION_CACHE.clear()


class _FakeModel:
    """Records calls; returns canned detection / translation payloads."""
    def __init__(self):
        self.translate_calls = 0

    # detect_language uses invoke_text; translate uses invoke_json — patched below.


def _localizer(monkeypatch, *, detect="zh-Hans", table=None):
    table = table or {}
    from services.dify_builder.agent import localize as mod

    def fake_invoke_text(model, *, system, user, **kw):  # noqa: ARG001
        return detect

    def fake_invoke_json(model, *, system, user, **kw):  # noqa: ARG001
        model.translate_calls += 1
        # translate every requested source string via the table (default: prefix)
        import json
        srcs = json.loads(user)["strings"] if user.strip().startswith("{") else []
        return {s: table.get(s, f"<{s}>") for s in srcs}

    monkeypatch.setattr(mod.llm, "invoke_text", fake_invoke_text)
    monkeypatch.setattr(mod.llm, "invoke_json", fake_invoke_json)
    fake = _FakeModel()
    return Localizer(lambda: fake), fake


def test_detect_language(monkeypatch):
    loc, _ = _localizer(monkeypatch, detect="ja")
    assert loc.detect_language("こんにちは") == "ja"


def test_detect_language_english_fallback_on_empty(monkeypatch):
    loc, _ = _localizer(monkeypatch)
    assert loc.detect_language("") == "en"


def test_detect_language_clean_code_passes(monkeypatch):
    loc, _ = _localizer(monkeypatch, detect="ja")
    assert loc.detect_language("hello") == "ja"


def test_detect_language_rejects_non_code_reply(monkeypatch):
    loc, _ = _localizer(monkeypatch, detect="The language is Japanese.")
    assert loc.detect_language("hello") == "en"


def test_localize_translates_catalog_string(monkeypatch):
    loc, _ = _localizer(monkeypatch, table={"Test run": "测试运行"})
    items = [ConversationItem(kind="test_result", payload={"title": "Test run", "tone": "success"})]
    out = loc.localize_items(items, "zh-Hans")
    assert out[0].payload["title"] == "测试运行"
    assert out[0].payload["tone"] == "success"  # enum untouched


def test_localize_leaves_non_catalog_prose_untouched(monkeypatch):
    loc, _ = _localizer(monkeypatch)
    items = [ConversationItem(kind="assistant_turn", payload={"reply_text": "这是我为你生成的计划"})]
    out = loc.localize_items(items, "zh-Hans")
    assert out[0].payload["reply_text"] == "这是我为你生成的计划"  # LLM prose, not in catalog


def test_localize_template_reinserts_dynamic_part(monkeypatch):
    loc, _ = _localizer(monkeypatch, table={"Workflow built ({count} nodes)": "已构建工作流（{count} 个节点）"})
    items = [ConversationItem(kind="summary", payload={"items": ["Workflow built (3 nodes)"]})]
    out = loc.localize_items(items, "zh-Hans")
    assert out[0].payload["items"][0] == "已构建工作流（3 个节点）"


def test_localize_english_is_noop(monkeypatch):
    loc, fake = _localizer(monkeypatch)
    items = [ConversationItem(kind="test_result", payload={"title": "Test run"})]
    out = loc.localize_items(items, "en")
    assert out[0].payload["title"] == "Test run"
    assert fake.translate_calls == 0


def test_localize_caches_translations(monkeypatch):
    loc, fake = _localizer(monkeypatch, table={"Review": "评审"})
    for _ in range(3):
        loc.localize_items([ConversationItem(kind="summary", payload={"title": "Review"})], "zh-Hans")
    assert fake.translate_calls == 1  # translated once, cached thereafter


def test_localize_shares_cache_across_instances(monkeypatch):
    # The catalog translation cache is module-level: a fresh Localizer per
    # advance-task invocation must still hit the cache a prior instance filled.
    loc1, fake1 = _localizer(monkeypatch, table={"Review": "评审"})
    loc1.localize_items([ConversationItem(kind="summary", payload={"title": "Review"})], "zh-Hans")
    assert fake1.translate_calls == 1

    loc2, fake2 = _localizer(monkeypatch, table={"Review": "评审"})
    out = loc2.localize_items([ConversationItem(kind="summary", payload={"title": "Review"})], "zh-Hans")
    assert out[0].payload["title"] == "评审"
    assert fake2.translate_calls == 0  # second instance reused the module-level cache


def test_detect_language_provider_raising_falls_back_to_en(monkeypatch):
    # Env callbacks must not raise (see localize.Localizer usage in the engine
    # Env); a model_provider that raises must degrade to the "en" fallback
    # instead of propagating out of detect_language.
    def raising_provider():
        raise RuntimeError("boom")

    loc = Localizer(raising_provider)
    assert loc.detect_language("hello") == "en"


def test_fill_cache_provider_raising_leaves_strings_untranslated(monkeypatch):
    # Same contract for the translate path: a raising model_provider must not
    # propagate out of localize_items -- it should degrade to a no-op (original
    # strings kept).
    def raising_provider():
        raise RuntimeError("boom")

    loc = Localizer(raising_provider)
    items = [ConversationItem(kind="summary", payload={"title": "Review"})]
    out = loc.localize_items(items, "zh-Hans")
    assert out[0].payload["title"] == "Review"
