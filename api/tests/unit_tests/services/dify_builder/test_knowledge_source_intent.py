"""Source intent is cognition over real user text, never derived keys or consent."""

import json
from datetime import datetime

import pytest

from core.dify_builder.contract import ResourceOption
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.state import PcState
from services.dify_builder.agent import build
from services.dify_builder.application.handlers_build import build_registry
from services.dify_builder.application.runner import Env, Runner
from services.dify_builder.plan import BuildClarification, ResourceDiscovery, WorkflowPlan
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository
from tests.unit_tests.services.dify_builder.test_bound_resource_plan_reconciliation import ReconciliationAgent
from tests.unit_tests.services.dify_builder.test_build_cognition import _FakeInstance

GOAL = (
    "帮我做一个文本翻译工作流：用户输入普通文本 source_text 和目标语言 target_language，通过 LLM 翻译并输出 "
    "translation。"
    "source_text 不是网址，不需要网页抓取、插件、HTTP、Agent、知识库或文件。"
)
EXCLUSION = "不需要网页抓取、插件、HTTP、Agent、知识库或文件。"
VALUES = {"method": "LLM", "output": "translation", "no_file": True, "no_knowledge_base": True}
MODEL = "provider/model"
INTENT = {"state": "excluded", "evidence": [EXCLUSION]}


def test_analysis_preserves_fixed_grounded_source_intent_without_an_extra_call() -> None:
    model = _FakeInstance([json.dumps({"fields": [], "values": VALUES, "knowledge_source_intent": INTENT})])
    result = build.analyze_goal(model, GOAL)
    assert result.get("knowledge_source_intent") == INTENT
    assert result["values"] == VALUES
    assert len(model.calls) == 1


def start_dialog(
    monkeypatch: pytest.MonkeyPatch, *, intent: object = INTENT, fields: list[dict[str, object]] | None = None
) -> tuple[Runner, InMemoryRepository, Session, Actor, list[dict[str, object]], _FakeInstance]:
    plan = WorkflowPlan(
        "Translation", "source_text", "translation", ["Translate supplied text"], used_resource_ids=[MODEL]
    )
    agent = ReconciliationAgent(plan)
    model = _FakeInstance([json.dumps({"fields": fields or [], "values": VALUES, "knowledge_source_intent": intent})])
    plans: list[dict[str, object]] = []

    def analyze(goal_text: str, *, reply_language: str | None = None) -> dict[str, object]:
        return build.analyze_goal(model, goal_text, reply_language=reply_language)

    def propose(
        requirements: dict[str, object], *, goal_text: str, reply_language: str | None = None
    ) -> WorkflowPlan | BuildClarification | None:
        del goal_text, reply_language
        plans.append(requirements)
        return plan

    def discover(*_args: object, **_kwargs: object) -> ResourceDiscovery:
        return ResourceDiscovery([ResourceOption(MODEL, "Existing model", "LLM", "model", "ready")])

    monkeypatch.setattr(agent, "analyze_goal", analyze)
    monkeypatch.setattr(agent, "propose_plan_v1", propose)
    monkeypatch.setattr(agent, "discover_resources", discover)
    repo = InMemoryRepository()
    session = Session(app_id="app", entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_CAPABILITY_CHECK)
    repo.create_session(session, DifyBuilderContext(goal_text=GOAL, reply_language="zh-Hans"), [])
    runner = Runner(Env(agent=agent, repo=repo, dify=FakeDifyPort(), now=lambda: datetime.min), build_registry())
    actor = Actor(account_id="actor", tenant_id="tenant")
    current = runner.advance(session.id, Turn(actor=actor))
    return runner, repo, current, actor, plans, model


def test_fresh_semantic_exclusion_reaches_both_gates_without_a_waiver(monkeypatch: pytest.MonkeyPatch) -> None:
    runner, repo, current, actor, plans, model = start_dialog(monkeypatch)
    assert len(plans) == 1
    assert repo.get_session(current.id)[1].plan_items == ["Translate supplied text"]
    result = runner.advance(
        current.id,
        Turn(
            actor=actor,
            action=Action(kind="confirm_resources", payload={"resource_ids": [MODEL]}, base_version=current.version),
        ),
    )
    context = repo.get_session(current.id)[1]
    assert result.current_state == PcState.BUILD_PLAN_APPROVAL
    assert context.goal_text == GOAL
    assert "knowledge_decision_pending" not in context.resource_selection
    assert "knowledge_scope_decision" not in context.resource_selection
    assert context.built_node_ids == []
    assert len(model.calls) == 1


@pytest.mark.parametrize(
    "intent",
    [
        None,
        {},
        {"state": "excluded", "evidence": ["invented exclusion"]},
        {"state": "excluded", "evidence": [EXCLUSION], "trusted": True},
    ],
)
def test_missing_or_malformed_semantics_keep_the_conservative_gate(
    monkeypatch: pytest.MonkeyPatch, intent: object
) -> None:
    runner, repo, current, actor, plans, _ = start_dialog(monkeypatch, intent=intent)
    assert plans == []
    result = runner.advance(
        current.id,
        Turn(
            actor=actor,
            action=Action(kind="confirm_resources", payload={"resource_ids": [MODEL]}, base_version=current.version),
        ),
    )
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert repo.get_session(current.id)[1].resource_selection["knowledge_decision_pending"]


@pytest.mark.parametrize(
    ("goal", "state", "evidence"),
    [
        (
            "Do not use OCR, scraping or knowledge bases; translate text.",
            "excluded",
            "Do not use OCR, scraping or knowledge bases",
        ),
        ("不需要图片识别、自动摘要、知识库或文件。", "excluded", "不需要图片识别、自动摘要、知识库或文件。"),
        ("Use knowledge base CompanyFAQ; do not use tools.", "required", "Use knowledge base CompanyFAQ"),
        (
            "Do not use tools, but retrieve from knowledge base CompanyFAQ.",
            "required",
            "retrieve from knowledge base CompanyFAQ",
        ),
        ("If available, use a knowledge base.", "required", "If available, use a knowledge base"),
        ("不禁止使用知识库。", "required", "不禁止使用知识库。"),
        ("Use a knowledge base, but no retrieval node configuration.", "required", "Use a knowledge base"),
    ],
)
def test_fixed_intent_preserves_semantic_positive_mixed_and_arbitrary_exclusions(
    goal: str, state: str, evidence: str
) -> None:
    from services.dify_builder.application.handlers_build import _knowledge_discovery_required
    from services.dify_builder.knowledge_source_intent import record_source_intent

    intent = {"state": state, "evidence": [evidence]}
    model = _FakeInstance([json.dumps({"fields": [], "values": {}, "knowledge_source_intent": intent})])
    result = build.analyze_goal(model, goal)
    context = DifyBuilderContext(goal_text=goal, confirmed_requirement_keys=[])
    record_source_intent(context, result.get("knowledge_source_intent"))
    assert _knowledge_discovery_required(context) is (state == "required")
    assert len(model.calls) == 1
    assert "mixed, conditional" in model.calls[0][0][0].content


@pytest.mark.parametrize("mutation", ["goal", "generation", "answer", "forged", "legacy"])
def test_stale_or_forged_exclusion_cannot_be_rebound_to_new_source(mutation: str) -> None:
    from services.dify_builder.application.handlers_build import _knowledge_discovery_required
    from services.dify_builder.knowledge_source_intent import current_source_intent, record_source_intent

    context = DifyBuilderContext(goal_text=GOAL, confirmed_requirement_keys=[])
    record_source_intent(context, INTENT)
    assert not _knowledge_discovery_required(context)
    if mutation == "goal":
        context.goal_text += " Now retrieve from CompanyFAQ knowledge base."
    elif mutation == "generation":
        context.task_control["generation"] = 1
    elif mutation == "answer":
        context.confirmed_requirement_keys = ["arbitrary_key"]
        context.requirements["arbitrary_key"] = "Use CompanyFAQ knowledge base"
        context.confirmed_requirement_sources["arbitrary_key"] = {
            "label": "Source",
            "value": "Use CompanyFAQ knowledge base",
        }
    elif mutation == "forged":
        context.knowledge_source_intent["source_digest"] = "fabricated"
    else:
        context.confirmed_requirement_keys = None
    assert current_source_intent(context) is None
    assert _knowledge_discovery_required(context)


@pytest.mark.parametrize("state", ["excluded", "unspecified", "unknown"])
def test_established_positive_cannot_be_waived_by_new_model_classification(state: str) -> None:
    from services.dify_builder.application.handlers_build import _knowledge_discovery_required
    from services.dify_builder.knowledge_source_intent import record_source_intent

    goal = "Use CompanyFAQ knowledge base. Do not use another knowledge base."
    context = DifyBuilderContext(goal_text=goal, confirmed_requirement_keys=[])
    record_source_intent(context, {"state": "required", "evidence": ["Use CompanyFAQ knowledge base"]})
    record_source_intent(context, {"state": state, "evidence": ["Do not use another knowledge base"]})
    assert _knowledge_discovery_required(context)
    assert "knowledge_scope_decision" not in context.resource_selection


def test_retained_source_cannot_be_waived_by_semantic_exclusion() -> None:
    from services.dify_builder.application.handlers_build import _knowledge_discovery_required
    from services.dify_builder.knowledge_source_intent import record_source_intent

    context = DifyBuilderContext(
        goal_text=GOAL,
        confirmed_requirement_keys=[],
        resource_selection={"blocked_capability": "knowledge_retrieval_phase_two"},
    )
    record_source_intent(context, INTENT)
    assert _knowledge_discovery_required(context)


@pytest.mark.parametrize(("answer", "required"), [(False, False), (True, True)])
def test_actual_submitted_control_refreshes_intent_in_the_existing_plan_call(
    monkeypatch: pytest.MonkeyPatch, answer: bool, required: bool
) -> None:
    from services.dify_builder.knowledge_source_intent import SOURCE_INPUT, user_source

    fields: list[dict[str, object]] = [
        {"key": "arbitrary_key", "label": "Use a knowledge base?", "type": "bool", "required": True}
    ]
    runner, repo, current, actor, plans, analysis_model = start_dialog(monkeypatch, fields=fields)
    # A displayed default is not yet source. Invalid/missing submission must
    # not invoke planning or refresh the old negative digest.
    context = repo.get_session(current.id)[1]
    original_digest = context.knowledge_source_intent["source_digest"]
    invalid = runner.advance(
        current.id,
        Turn(actor=actor, action=Action(kind="submit_requirements", payload={}, base_version=current.version)),
    )
    assert plans == []
    assert repo.get_session(current.id)[1].knowledge_source_intent["source_digest"] == original_digest
    agent = runner._env.agent
    replies = [
        {
            "title": "Translation",
            "input_summary": "Text",
            "output_summary": "Translation",
            "plan": ["llm translates supplied text"],
            "knowledge_source_intent": {
                "state": "required" if required else "excluded",
                "evidence": ["Use a knowledge base?"] if required else [EXCLUSION],
            },
        }
    ]
    planning_model = _FakeInstance([json.dumps(reply) for reply in replies])

    def propose(
        requirements: dict[str, object], *, goal_text: str, reply_language: str | None = None
    ) -> WorkflowPlan | BuildClarification | None:
        plans.append(requirements)
        return build.propose_plan_v1(planning_model, requirements, goal_text=goal_text, reply_language=reply_language)

    monkeypatch.setattr(agent, "propose_plan_v1", propose)
    result = runner.advance(
        current.id,
        Turn(
            actor=actor,
            action=Action(
                kind="submit_requirements",
                payload={"arbitrary_key": answer, "no_knowledge_base": False},
                base_version=invalid.version,
            ),
        ),
    )
    context = repo.get_session(current.id)[1]
    assert result.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert len(plans) == len(planning_model.calls) == len(analysis_model.calls) == 1
    assert plans[0][SOURCE_INPUT] == user_source(context)
    assert context.confirmed_requirement_sources["arbitrary_key"]["value"] is answer
    assert context.confirmed_requirement_sources["arbitrary_key"]["label"] == "Use a knowledge base?"
    assert context.requirements["no_knowledge_base"] is True  # forged hidden payload was not merged
    assert context.knowledge_source_intent["source_digest"] != original_digest
    assert context.knowledge_source_intent["required"] is required
    assert bool(context.plan_items) is not required


def test_planning_clarification_keeps_semantic_metadata_without_extra_calls() -> None:
    from services.dify_builder.knowledge_source_intent import SOURCE_INPUT
    from services.dify_builder.plan import BuildClarification

    reply = {
        "kind": "clarification",
        "fields": [
            {"key": "language", "label": "Language", "type": "text", "required": True, "hint": "Recommend English"}
        ],
        "values": {"language": "English"},
        "knowledge_source_intent": INTENT,
    }
    model = _FakeInstance([json.dumps(reply)])
    result = build.propose_plan_v1(
        model, {SOURCE_INPUT: {"goal": GOAL, "answers": [], "generation": 0}}, goal_text=GOAL
    )
    assert isinstance(result, BuildClarification)
    assert result.knowledge_source_intent is not None
    assert result.knowledge_source_intent["state"] == INTENT["state"]
    assert result.knowledge_source_intent["evidence"] == INTENT["evidence"]
    assert result.knowledge_source_intent["source_digest"]
    assert result.values == {"language": "English"}
    assert len(model.calls) == 1


def test_old_planning_intent_cannot_be_rebound_after_a_new_real_answer() -> None:
    from services.dify_builder.knowledge_source_intent import (
        SOURCE_INPUT,
        current_source_intent,
        record_source_intent,
        user_source,
    )

    context = DifyBuilderContext(goal_text=GOAL, confirmed_requirement_keys=[])
    source = user_source(context)
    model = _FakeInstance(
        [
            json.dumps(
                {
                    "title": "Translation",
                    "input_summary": "Text",
                    "output_summary": "Translation",
                    "plan": ["Translate text"],
                    "knowledge_source_intent": INTENT,
                }
            )
        ]
    )
    plan = build.propose_plan_v1(model, {SOURCE_INPUT: source}, goal_text=GOAL)
    assert isinstance(plan, WorkflowPlan)
    record_source_intent(context, plan.knowledge_source_intent)
    old_digest = context.knowledge_source_intent["source_digest"]
    context.confirmed_requirement_keys = ["x"]
    context.requirements["x"] = "Use CompanyFAQ knowledge base"
    context.confirmed_requirement_sources["x"] = {
        "label": "Source",
        "type": "text",
        "options": list[str](),
        "value": context.requirements["x"],
    }
    record_source_intent(context, plan.knowledge_source_intent)
    assert context.knowledge_source_intent["source_digest"] == old_digest
    assert current_source_intent(context) is None


@pytest.mark.parametrize("guard", ["offered", "knowledge_source_unavailable", "knowledge_requires_clarification"])
def test_fresh_semantic_exclusion_does_not_override_independent_source_guards(
    monkeypatch: pytest.MonkeyPatch, guard: str
) -> None:
    runner, repo, current, actor, _, _ = start_dialog(monkeypatch)
    context = repo.get_session(current.id)[1]
    if guard == "offered":
        context.resource_selection["offered_knowledge_ids"] = ["knowledge:authorized"]
    else:
        context.resource_selection[guard] = True
    version = repo.compare_and_advance(current.id, current.version, current.current_state, context, [])
    current.version = version
    result = runner.advance(
        current.id,
        Turn(
            actor=actor,
            action=Action(kind="confirm_resources", payload={"resource_ids": [MODEL]}, base_version=current.version),
        ),
    )
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert repo.get_session(current.id)[1].resource_selection["knowledge_decision_pending"]


def test_confirmed_bool_source_cannot_match_a_changed_numeric_value() -> None:
    from services.dify_builder.knowledge_source_intent import current_source_intent, record_source_intent

    context = DifyBuilderContext(
        goal_text=GOAL,
        confirmed_requirement_keys=["x"],
        requirements={"x": False},
        confirmed_requirement_sources={"x": {"label": "Use a knowledge base?", "value": False}},
    )
    record_source_intent(context, INTENT)
    assert current_source_intent(context) is not None
    context.requirements["x"] = 0
    assert current_source_intent(context) is None


@pytest.mark.parametrize("bad_answer", [None, "false", 0, {}, []])
def test_invalid_typed_submission_does_not_refresh_or_confirm_a_default(
    monkeypatch: pytest.MonkeyPatch, bad_answer: object
) -> None:
    fields: list[dict[str, object]] = [{"key": "x", "label": "Use a knowledge base?", "type": "bool", "required": True}]
    runner, repo, current, actor, plans, _ = start_dialog(monkeypatch, fields=fields)
    digest = repo.get_session(current.id)[1].knowledge_source_intent["source_digest"]
    result = runner.advance(
        current.id,
        Turn(
            actor=actor,
            action=Action(kind="submit_requirements", payload={"x": bad_answer}, base_version=current.version),
        ),
    )
    context = repo.get_session(current.id)[1]
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert context.confirmed_requirement_keys == []
    assert context.confirmed_requirement_sources == {}
    assert context.knowledge_source_intent["source_digest"] == digest
    assert plans == []


@pytest.mark.parametrize("result", [None, {"state": "unknown", "evidence": []}])
def test_missing_or_unknown_refresh_cannot_drop_a_new_typed_source_answer(result: object) -> None:
    from services.dify_builder.application.handlers_build import _knowledge_discovery_required
    from services.dify_builder.knowledge_source_intent import record_source_intent

    goal = "Do not use a knowledge base; translate supplied text."
    context = DifyBuilderContext(goal_text=goal, confirmed_requirement_keys=[])
    record_source_intent(context, {"state": "excluded", "evidence": ["Do not use a knowledge base"]})
    context.confirmed_requirement_keys = ["x"]
    context.requirements["x"] = True
    context.confirmed_requirement_sources["x"] = {
        "label": "Use CompanyFAQ knowledge base?",
        "type": "bool",
        "value": True,
    }
    record_source_intent(context, result)
    assert _knowledge_discovery_required(context)


def test_semantic_source_survives_the_real_context_json_boundary() -> None:
    from services.dify_builder.knowledge_source_intent import current_source_intent, record_source_intent
    from services.dify_builder.serde import context_from_dict, context_to_dict

    context = DifyBuilderContext(
        goal_text=GOAL,
        confirmed_requirement_keys=["x"],
        requirements={"x": False},
        confirmed_requirement_sources={"x": {"label": "Use a knowledge base?", "type": "bool", "value": False}},
    )
    record_source_intent(context, INTENT)
    restored = context_from_dict(json.loads(json.dumps(context_to_dict(context))))
    assert restored.knowledge_source_intent == context.knowledge_source_intent
    assert restored.confirmed_requirement_sources == context.confirmed_requirement_sources
    assert current_source_intent(restored) == INTENT
    legacy = context_from_dict({"goal_text": GOAL})
    assert legacy.knowledge_source_intent == legacy.confirmed_requirement_sources == {}
    assert current_source_intent(legacy) is None
