"""Code facts must never turn absent reasoning or private inputs into authority."""

import json

import pytest


def graph(source="return value", selector=None):
    return {
        "nodes": [
            {"id": "start", "data": {"type": "start", "variables": []}},
            {
                "id": "code",
                "data": {
                    "type": "code",
                    "title": "Parse",
                    "code": source,
                    "code_language": "python3",
                    "variables": [{"variable": "value", "value_selector": selector or ["start", "value"]}],
                },
            },
        ],
        "edges": [],
    }


def prepare(g=None, inputs=None, **kw):
    from services.dify_builder.code_risk_assessment import code_facts

    return code_facts(
        g or graph(),
        inputs={} if inputs is None else inputs,
        goal_text="Parse the supplied value",
        model_config={"name": "chosen"},
        scope_binding="scope",
        **kw,
    )["code"]


@pytest.mark.parametrize(
    ("left", "right"), [(True, "true"), ([1, 2], "[1, 2]"), (None, "null"), ({"type": "file", "id": "f"}, "f")]
)
def test_code_facts_bind_original_typed_values_without_sharing_them(left, right):
    a, b = prepare(inputs={"value": left}), prepare(inputs={"value": right})
    assert a.digest != b.digest
    assert a.model_facts["inputs"][0]["present"] is True
    assert a.model_facts["inputs"][0]["runtime_type"] != b.model_facts["inputs"][0]["runtime_type"]


def test_missing_input_is_distinct_from_null_and_canvas_is_not_new_execution():
    from copy import deepcopy

    a = prepare()
    assert a.digest != prepare(inputs={"value": None}).digest
    g = deepcopy(graph())
    g["nodes"][1]["position"] = {"x": 9, "y": 10}
    g["nodes"][1]["data"]["title"] = "Renamed"
    assert a.digest == prepare(g).digest
    assert a.digest != prepare(graph("send(value)")).digest


def test_model_facts_hide_body_file_and_credentials_and_notice_is_sanitized():
    from services.dify_builder.code_risk_assessment import assess_code

    source = 'token = "source-secret"\nrequests.post("https://u:p@example.com/send?key=private#frag", data=value)'
    facts = prepare(
        graph(source),
        inputs={"value": {"body": "private-body", "file": {"url": "https://file-secret"}, "password": "input-secret"}},
    )
    calls = []

    def reason(value):
        calls.append(value)
        return {
            "classification": "side_effect",
            "risk_notice": "Sends payload; token=source-secret https://u:p@example.com/send?key=private#frag",
        }

    result = assess_code(facts, reason=reason)
    encoded = json.dumps([calls, result.model_dump()])
    for secret in ("source-secret", "private-body", "file-secret", "input-secret", "u:p", "key=private"):
        assert secret not in encoded
    assert "example.com/send" in encoded
    assert result.status == "assessed"
    assert result.classification == "side_effect"


@pytest.mark.parametrize(
    "response",
    [
        {"classification": "pure", "risk_notice": "safe", "approved": True},
        {"classification": "pure", "risk_notice": "x" * 4097},
        {"classification": "invented", "risk_notice": "safe"},
    ],
)
def test_invalid_reasoning_is_unavailable_never_pure(response):
    from services.dify_builder.code_risk_assessment import assess_code

    result = assess_code(prepare(), reason=lambda _: response)
    assert (result.status, result.classification) == ("unavailable", "unknown")
    assert "unavailable" in result.risk_notice


def test_oversize_and_failed_reasoning_are_unavailable_without_retry():
    from services.dify_builder.code_risk_assessment import assess_code

    calls = []

    def reason(_):
        calls.append(1)
        raise TimeoutError

    assert assess_code(prepare(), reason=reason).status == "unavailable"
    assert len(calls) == 1
    assert assess_code(prepare(graph("x" * 33000)), reason=reason).status == "unavailable"
    assert len(calls) == 1


@pytest.mark.parametrize(
    ("classification", "tier", "confirmation_needed", "mocked"),
    [
        ("pure", "sandboxed", False, False),
        ("read", "read", False, False),
        ("side_effect", "side_effect", True, True),
        ("destructive", "destructive", False, True),
        ("unknown", "side_effect", True, True),
    ],
)
def test_same_code_type_uses_prepared_reasoning_for_actual_choice(classification, tier, confirmation_needed, mocked):
    from services.dify_builder.code_risk_assessment import assess_code
    from services.dify_builder.effect_disclosure import disclose
    from services.dify_builder.effect_presentation import effects_note

    source = {
        "pure": "return value",
        "read": "requests.get('https://service.example/items')",
        "side_effect": "requests.post('https://service.example/items', data=value)",
        "destructive": "requests.delete('https://service.example/items')",
        "unknown": "run_dynamic(value)",
    }[classification]
    facts = prepare(graph(source))

    def reason(model_facts):
        assert model_facts["code"] == source
        return {"classification": classification, "risk_notice": "Concrete Code risk"}

    assessment = assess_code(facts, reason=reason)
    disclosure = disclose(
        graph(source),
        code_risk_assessments={"code": assessment.model_dump()},
        code_facts_digests={"code": facts.digest},
    )
    code = next(item for item in disclosure.items if item.node_id == "code")
    assert (code.tier, code.confirmable) == (tier, confirmation_needed)
    assert ("code" in disclosure.mocked_node_ids({})) is mocked
    approved = disclosure.confirmation(["code"])
    assert ("code" in disclosure.mocked_node_ids(approved)) is (classification == "destructive")
    assert effects_note(disclosure) is not None


def test_missing_or_changed_code_snapshot_cannot_accept_forged_confirmation():
    from services.dify_builder.code_risk_assessment import assess_code
    from services.dify_builder.effect_disclosure import disclose

    facts = prepare(inputs={"value": True})
    assessment = assess_code(facts, reason=lambda _: {"classification": "pure", "risk_notice": "Parser"})
    for snapshots, digests in [
        ({}, {}),
        ({"code": assessment.model_dump()}, {"code": prepare(inputs={"value": "true"}).digest}),
    ]:
        disclosure = disclose(graph(), code_risk_assessments=snapshots, code_facts_digests=digests)
        code = next(item for item in disclosure.items if item.node_id == "code")
        assert not code.confirmable
        assert disclosure.mocked_node_ids({"code": code.signature}) == frozenset({"code"})
        assert "unavailable" in code.risk_notice


@pytest.mark.parametrize(("language", "expected"), [("en", "simulate"), ("zh-Hans", "模拟")])
def test_unavailable_reply_is_human_and_actionable_in_session_language(language, expected):
    from services.dify_builder.effect_disclosure import disclose
    from services.dify_builder.effect_presentation import effects_note
    from tests.unit_tests.services.dify_builder.presentation_helpers import english_text

    reply = english_text(effects_note(disclose(graph()), reply_language=language))
    assert expected in reply
    assert "code_risk_assessment_unavailable" not in reply
    assert "deletes data" not in reply


def test_persisted_projection_rejects_extra_source_and_historical_missing_entries():
    from core.dify_builder.models import DifyBuilderContext
    from services.dify_builder.code_risk_assessment import assess_code
    from services.dify_builder.serde import context_from_dict, context_to_dict

    risk = assess_code(prepare(), reason=lambda _: {"classification": "pure", "risk_notice": "Parser"}).model_dump()
    fc = DifyBuilderContext(code_risk_assessments={"code": risk})
    assert context_from_dict(context_to_dict(fc)).code_risk_assessments == {"code": risk}
    fc.code_risk_assessments["code"]["source"] = "private-source"
    encoded = json.dumps(context_to_dict(fc))
    assert "private-source" not in encoded
    assert context_from_dict(context_to_dict(fc)).code_risk_assessments == {}
    assert (
        context_from_dict({"code_risk_assessments": {"code": {"classification": "pure"}}}).code_risk_assessments == {}
    )
    assert context_from_dict({}).code_risk_assessments == {}


def test_file_declared_type_is_projected_without_file_url_or_content():
    g = graph()
    g["nodes"][0]["data"]["variables"] = [{"variable": "value", "type": "file"}]
    facts = prepare(g, inputs={"value": {"transfer_method": "remote_url", "url": "https://private-file.example"}})
    metadata = facts.model_facts["inputs"][0]
    assert metadata["declared_type"] == "file"
    assert metadata["runtime_type"] == "file_reference"
    assert "private-file" not in json.dumps(facts.model_facts)


def test_code_upstream_confirmation_survives_canvas_title_and_node_order_only():
    from copy import deepcopy

    from services.dify_builder.code_risk_assessment import assess_code
    from services.dify_builder.effect_disclosure import disclose

    g = graph(selector=["upstream", "text"])
    g["nodes"].append({"id": "upstream", "data": {"type": "llm", "title": "Model", "model": {"name": "selected"}}})
    facts = prepare(g)
    risk = assess_code(
        facts, reason=lambda _: {"classification": "side_effect", "risk_notice": "Sends upstream output"}
    )
    before = disclose(g, code_risk_assessments={"code": risk.model_dump()}, code_facts_digests={"code": facts.digest})
    changed = deepcopy(g)
    changed["nodes"].reverse()
    for node in changed["nodes"]:
        node["data"]["title"] = "Renamed"
    after = disclose(
        changed, code_risk_assessments={"code": risk.model_dump()}, code_facts_digests={"code": prepare(changed).digest}
    )
    assert "code" not in after.mocked_node_ids(before.confirmation(["code"]))


def test_selected_model_fenced_json_is_assessed_in_one_attempt(monkeypatch: pytest.MonkeyPatch) -> None:
    from types import SimpleNamespace

    from services.dify_builder.agent import model_resolver
    from services.dify_builder.code_risk_assessment import assess_code, builder_code_reasoner

    calls = []

    def invoke(**kwargs: object) -> SimpleNamespace:
        calls.append(kwargs)
        content = (
            '```json\n{"classification":"pure","risk_notice":"Parses the supplied JSON without external effects."}\n```'
        )
        return SimpleNamespace(message=SimpleNamespace(get_text_content=lambda: content))

    monkeypatch.setattr(model_resolver, "resolve_model_instance", lambda *_: SimpleNamespace(invoke_llm=invoke))
    risk = assess_code(
        prepare(), reason=builder_code_reasoner(tenant_id="owned-tenant", model_config={"name": "selected"})
    )
    assert (risk.status, risk.classification) == ("assessed", "pure")
    assert risk.risk_notice == "Parses the supplied JSON without external effects."
    assert len(calls) == 1


@pytest.mark.parametrize(
    "response",
    [
        "not JSON",
        '```json\n{"classification":"pure","risk_notice":"Parser",}\n```',
        '```json\n[{"classification":"pure","risk_notice":"Parser"}]\n```',
        '```json\n{"classification":"pure","risk_notice":"Parser","approved":true}\n```',
        "x" * 32768 + '{"classification":"pure","risk_notice":"Parser"}',
    ],
    ids=["not-json", "invalid-json", "array", "extra-field", "oversize-response"],
)
def test_selected_model_malformed_json_is_not_automatically_retried(
    monkeypatch: pytest.MonkeyPatch, response: str
) -> None:
    from types import SimpleNamespace

    from services.dify_builder.agent import model_resolver
    from services.dify_builder.code_risk_assessment import assess_code, builder_code_reasoner

    calls = []

    def invoke(**kwargs: object) -> SimpleNamespace:
        calls.append(kwargs)
        content = response if len(calls) == 1 else '{"classification":"pure","risk_notice":"Parser"}'
        return SimpleNamespace(message=SimpleNamespace(get_text_content=lambda: content))

    monkeypatch.setattr(model_resolver, "resolve_model_instance", lambda *_: SimpleNamespace(invoke_llm=invoke))
    risk = assess_code(
        prepare(), reason=builder_code_reasoner(tenant_id="owned-tenant", model_config={"name": "selected"})
    )
    assert (risk.status, risk.classification) == ("unavailable", "unknown")
    assert len(calls) == 1


def test_notice_redaction_retains_task_credential_provenance_without_storing_task():
    from services.dify_builder.code_risk_assessment import assess_code, code_facts

    facts = code_facts(
        graph(),
        inputs={},
        goal_text='Use password="goal-secret" to send the result',
        model_config={"name": "selected"},
        scope_binding="scope",
    )["code"]
    risk = assess_code(
        facts, reason=lambda _: {"classification": "side_effect", "risk_notice": "Sends using goal-secret"}
    )
    assert "goal-secret" not in json.dumps(facts.model_facts)
    assert "goal-secret" not in json.dumps(risk.model_dump())


def test_code_risk_language_is_bound_to_snapshot_without_translating_source():
    english = prepare(reply_language="en")
    chinese = prepare(reply_language="zh-Hans")
    assert english.digest != chinese.digest
    assert chinese.model_facts["reply_language"] == "zh-Hans"
    assert english.model_facts["code"] == chinese.model_facts["code"]


def test_code_reasoner_uses_session_language_instead_of_old_goal_language(monkeypatch):
    from services.dify_builder.agent import llm, model_resolver
    from services.dify_builder.code_risk_assessment import assess_code, builder_code_reasoner

    captured = {}

    def invoke(_model, **kwargs):
        captured.update(kwargs)
        return '{"classification":"pure","risk_notice":"仅在内存中整理文本。"}'

    monkeypatch.setattr(model_resolver, "resolve_model_instance", lambda *_: object())
    monkeypatch.setattr(llm, "invoke_text", invoke)
    result = assess_code(
        prepare(reply_language="zh-Hans"),
        reason=builder_code_reasoner(tenant_id="tenant", model_config={"name": "selected"}),
    )
    assert result.status == "assessed"
    assert "Write risk_notice in zh-Hans" in captured["system"]
    assert "Parse the supplied value" in captured["user"]
