"""Server confirmation provenance bounds only explicit raw source exclusions."""

import json
from datetime import datetime
from typing import override

import pytest

from core.dify_builder.models import Action, Actor, ConversationItem, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.state import PcState
from services.dify_builder.application.handlers_build import (
    _collect_adjustment,
    handle_capability_check,
    handle_goal_analysis,
)
from services.dify_builder.application.runner import Env
from services.dify_builder.conversation_tasks import _reset_for_new_task
from services.dify_builder.plan import WorkflowPlan
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.serde import context_from_dict, context_to_dict
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository
from tests.unit_tests.services.dify_builder.test_bound_resource_plan_reconciliation import ReconciliationAgent
from tests.unit_tests.services.dify_builder.test_knowledge_discovery import MODEL, PLAN, confirm
from tests.unit_tests.services.dify_builder.test_knowledge_source_cue import CAPTURED_MEETING_GOAL

pytest_plugins = ["tests.unit_tests.services.dify_builder.test_service"]

CAPTURED_REQUIREMENTS = {
    "mode": "draft_only_plan_review",
    "llm_rules": [
        "区分已决定与未决定",
        "缺失负责人、日期、金额标注待确认，不编造",
        "风险与阻塞只列原文明示内容，未提及则写「原文未提及」",
    ],
    "end_outputs": [{"type": "text", "source": "LLM.text", "variable": "minutes"}],
    "model_policy": "使用当前已配置可用的模型，不新增资源、工具、Code、Agent、HTTP、知识库、文件或凭据",
    "start_inputs": [{"type": "text", "label": "会议原文", "required": True, "variable": "meeting_notes"}],
    "workflow_name": "Dev ENG1235 Meeting 439e",
    "allowed_topology": "Start → LLM → End，3 个节点、2 条连线",
    "execution_policy": "先生成计划供审阅，不执行测试或发布",
    "llm_output_language": "中文",
    "llm_sections_in_order": ["结论", "待办", "待确认事项", "风险与阻塞"],
}


class ProvenanceAgent(ReconciliationAgent):
    @override
    def analyze_goal(self, goal_text: str, *, reply_language: str | None = None) -> dict[str, object]:
        return {"fields": [], "values": dict(CAPTURED_REQUIREMENTS)}

    @override
    def propose_plan_v1(
        self, requirements: dict[str, object], *, goal_text: str, reply_language: str | None = None
    ) -> WorkflowPlan:
        return PLAN


def setup_context() -> tuple[Env, Session, DifyBuilderContext]:
    context = DifyBuilderContext(goal_text=CAPTURED_MEETING_GOAL, requirements=dict(CAPTURED_REQUIREMENTS))
    session = Session(app_id="app", entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_CAPABILITY_CHECK)
    env = Env(agent=ProvenanceAgent(PLAN), repo=InMemoryRepository(), dify=FakeDifyPort(), now=lambda: datetime.min)
    return env, session, context


def submit(env: Env, session: Session, context: DifyBuilderContext, payload: dict[str, object]) -> None:
    handle_goal_analysis(
        env,
        Turn(
            actor=Actor(account_id="actor", tenant_id="tenant"),
            action=Action(kind="submit_requirements", payload=payload),
        ),
        session,
        context,
    )


def _confirm(
    context: DifyBuilderContext,
) -> tuple[Session, DifyBuilderContext, ReconciliationAgent, list[ConversationItem]]:
    agent = ReconciliationAgent(PLAN)
    session, restored, _, items = confirm(agent, offered=[], ids=[MODEL], context=context)
    return session, restored, agent, items


def test_actual_fresh_analysis_ignores_only_unconfirmed_derived_source_summary() -> None:
    env, session, context = setup_context()
    result = handle_capability_check(env, Turn(actor=Actor(account_id="actor", tenant_id="tenant")), session, context)
    assert result.next == PcState.BUILD_INITIAL_PLAN
    agent = ReconciliationAgent(PLAN)
    result_session, restored, _, _ = confirm(agent, offered=[], ids=[MODEL], context=context)
    assert result_session.current_state == PcState.BUILD_PLAN_APPROVAL
    assert restored.goal_text == CAPTURED_MEETING_GOAL
    assert agent.requests[0]["requirements"] == CAPTURED_REQUIREMENTS
    assert not restored.resource_selection.get("knowledge_scope_decision")


@pytest.mark.parametrize("value", ["使用知识库回答", "如果需要则访问知识库", "不新增知识库", "默认使用知识库"])
def test_explicitly_submitted_source_values_and_defaults_remain_guarded(value: str) -> None:
    env, session, context = setup_context()
    handle_capability_check(env, Turn(actor=Actor(account_id="actor", tenant_id="tenant")), session, context)
    context.form_fields = [{"key": "answer", "type": "text"}]
    context.requirements["answer"] = value
    submit(env, session, context, {"answer": value})
    result, restored, agent, _ = _confirm(context)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert agent.requests == []
    assert restored.confirmed_requirement_keys == ["answer"]


def test_only_present_offered_payload_keys_are_confirmed_and_current_values_are_used() -> None:
    env, session, context = setup_context()
    handle_capability_check(env, Turn(actor=Actor(account_id="actor", tenant_id="tenant")), session, context)
    context.form_fields = [{"key": "answer", "type": "text"}, {"key": "not_submitted", "type": "text"}]
    context.requirements.update(answer="使用知识库", not_submitted="使用知识库")
    submit(
        env,
        session,
        context,
        {
            "answer": "无需知识库",
            "model_policy": "使用知识库",
            "forged": "使用知识库",
            "confirmed_requirement_keys": ["model_policy"],
        },
    )
    assert context.confirmed_requirement_keys == ["answer"]
    assert "forged" not in context.requirements
    assert context.requirements["model_policy"] == CAPTURED_REQUIREMENTS["model_policy"]
    result, _, agent, _ = _confirm(context)
    assert result.current_state == PcState.BUILD_PLAN_APPROVAL
    assert len(agent.requests) == 1


@pytest.mark.parametrize(
    "goal", ["根据公司文档回答", "使用知识库", "如果需要使用知识库", "不使用知识库，但是使用知识检索"]
)
def test_raw_goal_without_complete_explicit_exclusion_keeps_full_requirements_guard(goal: str) -> None:
    env, session, context = setup_context()
    handle_capability_check(env, Turn(actor=Actor(account_id="actor", tenant_id="tenant")), session, context)
    context.goal_text = goal
    result, _, agent, _ = _confirm(context)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert agent.requests == []


@pytest.mark.parametrize("provenance", [None, "answer", {}, [1], [""], ["missing"]])
def test_unknown_malformed_or_missing_key_provenance_never_drops_the_source_guard(provenance: object) -> None:
    _, _, context = setup_context()
    context.__dict__["confirmed_requirement_keys"] = provenance
    result, _, agent, _ = _confirm(context)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert agent.requests == []


def test_missing_confirmed_key_fails_closed_even_without_another_source_value() -> None:
    _, _, context = setup_context()
    context.requirements = {"style": "brief"}
    context.confirmed_requirement_keys = ["missing"]
    result, _, agent, _ = _confirm(context)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert agent.requests == []


@pytest.mark.parametrize(
    "selection",
    [
        {"offered_knowledge_ids": ["knowledge:offered"]},
        {"knowledge_source_unavailable": True},
        {"knowledge_requires_clarification": True},
        {"blocked_capability": "knowledge_retrieval_phase_two"},
    ],
)
def test_fresh_provenance_never_waives_other_server_source_guards(selection: dict[str, object]) -> None:
    env, session, context = setup_context()
    handle_capability_check(env, Turn(actor=Actor(account_id="actor", tenant_id="tenant")), session, context)
    context.resource_selection = selection
    result, _, agent, _ = _confirm(context)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert agent.requests == []


@pytest.mark.parametrize("keys", [None, [], ["answer"]])
def test_confirmation_provenance_roundtrips_without_aliasing(keys: list[str] | None) -> None:
    _, _, context = setup_context()
    context.confirmed_requirement_keys = keys
    restored = context_from_dict(json.loads(json.dumps(context_to_dict(context))))
    assert restored.confirmed_requirement_keys == keys
    if keys is not None:
        assert restored.confirmed_requirement_keys is not None
        restored.confirmed_requirement_keys.append("other")
        assert context.confirmed_requirement_keys == keys


@pytest.mark.parametrize("raw", ["answer", {}, [1], ["answer", None], [""], ["answer", "answer"]])
def test_malformed_serialized_provenance_decodes_as_legacy_unknown(raw: object) -> None:
    restored = context_from_dict({"confirmed_requirement_keys": raw})
    assert restored.confirmed_requirement_keys is None


def test_missing_serialized_provenance_stays_unknown_after_a_later_submission() -> None:
    env, session, _ = setup_context()
    context = context_from_dict(
        {
            "goal_text": CAPTURED_MEETING_GOAL,
            "requirements": CAPTURED_REQUIREMENTS,
            "form_fields": [{"key": "style", "type": "text"}],
        }
    )
    submit(env, session, context, {"style": "brief"})
    assert context.confirmed_requirement_keys is None
    result, _, _, _ = _confirm(context)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS


def test_reanalysis_replaces_stale_confirmation_provenance() -> None:
    env, session, context = setup_context()
    context.confirmed_requirement_keys = ["old"]
    handle_capability_check(env, Turn(actor=Actor(account_id="actor", tenant_id="tenant")), session, context)
    assert context.confirmed_requirement_keys == []


@pytest.mark.parametrize("mode", list(EntryMode))
def test_new_task_reset_cannot_reuse_old_confirmation_provenance(mode: EntryMode) -> None:
    _, session, context = setup_context()
    context.confirmed_requirement_keys = ["model_policy"]
    _reset_for_new_task(session, context, mode)
    assert context.confirmed_requirement_keys is None


def test_adjustment_history_retains_confirmed_source_after_request_is_cleared() -> None:
    env, session, context = setup_context()
    handle_capability_check(env, Turn(actor=Actor(account_id="actor", tenant_id="tenant")), session, context)
    _collect_adjustment(context)
    submit(env, session, context, {"__builder_adjustment_request": "使用知识库"})
    _collect_adjustment(context)
    assert context.requirements["__builder_adjustment_request"] == ""
    assert context.confirmed_requirement_keys == ["__builder_adjustment_history"]
    result, _, agent, _ = _confirm(context)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert agent.requests == []


def test_clear_discards_confirmation_provenance_at_the_durable_owner(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    from tests.unit_tests.services.dify_builder.test_conversation_lifecycle import lifecycle, seed
    from tests.unit_tests.services.dify_builder.test_service import _actor

    session = seed(repo)
    current, context = repo.get_session(session.id)
    context.confirmed_requirement_keys = ["old"]
    repo.compare_and_advance(session.id, current.version, current.current_state, context, [])
    current, _ = repo.get_session(session.id)
    lifecycle().clear(
        service, session.id, _actor(), base_version=current.version, client_action_id="clear", confirmed=True
    )
    _, cleared = repo.get_session(session.id)
    assert cleared.confirmed_requirement_keys is None


def test_fix_activation_clears_provenance_with_replaced_requirements(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository
    from tests.unit_tests.services.dify_builder.test_fix_intents import ACTOR, native_run, queue
    from tests.unit_tests.services.dify_builder.test_service import ACCOUNT_ID, APP_ID, TENANT_ID

    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_COMPLETE,
    )
    repo.create_session(
        session,
        DifyBuilderContext(requirements={"old": "使用知识库"}, confirmed_requirement_keys=["old"]),
        [],
    )
    intent = queue(repo, session, native_run(repo))
    activated = SqlFixIntentRepository(repo).activate(ACTOR, session.id, intent.id, dsl={}, revision="current-draft")
    _, context = repo.get_session(session.id)
    assert activated.status == "activated"
    assert context.requirements == {}
    assert context.confirmed_requirement_keys is None
