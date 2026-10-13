"""M2 Localizer: detect language, translate only catalog/template strings, cache."""

import pytest

from core.dify_builder.contract import AssistantTurnItem, ExecutionActivity, ExecutionProgress, UserItem
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
        # The request is an index->string object ({"0": src0, ...}); reply with an
        # index-keyed object of translations, matching the hardened protocol.
        import json

        req = json.loads(user)
        return {idx: table.get(src, f"<{src}>") for idx, src in req.items()}

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
    items = [ConversationItem(kind="test_result", payload={"failure_reason": "Test run", "tone": "success"})]
    out = loc.localize_items(items, "zh-Hans")
    assert out[0].payload["failure_reason"] == "测试运行"
    assert out[0].payload["tone"] == "success"  # enum untouched


def test_localize_current_goal_and_default_recovery_copy(monkeypatch):
    default_copy = "I filled in sensible defaults. Review the requirements and adjust them if needed."
    loc, _ = _localizer(monkeypatch, table={"Goal": "目标", default_copy: "我已填入合理的默认值。请检查并调整需求。"})

    items = [
        ConversationItem(kind="summary", payload={"label": "Goal"}),
        ConversationItem(kind="assistant_turn", payload={"reply_text": default_copy}),
    ]

    localized = loc.localize_items(items, "zh-Hans")
    assert localized[0].payload["label"] == "目标"
    assert localized[1].payload["reply_text"] == "我已填入合理的默认值。请检查并调整需求。"


def test_localize_never_rewrites_user_text_or_turn_identity(monkeypatch):
    loc, _ = _localizer(monkeypatch, table={"Goal": "目标"})
    item = UserItem(text="Goal", turn_id="Goal").to_item(seq=0, at_version=1)

    localized = loc.localize_items([item], "zh-Hans")[0]

    assert localized.payload == {"text": "Goal", "turn_id": "Goal"}


def test_localize_assistant_reply_without_rewriting_protocol_and_execution_fields(monkeypatch):
    loc, _ = _localizer(monkeypatch, table={"Goal": "目标"})
    item = AssistantTurnItem(
        turn_id="Goal",
        stage_id="Goal",
        execution=ExecutionProgress(
            status="completed",
            activities=[ExecutionActivity(id="Goal", label="Goal", state="done", parent_id="Goal")],
        ),
        reasoning_text="Goal",
        reply_text="Goal",
        cards=["Goal"],
        card_state="invalidated",
    ).to_item(seq=0, at_version=1)

    localized = loc.localize_items([item], "zh-Hans")[0]

    assert localized.payload == {
        "turn_id": "Goal",
        "stage_id": "Goal",
        "execution": {
            "status": "completed",
            "activities": [{"id": "Goal", "label": "Goal", "state": "done", "kind": "stage", "parent_id": "Goal"}],
        },
        "reasoning_text": "Goal",
        "reply_text": "目标",
        "cards": ["Goal"],
        "card_state": "invalidated",
    }


@pytest.mark.parametrize(
    ("source", "translation"),
    [
        ("The final plan is ready for approval.", "最终计划已准备好供审批。"),
        ("The final change plan is ready for approval.", "最终变更计划已准备好供审批。"),
        (
            "I didn't apply anything: the canvas already has nodes with these ids. "
            "Clear it or start from a new app, then approve again.",
            "我没有应用任何内容：画布上已有这些 ID 的节点。请清空画布或新建应用，然后再次批准。",
        ),
    ],
)
def test_localize_current_build_and_edit_handler_literals(monkeypatch, source, translation):
    loc, _ = _localizer(monkeypatch, table={source: translation})

    item = ConversationItem(kind="assistant_turn", payload={"reply_text": source})

    assert loc.localize_items([item], "zh-Hans")[0].payload["reply_text"] == translation


def test_localize_form_presentation_preserves_field_keys_options_defaults_and_raw_values(monkeypatch):
    loc, _ = _localizer(
        monkeypatch,
        table={
            "Review the requirements": "检查需求",
            "Goal": "目标",
            "Review": "检查",
        },
    )
    item = ConversationItem(
        kind="form",
        payload={
            "variant": "build_requirements",
            "title": "Review the requirements",
            "fields": [
                {
                    "key": "goal",
                    "label": "Goal",
                    "type": "select",
                    "options": ["Yes", "No"],
                    "default": "Yes",
                    "placeholder": "Review",
                }
            ],
            "values": {"goal": "Yes"},
        },
    )

    result = loc.localize_items([item], "zh-Hans")[0].payload

    assert result["title"] == "检查需求"
    assert result["fields"] == [
        {
            "key": "goal",
            "label": "目标",
            "type": "select",
            "options": ["Yes", "No"],
            "default": "Yes",
            "placeholder": "检查",
        }
    ]
    assert result["values"] == {"goal": "Yes"}


def test_localize_resource_select_preserves_resource_identity_names_and_metadata(monkeypatch):
    loc, _ = _localizer(
        monkeypatch,
        table={"Which resources should Builder use?": "Builder 应使用哪些资源？", "Goal": "目标"},
    )
    item = ConversationItem(
        kind="resource_select",
        payload={
            "title": "Which resources should Builder use?",
            "description": "Recommended resources are selected by default.",
            "recommended": [
                {
                    "id": "kb-goal",
                    "label": "Goal",
                    "meta": "Goal",
                    "kind": "knowledge",
                    "readiness": "ready",
                }
            ],
            "selected_ids": ["kb-goal"],
        },
    )

    result = loc.localize_items([item], "zh-Hans")[0].payload

    assert result["title"] == "Builder 应使用哪些资源？"
    assert result["recommended"] == [
        {
            "id": "kb-goal",
            "label": "Goal",
            "meta": "Goal",
            "kind": "knowledge",
            "readiness": "ready",
        }
    ]
    assert result["selected_ids"] == ["kb-goal"]


@pytest.mark.parametrize(
    ("language", "translated_goal", "translated_yes"),
    [("zh-Hans", "目标", "是"), ("ja", "目標", "はい")],
)
def test_ui_copy_catalog_is_batched_and_includes_later_gate_and_receipt_literals(
    monkeypatch, language, translated_goal, translated_yes
):
    loc, model = _localizer(monkeypatch, table={"Goal": translated_goal, "Yes": translated_yes})

    copy = loc.localize_ui_copy(language)

    assert copy["Goal"] == translated_goal
    assert copy["Yes"] == translated_yes
    assert "Approve plan" in copy
    assert "What should Builder do next?" in copy
    assert "No resources selected" in copy
    assert model.translate_calls == 1


def test_ui_copy_catalog_translation_failure_leaves_missing_entries_for_english_fallback():
    loc = Localizer(lambda: None)

    copy = loc.localize_ui_copy("ja")

    assert copy.get("Goal", "Goal") == "Goal"
    assert copy.get("Approve plan", "Approve plan") == "Approve plan"


def test_ui_copy_persisted_warm_map_survives_cold_process_cache_and_translates_only_misses(monkeypatch):
    loc, _ = _localizer(monkeypatch, table={"Goal": "目標", "Approve plan": "プランを承認"})
    full = loc.localize_ui_copy("ja")
    assert full["Goal"] == "目標"
    partial = {source: translated for source, translated in full.items() if source != "Approve plan"}
    localize_mod._TRANSLATION_CACHE.clear()
    requested: list[list[str]] = []

    def fake_invoke_json(_model, *, system, user):  # noqa: ARG001
        import json

        requested.append(list(json.loads(user).values()))
        return {"0": "プランを承認"}

    monkeypatch.setattr(localize_mod.llm, "invoke_json", fake_invoke_json)
    fresh_worker = Localizer(lambda: object())

    restored = fresh_worker.localize_ui_copy("ja", existing_copy=partial)

    assert restored["Goal"] == "目標"
    assert restored["Approve plan"] == "プランを承認"
    assert requested == [["Approve plan"]]


def test_ui_copy_rejects_unknown_and_oversized_translations(monkeypatch):
    table = {"Approve plan": "x" * 4097}
    loc, model = _localizer(monkeypatch, table=table)

    first = loc.localize_ui_copy("ja", existing_copy={"raw user value": "bad", "Goal": "目標"})

    assert first["Goal"] == "目標"
    assert "raw user value" not in first
    assert "Approve plan" not in first
    table["Approve plan"] = "プランを承認"

    second = loc.localize_ui_copy("ja", existing_copy=first)

    assert second["Approve plan"] == "プランを承認"
    assert model.translate_calls == 2


def test_localize_leaves_non_catalog_prose_untouched(monkeypatch):
    loc, _ = _localizer(monkeypatch)
    items = [ConversationItem(kind="assistant_turn", payload={"reply_text": "这是我为你生成的计划"})]
    out = loc.localize_items(items, "zh-Hans")
    assert out[0].payload["reply_text"] == "这是我为你生成的计划"  # LLM prose, not in catalog


def test_localize_no_repair_reply_and_choice_preserves_the_submitted_option(monkeypatch):
    reply = "No automatic fix found — try again or finish this session."
    translated_reply = "未找到自动修复方案，可以重新尝试或结束当前会话。"
    loc, _ = _localizer(
        monkeypatch,
        table={
            reply: translated_reply,
            "No repair available": "暂无可用修复方案",
            "Finish": "结束",
        },
    )
    items = [
        ConversationItem(
            kind="assistant_turn",
            payload={"reply_text": reply},
        ),
        ConversationItem(
            kind="interaction_response",
            payload={
                "interaction_kind": "choice",
                "question": "No repair available",
                "answer": "Finish",
                "submitted_data": {"option_id": "finish_repair"},
            },
        ),
    ]

    out = loc.localize_items(items, "zh-Hans")

    assert out[0].payload["reply_text"] == translated_reply
    assert out[1].payload == {
        "interaction_kind": "choice",
        "question": "暂无可用修复方案",
        "answer": "结束",
        "submitted_data": {"option_id": "finish_repair"},
    }


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


def test_detect_language_provider_raising_falls_back_to_en():
    # Env callbacks must not raise (see localize.Localizer usage in the engine
    # Env); a model_provider that raises must degrade to the "en" fallback
    # instead of propagating out of detect_language.
    def raising_provider():
        raise RuntimeError("boom")

    loc = Localizer(raising_provider)
    assert loc.detect_language("hello") == "en"


def test_fill_cache_provider_raising_leaves_strings_untranslated():
    # Same contract for the translate path: a raising model_provider must not
    # propagate out of localize_items -- it should degrade to a no-op (original
    # strings kept).
    def raising_provider():
        raise RuntimeError("boom")

    loc = Localizer(raising_provider)
    items = [ConversationItem(kind="summary", payload={"title": "Review"})]
    out = loc.localize_items(items, "zh-Hans")
    assert out[0].payload["title"] == "Review"


def test_translations_by_index_tolerates_model_shape_variation():
    n = 2
    # index-keyed object (the requested shape)
    assert Localizer._translations_by_index({"0": "评审", "1": "测试运行"}, n) == {0: "评审", 1: "测试运行"}
    # index object wrapped one level (model echoing an envelope key)
    wrapped_idx = {"strings": {"0": "评审", "1": "测试运行"}}
    assert Localizer._translations_by_index(wrapped_idx, n) == {0: "评审", 1: "测试运行"}
    # positional array
    assert Localizer._translations_by_index(["评审", "测试运行"], n) == {0: "评审", 1: "测试运行"}
    # wrapped positional array (differently-named key)
    assert Localizer._translations_by_index({"translations": ["评审", "测试运行"]}, n) == {0: "评审", 1: "测试运行"}
    # partial reply: only the present index maps; the missing one is simply absent
    assert Localizer._translations_by_index({"0": "评审"}, n) == {0: "评审"}
    # unusable shapes -> empty (caller keeps English, uncached)
    assert Localizer._translations_by_index("nope", n) == {}
    assert Localizer._translations_by_index({"weird": 123}, n) == {}


def test_localize_translates_when_model_wraps_index_object(monkeypatch):
    # End-to-end: model wraps an index-keyed map under a key; localize must still translate.
    from services.dify_builder.agent import localize as mod

    def fake_invoke_text(model, *, system, user, **kw):  # noqa: ARG001
        return "zh-Hans"

    def fake_invoke_json(model, *, system, user, **kw):  # noqa: ARG001
        import json

        req = json.loads(user)
        return {"strings": {idx: ("评审" if src == "Review" else "<" + src + ">") for idx, src in req.items()}}

    monkeypatch.setattr(mod.llm, "invoke_text", fake_invoke_text)
    monkeypatch.setattr(mod.llm, "invoke_json", fake_invoke_json)
    loc = Localizer(lambda: object())
    items = [ConversationItem(kind="summary", payload={"title": "Review"})]
    out = loc.localize_items(items, "zh-Hans")
    assert out[0].payload["title"] == "评审"


def test_localize_does_not_cache_failures_and_retries(monkeypatch):
    # A model that returns nothing usable must NOT poison the cache with the English
    # original; a later turn re-invokes the model (self-heal) instead of sticking.
    from services.dify_builder.agent import localize as mod

    calls = {"n": 0}

    def fake_invoke_text(model, *, system, user, **kw):  # noqa: ARG001
        return "zh-Hans"

    def fake_invoke_json(model, *, system, user, **kw):  # noqa: ARG001
        calls["n"] += 1
        return {}  # unusable / no translations

    monkeypatch.setattr(mod.llm, "invoke_text", fake_invoke_text)
    monkeypatch.setattr(mod.llm, "invoke_json", fake_invoke_json)
    loc = Localizer(lambda: object())

    out1 = loc.localize_items([ConversationItem(kind="summary", payload={"title": "Review"})], "zh-Hans")
    assert out1[0].payload["title"] == "Review"  # kept English (no translation available)
    assert ("Review", "zh-Hans") not in mod._TRANSLATION_CACHE  # failure NOT cached

    loc.localize_items([ConversationItem(kind="summary", payload={"title": "Review"})], "zh-Hans")
    assert calls["n"] == 2  # re-invoked on the next turn (self-heal), not stuck on cached English


def test_localize_test_result_translates_only_review_prose_preserving_output_facts(monkeypatch):
    loc, _ = _localizer(
        monkeypatch,
        table={"Review": "评审", "Test run": "测试运行", "Workflow built ({count} nodes)": "已构建（{count} 个节点）"},
    )
    items = [
        ConversationItem(
            kind="test_result",
            payload={
                "status": "succeeded",
                "outcome": "execution_succeeded_needs_review",
                "dify_run_id": "Test run",
                "failure_reason": "Test run",
                "review_note": "Review",
                "executed_node_ids": ["Review", "Test run"],
                "terminal_outputs": {
                    "text": "Review",
                    "nested": ["Test run", "Workflow built (3 nodes)", None, False, 0, "", [], {}],
                },
            },
        )
    ]
    out = loc.localize_items(items, "zh-Hans")
    assert out[0].payload == {
        "status": "succeeded",
        "outcome": "execution_succeeded_needs_review",
        "dify_run_id": "Test run",
        "failure_reason": "测试运行",
        "review_note": "评审",
        "executed_node_ids": ["Review", "Test run"],
        "terminal_outputs": {
            "text": "Review",
            "nested": ["Test run", "Workflow built (3 nodes)", None, False, 0, "", [], {}],
        },
    }

    nested = out[0].payload["terminal_outputs"]["nested"]
    assert nested[3] is False
    assert type(nested[4]) is int


@pytest.mark.parametrize(
    "source",
    [
        "Other paths and goal acceptance were not verified.",
        "Other paths and goal acceptance were not verified. "
        "Draft verification is stale or unavailable; run again before publishing.",
        "Execution succeeded; output needs review. Other paths and goal acceptance were not verified.",
        "Execution succeeded; output needs review. Other paths and goal acceptance were not verified. "
        "Draft verification is stale or unavailable; run again before publishing.",
        "A required output reference was unresolved or the executed branch produced no terminal output.",
        "Execution failed.",
        "Execution outcome is unknown; run again before publishing.",
    ],
)
def test_localize_fixed_verification_prose(monkeypatch, source):
    loc, _ = _localizer(monkeypatch, table={source: "请检查执行结果"})
    items = [ConversationItem(kind="test_result", payload={"review_note": source})]
    assert loc.localize_items(items, "zh-Hans")[0].payload["review_note"] == "请检查执行结果"


@pytest.mark.parametrize("variant", ["testdata", "build_requirements", "edit_rules"])
def test_localize_form_translates_presentation_and_preserves_input_facts(monkeypatch, variant):
    loc, _ = _localizer(
        monkeypatch,
        table={
            "User message": "用户消息",
            "Review": "评审",
            "Adjust any values before Builder continues.": "继续前调整值。",
        },
    )
    payload = {
        "variant": variant,
        "title": "Review",
        "description": "Adjust any values before Builder continues.",
        "fields": [
            {
                "key": "sys.query",
                "type": "paragraph",
                "label": "User message",
                "placeholder": "User message",
                "hint": "Review",
                "options": ["User message", "Review"],
                "default": "User message",
                "required": True,
                "max_length": 1024,
                "allowed_file_types": ["Review"],
                "allowed_file_extensions": [".txt"],
                "allowed_file_upload_methods": ["local_file"],
                "unit": "Review",
                "number_limits": 2,
                "json_schema": {
                    "title": "User message",
                    "description": "Review",
                    "properties": {"sys.query": {"const": "User message", "default": "Review"}},
                },
            },
            {"key": "Review", "type": "Review", "label": "Review", "json_schema": "User message"},
        ],
        "values": {"sys.query": "User message", "query": "Review", "nested": [None, False, 0, "Review"]},
        "frozen": False,
        "interaction_id": "User message",
        "protocol_extension": {"title": "Review", "value": "User message"},
    }
    items = [ConversationItem(kind="form", payload=payload)]
    out = loc.localize_items(items, "zh-Hans")[0].payload

    assert out["title"] == "评审"
    assert out["description"] == "继续前调整值。"
    assert {key: value for key, value in out.items() if key not in {"title", "description", "fields"}} == {
        "variant": variant,
        "values": {"sys.query": "User message", "query": "Review", "nested": [None, False, 0, "Review"]},
        "frozen": False,
        "interaction_id": "User message",
        "protocol_extension": {"title": "Review", "value": "User message"},
    }
    assert {key: value for key, value in out["fields"][0].items() if key not in {"label", "placeholder", "hint"}} == {
        "key": "sys.query",
        "type": "paragraph",
        "options": ["User message", "Review"],
        "default": "User message",
        "required": True,
        "max_length": 1024,
        "allowed_file_types": ["Review"],
        "allowed_file_extensions": [".txt"],
        "allowed_file_upload_methods": ["local_file"],
        "unit": "Review",
        "number_limits": 2,
        "json_schema": {
            "title": "User message",
            "description": "Review",
            "properties": {"sys.query": {"const": "User message", "default": "Review"}},
        },
    }
    assert out["fields"][0]["label"] == "用户消息"
    assert out["fields"][0]["placeholder"] == "用户消息"
    assert out["fields"][0]["hint"] == "评审"
    assert out["fields"][1]["label"] == "评审"
    assert out["fields"][1] == {"key": "Review", "type": "Review", "label": "评审", "json_schema": "User message"}


@pytest.mark.parametrize(
    ("source", "translation", "expected"),
    [
        (
            "Provide test inputs and retry: missing sys.query\nUser message {raw} (节点)",
            "请提供测试输入并重试：{reason}",
            "请提供测试输入并重试：missing sys.query\nUser message {raw} (节点)",
        ),
        (
            "Publication requires a successful run of the current draft (graph changed (rev-2)\n{raw}). "
            "Run validation again, then review its outputs.",
            "发布需要当前草稿成功运行（{reason}）。请重新验证并检查输出。",
            "发布需要当前草稿成功运行（graph changed (rev-2)\n{raw}）。请重新验证并检查输出。",
        ),
    ],
)
def test_localize_recovery_reply_preserves_dynamic_reason(monkeypatch, source, translation, expected):
    templates = {
        "Provide test inputs and retry: {reason}": translation,
        "Publication requires a successful run of the current draft ({reason}). "
        "Run validation again, then review its outputs.": translation,
    }
    loc, _ = _localizer(monkeypatch, table=templates)
    items = [ConversationItem(kind="assistant_turn", payload={"reply_text": source})]
    assert loc.localize_items(items, "zh-Hans")[0].payload["reply_text"] == expected
