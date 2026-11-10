"""一期 knowledge discovery is actor-scoped preference collection, never RAG execution."""

from dataclasses import replace
from datetime import datetime
from typing import TYPE_CHECKING, NoReturn, override

import pytest

from core.dify_builder.contract import ResourceOption
from core.dify_builder.models import Action, Actor, ConversationItem, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.state import PcState
from services.dify_builder.agent import build, resources
from services.dify_builder.application.handlers_build import build_registry
from services.dify_builder.application.ports import DifyBuilderAgent
from services.dify_builder.application.runner import Env, Runner
from services.dify_builder.plan import BuildClarification, ResourceDiscovery, WorkflowPlan
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository
from tests.unit_tests.services.dify_builder.test_bound_resource_plan_reconciliation import ReconciliationAgent
from tests.unit_tests.services.dify_builder.test_knowledge_source_cue import (
    CAPTURED_AGENT_GOAL,
    CAPTURED_BARE_ROLE_REQUIREMENTS,
    CAPTURED_FORBIDDEN_ADDITIONS,
    CAPTURED_MEETING_GOAL,
    CAPTURED_MEETING_REQUIREMENTS,
    CAPTURED_NO_EXTRA_COMPONENTS,
    MEETING_GOAL,
)

if TYPE_CHECKING:
    from services.dify_builder.repository import SqlDifyBuilderRepository
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.services.dify_builder.test_service import Enqueued

pytest_plugins = ["tests.unit_tests.services.dify_builder.test_service"]

DATASET = "25f76fa8-db3b-499d-b7fc-2bfbddad778a"
KNOWLEDGE = "knowledge:" + DATASET
MODEL = "provider/model"
PLAN = WorkflowPlan(
    "Knowledge questions",
    "A question",
    "Answers require unavailable retrieval",
    ["Collect the user's knowledge preferences; retrieval is unavailable in phase one."],
)


def inventory(*, use: str = "allowed", include_model: bool = False) -> resources.TenantResources:
    return resources.TenantResources(
        models=[resources.ResourceRef(id=MODEL, label="Existing model")] if include_model else [],
        datasets=[
            resources.ResourceRef(
                id=DATASET,
                label="Permitted synthetic KB",
                meta="Empty dataset; no documents.",
                readiness="waiting_setup",
                availability={"scope": "discovery_only", "use": use, "documents": "empty", "runtime": "not_supported"},
            )
        ],
        tools=[],
    )


def test_only_dataset_is_recommended_as_nonexecuting_preference(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inventory())

    def invoke(_model: object, **values: object) -> dict[str, object]:
        calls.append(values)
        return {
            "resource_ids": [KNOWLEDGE],
            "selection_reasons": {KNOWLEDGE: "Matches the explicitly requested knowledge source; discovery only."},
        }

    monkeypatch.setattr(build.llm, "invoke_json", invoke)
    options = build.discover_resources(
        object(),
        "tenant",
        PLAN.items,
        goal_text="先选择有权限的知识库，不执行",
        account_id="actor",
        reply_language="zh-Hans",
    )
    assert [(o.id, o.kind) for o in options] == [(KNOWLEDGE, "knowledge")]
    assert options[0].readiness == "waiting_setup"
    assert "一期" in options[0].meta
    assert "检索" in options[0].meta
    assert len(calls) == 1
    assert KNOWLEDGE in str(calls[0]["user"])
    assert "discovery" in str(calls[0]["system"]).lower()


@pytest.mark.parametrize("documents", ["empty", "indexing"])
def test_named_unready_knowledge_prompt_preserves_discovery_preference(
    monkeypatch: pytest.MonkeyPatch, documents: str
) -> None:
    name = "QA1386-product-docs-empty-1030"
    named = replace(
        inventory().datasets[0],
        label=name,
        meta=f"Discovery only; available documents: 0; status: {documents}; use permission: allowed.",
        availability={"scope": "discovery_only", "use": "allowed", "documents": documents, "runtime": "not_supported"},
    )
    inv = resources.TenantResources(models=[], datasets=[named], tools=[])
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inv)
    prompts: list[dict[str, object]] = []

    def invoke(_model: object, **values: object) -> dict[str, object]:
        prompts.append(values)
        return {
            "resource_ids": [KNOWLEDGE],
            "selection_reasons": {KNOWLEDGE: "Preserves the explicitly named source as a discovery preference."},
            "knowledge_requires_clarification": True,
        }

    monkeypatch.setattr(build.llm, "invoke_json", invoke)
    options = build.discover_resources(
        object(),
        "tenant",
        PLAN.items,
        goal_text=f"必须从知识库 {name} 检索依据后用中文回答；找不到依据时说明无法回答。",
        requirements={"knowledge_base": name, "answer_language": "中文"},
        account_id="actor",
    )
    system = str(prompts[0]["system"])
    user = str(prompts[0]["user"])
    # Outbound cognition contract only; this does not prove real-model ranking.
    assert "Preserve an explicitly required, listed knowledge identity" in system
    assert "actor-scoped metadata says use=allowed" in system
    assert "waiting_setup" in system
    assert "empty or indexing" in system
    assert "Copy the complete knowledge:<id> verbatim, never a bare dataset UUID" in system
    assert "knowledge_requires_clarification=true" in system
    assert system.index("# Native build capability and external resource scope") < system.index(
        "Preserve an explicitly required, listed knowledge identity"
    )
    assert name in user
    assert f"- {KNOWLEDGE} (knowledge, waiting_setup)" in user
    assert isinstance(options, ResourceDiscovery)
    assert [(o.id, o.kind, o.readiness) for o in options] == [(KNOWLEDGE, "knowledge", "waiting_setup")]
    assert options.knowledge_requires_clarification is True


def test_named_knowledge_selection_keeps_model_ranking_and_exact_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    inv = inventory(include_model=True)
    other = replace(
        inv.datasets[0],
        id="other-dataset",
        label="Unrelated ready knowledge",
        readiness="ready",
        meta="Available documents: 1; status: indexed; use permission: allowed.",
        availability={"scope": "discovery_only", "use": "allowed", "documents": "indexed", "runtime": "not_supported"},
    )
    inv = replace(inv, datasets=[other, replace(inv.datasets[0], label="QA1386-product-docs-empty-1030")])
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inv)
    monkeypatch.setattr(
        build.llm,
        "invoke_json",
        lambda *_a, **_k: {
            "resource_ids": [KNOWLEDGE],
            "selection_reasons": {KNOWLEDGE: "Matches the explicitly named discovery preference."},
            "knowledge_requires_clarification": True,
        },
    )
    options = build.discover_resources(
        object(),
        "tenant",
        PLAN.items,
        requirements={"knowledge_base": "QA1386-product-docs-empty-1030"},
        account_id="actor",
    )
    assert [o.id for o in options] == [KNOWLEDGE]
    assert "Matches the explicitly named discovery preference." in options[0].meta
    assert "cannot bind, generate or execute retrieval" in options[0].meta


@pytest.mark.parametrize("listed", [False, True])
def test_named_knowledge_empty_model_selection_never_invents_a_preference(
    monkeypatch: pytest.MonkeyPatch, listed: bool
) -> None:
    inv = inventory() if listed else resources.TenantResources(models=[], datasets=[], tools=[])
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inv)
    monkeypatch.setattr(
        build.llm,
        "invoke_json",
        lambda *_a, **_k: {"resource_ids": [], "knowledge_requires_clarification": True},
    )
    options = build.discover_resources(
        object(), "tenant", PLAN.items, requirements={"knowledge_base": "Permitted synthetic KB"}, account_id="actor"
    )
    assert isinstance(options, ResourceDiscovery)
    assert options == []
    assert options.knowledge_requires_clarification is True
    assert options.knowledge_source_unavailable is False


def test_knowledge_confirmation_is_metadata_only_and_never_replans(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inventory(include_model=True))
    calls: list[object] = []

    def planner(*args: object, **kwargs: object) -> NoReturn:
        calls.append((args, kwargs))
        raise AssertionError("Knowledge preferences must not replan an executable substitute")

    monkeypatch.setattr(build, "propose_plan_v1", planner)
    result = build.reconcile_resource_plan(
        object(),
        "tenant",
        PLAN,
        [MODEL, KNOWLEDGE],
        account_id="actor",
        goal_text="Use the knowledge I select",
        requirements={},
    )
    assert isinstance(result, WorkflowPlan)
    assert result.used_resource_ids == []
    assert result.discovery_resource_ids == [KNOWLEDGE]
    assert result.items == PLAN.items
    assert calls == []


@pytest.mark.parametrize(("use", "missing"), [("not_allowed", False), ("allowed", True)])
def test_revoked_or_missing_selected_knowledge_refuses_entire_selection(
    monkeypatch: pytest.MonkeyPatch, use: str, missing: bool
) -> None:
    inv = inventory(use=use, include_model=True)
    if missing:
        inv = replace(inv, datasets=[])
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inv)
    calls: list[object] = []

    def planner(*args: object, **kwargs: object) -> NoReturn:
        calls.append((args, kwargs))
        raise AssertionError("Unverified IDs cannot reach cognition")

    monkeypatch.setattr(build, "propose_plan_v1", planner)
    assert (
        build.reconcile_resource_plan(
            object(),
            "tenant",
            PLAN,
            [MODEL, KNOWLEDGE],
            account_id="actor",
            goal_text="Select knowledge",
            requirements={},
        )
        is None
    )
    assert calls == []


def confirm(
    agent: DifyBuilderAgent, *, offered: list[str], ids: list[str], context: DifyBuilderContext | None = None
) -> tuple[Session, DifyBuilderContext, DifyBuilderAgent, list[ConversationItem]]:
    repo = InMemoryRepository()
    session = Session(app_id="app", entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_RESOURCE_RECOMMENDATION)
    ctx = context or DifyBuilderContext(
        goal_text="Use only the knowledge I select; do not execute",
        requirements={"citations": True},
        plan_items=list(PLAN.items),
        resource_selection={"offered_knowledge_ids": offered},
    )
    repo.create_session(session, ctx, [])
    port = FakeDifyPort()
    runner = Runner(Env(agent=agent, repo=repo, dify=port, now=lambda: datetime.min), build_registry())
    result = runner.advance(
        session.id,
        Turn(
            actor=Actor(account_id="actor", tenant_id="tenant"),
            action=Action(kind="confirm_resources", payload={"resource_ids": ids}, base_version=1),
        ),
    )
    return result, repo.get_session(session.id)[1], agent, repo.list_conversation(session.id)


def test_handler_remembers_preference_but_waits_without_checkpoint_or_plan_approval() -> None:
    plan = replace(PLAN, used_resource_ids=[], discovery_resource_ids=[KNOWLEDGE])
    agent = ReconciliationAgent(plan)
    result, context, _, items = confirm(agent, offered=[KNOWLEDGE], ids=[KNOWLEDGE])
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert context.resource_selection["knowledge_preferences"] == [KNOWLEDGE]
    assert context.resource_selection["resource_ids"] == []
    assert context.resource_selection["blocked_capability"] == "knowledge_retrieval_phase_two"
    assert context.checkpoint_id == ""
    assert any("检索" in str(item.payload) or "retriev" in str(item.payload).lower() for item in items)


def test_unoffered_knowledge_id_never_reaches_reconciliation() -> None:
    agent = ReconciliationAgent(PLAN)
    result, _, _, _ = confirm(agent, offered=[], ids=[KNOWLEDGE])
    assert result.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert agent.requests == []


def test_mixed_unoffered_knowledge_id_does_not_silently_keep_model() -> None:
    agent = ReconciliationAgent(PLAN)
    result, _, _, _ = confirm(agent, offered=[KNOWLEDGE], ids=[MODEL, "knowledge:forged"])
    assert result.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert agent.requests == []


def test_selected_knowledge_cannot_be_unchecked_into_a_silent_executable_substitute() -> None:
    ctx = DifyBuilderContext(
        goal_text="Must retrieve selected knowledge",
        resource_selection={
            "offered_knowledge_ids": [KNOWLEDGE],
            "knowledge_preferences": [KNOWLEDGE],
            "blocked_capability": "knowledge_retrieval_phase_two",
        },
    )
    agent = ReconciliationAgent(PLAN)
    result, context, _, items = confirm(agent, offered=[KNOWLEDGE], ids=[MODEL], context=ctx)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert context.resource_selection["knowledge_preferences"] == [KNOWLEDGE]
    assert agent.requests == []


def test_metadata_confirmation_does_not_even_resolve_a_cognition_model(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inventory())
    calls: list[object] = []

    def resolver() -> NoReturn:
        calls.append("resolve")
        raise AssertionError("Metadata-only confirmation must not resolve a model")

    agent = LlmBuilderAgent("tenant", account_id="actor", model_resolver_fn=resolver)
    result = agent.reconcile_resource_plan(PLAN, [KNOWLEDGE], goal_text="Select knowledge only", requirements={})
    assert isinstance(result, WorkflowPlan)
    assert result.discovery_resource_ids == [KNOWLEDGE]
    assert calls == []


def test_source_failure_never_uses_a_retained_dataset_as_authority(monkeypatch: pytest.MonkeyPatch) -> None:
    inv = replace(inventory(include_model=True), dataset_source_error="inventory_unavailable")
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inv)
    assert (
        build.reconcile_resource_plan(
            None, "tenant", PLAN, [KNOWLEDGE], account_id="actor", goal_text="Select", requirements={}
        )
        is None
    )


def test_real_agent_and_handler_wait_without_any_workflow_or_model_side_effect(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inventory())
    calls: list[object] = []

    def resolver() -> NoReturn:
        calls.append("resolve")
        raise AssertionError("No model call")

    agent = LlmBuilderAgent("tenant", account_id="actor", model_resolver_fn=resolver)
    result, ctx, _, items = confirm(agent, offered=[KNOWLEDGE], ids=[KNOWLEDGE])
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert ctx.resource_selection["knowledge_preferences"] == [KNOWLEDGE]
    assert not ctx.checkpoint_id
    assert not any(item.kind == "plan" for item in items)
    assert calls == []


def test_real_discovery_card_persists_its_exact_knowledge_allowlist() -> None:
    class KnowledgeAgent(ReconciliationAgent):
        @override
        def discover_resources(self, *_args: object, **_kwargs: object) -> list[ResourceOption]:
            return [
                ResourceOption(
                    id=KNOWLEDGE,
                    label="Visible only",
                    meta="Discovery only",
                    kind="knowledge",
                    readiness="waiting_setup",
                )
            ]

        @override
        def assess_capability_gap(self, *_args: object, **_kwargs: object) -> str:
            return "Knowledge discovery only; retrieval unavailable."

    repo = InMemoryRepository()
    session = Session(app_id="app", entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_INITIAL_PLAN)
    repo.create_session(session, DifyBuilderContext(goal_text="Select knowledge", plan_items=list(PLAN.items)), [])
    runner = Runner(
        Env(agent=KnowledgeAgent(PLAN), repo=repo, dify=FakeDifyPort(), now=lambda: datetime.min), build_registry()
    )
    result = runner.advance(session.id, Turn(actor=Actor(account_id="actor", tenant_id="tenant")))
    assert result.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    _, context = repo.get_session(session.id)
    assert context.resource_selection["offered_knowledge_ids"] == [KNOWLEDGE]
    card = next(item for item in repo.list_conversation(session.id) if item.kind == "resource_select")
    assert card.payload["recommended"][0]["id"] == KNOWLEDGE


def test_reconfirmation_rechecks_permission_even_after_preference_was_recorded(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inventory(use="not_allowed"))
    ctx = DifyBuilderContext(
        goal_text="Must retrieve knowledge",
        resource_selection={
            "offered_knowledge_ids": [KNOWLEDGE],
            "knowledge_preferences": [KNOWLEDGE],
            "blocked_capability": "knowledge_retrieval_phase_two",
        },
    )
    agent = LlmBuilderAgent("tenant", account_id="actor")
    result, context, _, _ = confirm(agent, offered=[KNOWLEDGE], ids=[MODEL, KNOWLEDGE], context=ctx)
    assert result.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert not context.checkpoint_id
    assert context.resource_selection.get("resource_ids", []) == []


@pytest.mark.parametrize("selected", [[], [MODEL]])
def test_first_decline_asks_explicit_goal_change_instead_of_approving(selected: list[str]) -> None:
    result, context, _, items = confirm(ReconciliationAgent(PLAN), offered=[KNOWLEDGE], ids=selected)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert context.checkpoint_id == ""
    assert any(item.kind == "form" for item in items)
    assert context.resource_selection["knowledge_decision_pending"]["original_goal"] == context.goal_text


def test_knowledge_catalogue_failure_without_selected_id_cannot_approve() -> None:
    ctx = DifyBuilderContext(
        goal_text="Use selected knowledge", resource_selection={"knowledge_source_unavailable": True}
    )
    result, _, _, _ = confirm(ReconciliationAgent(PLAN), offered=[], ids=[], context=ctx)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS


def test_model_only_confirmation_does_not_ask_to_waive_an_explicitly_excluded_knowledge_goal() -> None:
    plan = WorkflowPlan(
        "Text summary", "Supplied text", "Summary", ["Use the selected model"], used_resource_ids=[MODEL]
    )
    context = DifyBuilderContext(
        goal_text=MEETING_GOAL,
        requirements={"no_tools_http_agent_kb_files_external_accounts": True},
        resource_selection={"knowledge_source_unavailable": False, "knowledge_requires_clarification": False},
    )
    result, stored, _, items = confirm(ReconciliationAgent(plan), offered=[], ids=[MODEL], context=context)
    assert result.current_state == PcState.BUILD_PLAN_APPROVAL
    assert stored.resource_selection["resource_ids"] == [MODEL]
    assert "knowledge_decision_pending" not in stored.resource_selection
    assert not any(item.kind == "form" for item in items)


@pytest.mark.parametrize(
    ("goal", "requirements"),
    [
        ("不使用工具，必须查询文档和知识库", {}),
        ("Do not use tools, retrieve answers from documents and knowledge bases.", {}),
        ("不可以不使用知识库", {}),
        ("You cannot avoid using the knowledge base.", {}),
        ("整理用户文本", {"rules": [{"source": "不使用工具，必须查询文档和知识库"}]}),
        ("不使用知识库A，需要知识库B回答。", {}),
        ("不要生成知识库节点但仍需检索", {}),
        ("Do not use a knowledge base unless retrieval is necessary.", {}),
    ],
)
def test_mixed_or_uncertain_source_cannot_bypass_handler_with_false_model_hint(
    goal: str, requirements: dict[str, object]
) -> None:
    plan = WorkflowPlan("Text summary", "Input", "Summary", ["Use the selected model"], used_resource_ids=[MODEL])
    context = DifyBuilderContext(
        goal_text=goal,
        requirements=requirements,
        resource_selection={"knowledge_source_unavailable": False, "knowledge_requires_clarification": False},
    )
    result, stored, _, _ = confirm(ReconciliationAgent(plan), offered=[], ids=[MODEL], context=context)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert stored.resource_selection["knowledge_decision_pending"]["original_goal"] == goal
    assert not stored.checkpoint_id


def decision_dialog(*, selected: bool = False) -> tuple[Runner, InMemoryRepository, str, ReconciliationAgent]:
    native = WorkflowPlan(
        "Question formatter",
        "User text",
        "Formatted text",
        ["start accepts text", "template-transform formats text", "end returns output"],
        used_resource_ids=[],
    )

    class DialogAgent(ReconciliationAgent):
        @override
        def reconcile_resource_plan(
            self,
            plan: WorkflowPlan,
            resource_ids: list[str],
            *,
            goal_text: str,
            requirements: dict[str, object],
            reply_language: str | None = None,
        ) -> WorkflowPlan | None:
            if KNOWLEDGE in resource_ids:
                self.requests.append({"resource_ids": resource_ids})
                return replace(plan, used_resource_ids=[], discovery_resource_ids=[KNOWLEDGE])
            return super().reconcile_resource_plan(
                plan, resource_ids, goal_text=goal_text, requirements=requirements, reply_language=reply_language
            )

        @override
        def propose_plan_v1(
            self, requirements: dict[str, object], *, goal_text: str, reply_language: str | None = None
        ) -> WorkflowPlan:
            self.requests.append({"requirements": requirements, "goal_text": goal_text})
            return native

        @override
        def discover_resources(self, *_args: object, **_kwargs: object) -> list[ResourceOption]:
            return []

        @override
        def assess_capability_gap(self, *_args: object, **_kwargs: object) -> str:
            return ""

    agent = DialogAgent(native)
    repo = InMemoryRepository()
    session = Session(
        app_id="app",
        owner_account_id="actor",
        tenant_id="tenant",
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_RESOURCE_RECOMMENDATION,
    )
    repo.create_session(
        session,
        DifyBuilderContext(
            goal_text="Knowledge may be omitted only if I explicitly change the goal",
            requirements={"language": "Chinese"},
            resource_selection={"offered_knowledge_ids": [KNOWLEDGE]},
        ),
        [],
    )
    runner = Runner(Env(agent=agent, repo=repo, dify=FakeDifyPort(), now=lambda: datetime.min), build_registry())
    runner.advance(
        session.id,
        Turn(
            actor=Actor(account_id="actor", tenant_id="tenant"),
            action=Action(
                kind="confirm_resources", payload={"resource_ids": [KNOWLEDGE] if selected else []}, base_version=1
            ),
        ),
    )
    return runner, repo, session.id, agent


def answer_decision(
    runner: Runner, repo: InMemoryRepository, sid: str, *, option: int, forged: bool = False
) -> Session:
    session, context = repo.get_session(sid)
    field = context.form_fields[0]
    key = "old-card" if forged else field["key"]
    return runner.advance(
        sid,
        Turn(
            actor=Actor(account_id="actor", tenant_id="tenant"),
            action=Action(
                kind="submit_requirements", payload={key: field["options"][option]}, base_version=session.version
            ),
        ),
    )


def test_selected_knowledge_opens_goal_decision_instead_of_repeating_resource_confirmation() -> None:
    from core.dify_builder.errors import BadRequestError
    from services.dify_builder.service import DifyBuilderService, _actions_for
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    runner, repo, sid, agent = decision_dialog(selected=True)
    session, context = repo.get_session(sid)
    assert session.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert context.resource_selection["knowledge_preferences"] == [KNOWLEDGE]
    assert context.resource_selection["knowledge_decision_pending"]["original_goal"] == context.goal_text
    assert [action.id for action in _actions_for(session.current_state, context)] == ["submit_requirements"]
    conversation = repo.list_conversation(sid)
    requests = list(agent.requests)
    service = DifyBuilderService(repo, FakeSessionLock(), lambda *_a: None)
    with pytest.raises(BadRequestError, match="not allowed in state"):
        service._prepare_action(
            sid,
            Actor(account_id="actor", tenant_id="tenant"),
            Action(kind="confirm_resources", payload={"resource_ids": [KNOWLEDGE]}, base_version=session.version),
        )
    runner.advance(
        sid,
        Turn(
            actor=Actor(account_id="actor", tenant_id="tenant"),
            action=Action(
                kind="confirm_resources", payload={"resource_ids": [KNOWLEDGE]}, base_version=session.version
            ),
        ),
    )
    assert repo.get_session(sid)[0].current_state == PcState.BUILD_GOAL_ANALYSIS
    assert repo.list_conversation(sid) == conversation
    assert agent.requests == requests
    assert not context.checkpoint_id


@pytest.mark.parametrize("selected", [False, True])
def test_refusing_goal_change_keeps_current_actionable_form_and_does_not_repeat_wait_message(selected: bool) -> None:
    from services.dify_builder.service import DifyBuilderService, _internal_action_allowed
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    runner, repo, sid, agent = decision_dialog(selected=selected)
    requests = list(agent.requests)
    key = repo.get_session(sid)[1].form_fields[0]["key"]
    result = answer_decision(runner, repo, sid, option=0)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    _, context = repo.get_session(sid)
    assert context.resource_selection["knowledge_scope_decision"]["choice"] == "retain"
    assert context.resource_selection["knowledge_decision_pending"]["card_key"] == key
    assert context.form_fields[0]["key"] == key
    service = DifyBuilderService(repo, FakeSessionLock(), lambda *_a: None)
    view = service._build_session_view(result, context)
    assert [action.id for action in view.actions] == ["submit_requirements"]
    assert view.active_interaction is not None
    assert view.active_interaction.action_id == "submit_requirements"
    assert view.active_interaction.valid_at_version == result.version
    assert view.active_interaction.card.payload["fields"][0]["key"] == key
    # Retention is an accepted choice, not the original unanswered question.
    assert view.active_interaction.card.payload["values"] == {key: context.form_fields[0]["options"][0]}
    assert len([item for item in repo.list_conversation(sid) if item.kind == "form"]) == 2
    assert _internal_action_allowed(result.current_state, context, "message")
    assert _internal_action_allowed(result.current_state, context, "stop")
    conversation = repo.list_conversation(sid)
    action = Action(
        kind="submit_requirements",
        payload={key: context.form_fields[0]["options"][0]},
        base_version=result.version,
    )
    service._prepare_action(sid, Actor(account_id="actor", tenant_id="tenant"), action)
    repeated = runner.advance(sid, Turn(actor=Actor(account_id="actor", tenant_id="tenant"), action=action))
    repeated_items = repo.list_conversation(sid)
    assert repeated_items[:-1] == conversation
    assert repeated_items[-1].kind == "interaction_response"
    assert repeated.version == result.version + 1
    _, repeated_context = repo.get_session(sid)
    repeated_view = service._build_session_view(repeated, repeated_context)
    assert repeated_view.active_interaction is not None
    assert repeated_view.active_interaction.valid_at_version == repeated.version
    assert repeated_view.active_interaction.card.seq == view.active_interaction.card.seq
    assert not context.checkpoint_id
    assert agent.requests == requests


@pytest.mark.parametrize("logical_task_id", ["", "stable-knowledge-task"])
@pytest.mark.parametrize("legacy", [False, True])
def test_retained_goal_stays_adjustable_after_sql_stop_resume(
    monkeypatch: pytest.MonkeyPatch,
    service: "DifyBuilderService",
    repo: "SqlDifyBuilderRepository",
    enqueued: list["Enqueued"],
    logical_task_id: str,
    legacy: bool,
) -> None:
    from sqlalchemy import func, select

    from core.dify_builder.models import Graph
    from models.dify_builder import DifyBuilderRun
    from runtime_contracts.builder.execution import canonical_digest
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent
    from services.dify_builder.dify_port import WorkflowServiceDifyPort
    from services.dify_builder.task_control_service import claim_continuation, refresh_continuation
    from tests.unit_tests.services.dify_builder.test_service import ACCOUNT_ID, APP_ID, TENANT_ID, _actor

    reads: list[tuple[str, str | None]] = []
    resolutions: list[str] = []
    model_calls: list[dict[str, object]] = []

    def catalog(
        tenant_id: str, *, account_id: str | None = None, selected_agent_ids: frozenset[str] = frozenset()
    ) -> resources.TenantResources:
        assert selected_agent_ids == frozenset()
        reads.append((tenant_id, account_id))
        return inventory()

    def resolve() -> object:
        resolutions.append("model")
        return object()

    def invoke(_model: object, **kwargs: object) -> dict[str, object]:
        model_calls.append(kwargs)
        return {"resource_ids": []}

    monkeypatch.setattr(resources, "list_tenant_resources", catalog)
    monkeypatch.setattr(build.llm, "invoke_json", invoke)
    monkeypatch.setattr(build, "assess_capability_gap", lambda *_a, **_k: "")
    agent = LlmBuilderAgent(TENANT_ID, account_id=ACCOUNT_ID, model_resolver_fn=resolve)
    session = Session(
        app_id=APP_ID,
        owner_account_id=ACCOUNT_ID,
        tenant_id=TENANT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_RESOURCE_RECOMMENDATION,
    )
    goal = "必须从知识库检索依据后回答"
    repo.create_session(
        session,
        DifyBuilderContext(
            goal_text=goal,
            reply_language="zh-Hans",
            logical_task_id=logical_task_id,
            task_status="active",
            resource_selection={"offered_knowledge_ids": [KNOWLEDGE]},
        ),
        [],
    )
    dify = FakeDifyPort()

    def refuse_effect(*_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("A knowledge waiting/adjustment gate cannot execute a workflow effect")

    for operation in ("run_draft", "apply_repair", "publish", "restore_graph"):
        monkeypatch.setattr(dify, operation, refuse_effect)
    runner = Runner(Env(agent=agent, repo=repo, dify=dify, now=lambda: datetime.min), build_registry())

    def submit(kind: str, payload: dict[str, object]) -> Session:
        current, _ = repo.get_session(session.id)
        action = Action(kind=kind, payload=payload, base_version=current.version)
        service._prepare_action(session.id, _actor(), action)
        return runner.advance(session.id, Turn(actor=_actor(), action=action))

    submit("confirm_resources", {"resource_ids": [KNOWLEDGE]})
    field = repo.get_session(session.id)[1].form_fields[0]
    key, options = field["key"], field["options"]
    retained = submit("submit_requirements", {key: options[0]})
    _, context = repo.get_session(session.id)
    if legacy:
        # Persist the pre-fix context shape, then use the real Resume owner.
        for name in ("knowledge_decision_pending", "knowledge_scope_decision"):
            context.resource_selection[name].pop("scope_kind")
            context.resource_selection[name]["scope_digest"] = canonical_digest({"goal": goal, "generation": 0})
        repo.compare_and_advance(session.id, retained.version, retained.current_state, context, [])
        retained, context = repo.get_session(session.id)
    decision = dict(context.resource_selection["knowledge_scope_decision"])
    waiting = service._build_session_view(retained, context).active_interaction
    assert waiting is not None
    conversation = repo.list_conversation(session.id)
    # A GET/refresh reads the same accepted card without rediscovery/cognition.
    assert service.get_session_view(session.id, _actor()).active_interaction == waiting
    assert repo.list_conversation(session.id) == conversation
    service._read_task_dsl_fn = lambda *_: (Graph(graph=Graph(nodes=[], edges=[])), "waiting-revision")
    stopped = service.stop_task(session.id, _actor(), base_version=retained.version, client_action_id="knowledge-stop")
    service.resume_task(session.id, _actor(), base_version=stopped.version, client_action_id="knowledge-resume")
    continuation = enqueued[-1][1]
    claim_continuation(repo, session.id, _actor(), continuation)
    continuation_port = WorkflowServiceDifyPort()
    monkeypatch.setattr(continuation_port, "read_task_dsl", service._read_task_dsl_fn)
    refresh_continuation(repo, continuation_port, session.id, _actor(), continuation)
    runner.advance(session.id, Turn(actor=_actor(), action=continuation))
    resumed, context = repo.get_session(session.id)
    assert context.task_control["generation"] == 1
    assert context.logical_task_id == logical_task_id
    assert context.goal_text == goal
    assert context.resource_selection["knowledge_preferences"] == [KNOWLEDGE]
    assert context.resource_selection["knowledge_scope_decision"] == decision
    resumed_view = service._build_session_view(resumed, context)
    assert resumed_view.active_interaction is not None
    assert resumed_view.active_interaction.card == waiting.card
    assert resumed_view.active_interaction.valid_at_version == resumed.version
    if legacy:
        restoration = submit("submit_requirements", {key: options[1]})
        _, context = repo.get_session(session.id)
        assert restoration.current_state == PcState.BUILD_GOAL_ANALYSIS
        assert context.goal_text == goal
        assert context.resource_selection["knowledge_scope_decision"] == decision
        fresh = context.form_fields[0]
        assert fresh["key"] != key
        key, options = fresh["key"], fresh["options"]
        submit("submit_requirements", {key: options[0]})
        conversation = repo.list_conversation(session.id)
    repeated = submit("submit_requirements", {key: options[0]})
    assert [item for item in repo.list_conversation(session.id) if item.kind in {"form", "assistant_turn"}] == [
        item for item in conversation if item.kind in {"form", "assistant_turn"}
    ]
    assert repeated.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert (reads, resolutions, model_calls) == ([(TENANT_ID, ACCOUNT_ID)], [], [])
    assert context.task_status == "active"
    assert not context.checkpoint_id
    assert not context.verify_run_id
    assert not context.built_node_ids
    assert dify.applied == []
    assert dify.run_draft_inputs == {}
    assert not dify.published
    with repo._session_factory() as sql:
        assert sql.scalar(select(func.count()).select_from(DifyBuilderRun)) == 0

    plan_calls: list[dict[str, object]] = []

    def revised_plan(requirements: dict[str, object], **_kwargs: object) -> WorkflowPlan:
        plan_calls.append(requirements)
        return WorkflowPlan("Format text", "Text", "Formatted text", ["Format the supplied text"])

    monkeypatch.setattr(agent, "propose_plan_v1", revised_plan)
    adjusted = submit("submit_requirements", {key: options[1]})
    _, context = repo.get_session(session.id)
    assert adjusted.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert context.resource_selection["knowledge_scope_decision"]["choice"] == "waive"
    assert context.resource_selection["knowledge_scope_decision"]["original_goal"] == goal
    assert context.goal_text.startswith(goal)
    assert context.goal_text != goal
    assert len(plan_calls) == 1
    assert len(reads) == 2
    assert len(resolutions) == len(model_calls) == 1


@pytest.mark.parametrize("selected", [False, True])
@pytest.mark.parametrize("retain_first", [False, True])
def test_explicit_goal_change_is_traceable_and_allows_no_knowledge_plan(selected: bool, retain_first: bool) -> None:
    runner, repo, sid, agent = decision_dialog(selected=selected)
    original = repo.get_session(sid)[1].goal_text
    if retain_first:
        answer_decision(runner, repo, sid, option=0)
    result = answer_decision(runner, repo, sid, option=1)
    assert result.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    _, context = repo.get_session(sid)
    decision = context.resource_selection["knowledge_scope_decision"]
    assert decision["choice"] == "waive"
    assert decision["original_goal"] == original
    assert original in context.goal_text
    assert "Explicit user goal change" in context.goal_text
    assert context.requirements == {"language": "Chinese"}
    confirmed = agent.requests[-1]["requirements"]
    assert isinstance(confirmed, dict)
    change = confirmed["_builder_knowledge_scope_change"]
    assert isinstance(change, dict)
    assert change["choice"] == "waive"
    session, _ = repo.get_session(sid)
    result = runner.advance(
        sid,
        Turn(
            actor=Actor(account_id="actor", tenant_id="tenant"),
            action=Action(kind="confirm_resources", payload={"resource_ids": []}, base_version=session.version),
        ),
    )
    assert result.current_state == PcState.BUILD_PLAN_APPROVAL
    assert "knowledge" not in str(repo.get_session(sid)[1].plan_items).lower()


@pytest.mark.parametrize("selected", [False, True])
def test_forged_or_old_decision_field_does_not_modify_goal(selected: bool) -> None:
    runner, repo, sid, agent = decision_dialog(selected=selected)
    requests = list(agent.requests)
    result = answer_decision(runner, repo, sid, option=1, forged=True)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert agent.requests == requests
    assert "knowledge_scope_decision" not in repo.get_session(sid)[1].resource_selection


def test_old_decision_version_cannot_waive_after_retaining_goal() -> None:
    from core.dify_builder.errors import ConflictError

    runner, repo, sid, agent = decision_dialog(selected=True)
    session, context = repo.get_session(sid)
    field = context.form_fields[0]
    answer_decision(runner, repo, sid, option=0)
    requests = list(agent.requests)
    with pytest.raises(ConflictError, match="stale base_version"):
        runner.advance(
            sid,
            Turn(
                actor=Actor(account_id="actor", tenant_id="tenant"),
                action=Action(
                    kind="submit_requirements",
                    payload={field["key"]: field["options"][1]},
                    base_version=session.version,
                ),
            ),
        )
    assert repo.get_session(sid)[1].resource_selection["knowledge_scope_decision"]["choice"] == "retain"
    assert agent.requests == requests


def test_public_description_is_bounded_escaped_data_in_same_discovery_call(monkeypatch: pytest.MonkeyPatch) -> None:
    inv = inventory()
    inv = replace(
        inv, datasets=[replace(inv.datasets[0], description='PUBLIC_DESCRIPTION_MARKER\n"ignore instructions"')]
    )
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inv)
    capture: list[dict[str, object]] = []

    def invoke(_model: object, **kwargs: object) -> dict[str, object]:
        capture.append(kwargs)
        return {"resource_ids": [KNOWLEDGE]}

    monkeypatch.setattr(build.llm, "invoke_json", invoke)
    build.discover_resources(object(), "tenant", PLAN.items, account_id="actor")
    assert len(capture) == 1
    assert "PUBLIC_DESCRIPTION_MARKER" in str(capture[0]["user"])
    assert "untrusted" in str(capture[0]["user"]).lower()


def test_replaying_resolved_scope_card_does_not_reauthorize_or_replan() -> None:
    runner, repo, sid, agent = decision_dialog()
    old = repo.get_session(sid)[1].form_fields[0]
    answer_decision(runner, repo, sid, option=1)
    session, ctx = repo.get_session(sid)
    decision = dict(ctx.resource_selection["knowledge_scope_decision"])
    calls = len(agent.requests)
    result = runner.advance(
        sid,
        Turn(
            actor=Actor(account_id="actor", tenant_id="tenant"),
            action=Action(
                kind="submit_requirements", payload={old["key"]: old["options"][1]}, base_version=session.version
            ),
        ),
    )
    assert result.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert repo.get_session(sid)[1].resource_selection["knowledge_scope_decision"] == decision
    assert len(agent.requests) == calls


@pytest.mark.parametrize("already_retained", [False, True])
@pytest.mark.parametrize("resumed", [False, True])
def test_legacy_goal_form_requires_its_original_generation_before_task_scope_upgrade(
    already_retained: bool, resumed: bool
) -> None:
    from runtime_contracts.builder.execution import canonical_digest

    runner, repo, sid, agent = decision_dialog()
    session, context = repo.get_session(sid)
    pending = context.resource_selection["knowledge_decision_pending"]
    pending.pop("scope_kind", None)
    pending["scope_digest"] = canonical_digest({"goal": context.goal_text, "generation": 0})
    if already_retained:
        context.resource_selection["knowledge_scope_decision"] = {**pending, "choice": "retain"}
    if resumed:
        context.task_control["generation"] = 1
    previous = dict(context.resource_selection)
    repo.compare_and_advance(sid, session.version, session.current_state, context, [])
    conversation = repo.list_conversation(sid)
    result = answer_decision(runner, repo, sid, option=1 if resumed else 0)
    _, stored = repo.get_session(sid)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert stored.goal_text == context.goal_text
    assert agent.requests == []
    if resumed:
        # Restore a new gate; the submitted old choice grants no authority.
        fresh = stored.resource_selection["knowledge_decision_pending"]
        assert fresh["card_key"] != pending["card_key"]
        assert fresh["scope_kind"] == "logical_task"
        assert stored.resource_selection.get("knowledge_scope_decision") == previous.get("knowledge_scope_decision")
        restored = repo.list_conversation(sid)
        assert (
            len([item for item in restored if item.kind == "form"])
            == len([item for item in conversation if item.kind == "form"]) + 1
        )
        # An old option cannot submit the new current card or cause another restore.
        runner.advance(
            sid,
            Turn(
                actor=Actor(account_id="actor", tenant_id="tenant"),
                action=Action(
                    kind="submit_requirements",
                    payload={pending["card_key"]: pending["options"][1]},
                    base_version=result.version,
                ),
            ),
        )
        assert repo.list_conversation(sid) == restored
        assert repo.get_session(sid)[1].goal_text == context.goal_text
        answer_decision(runner, repo, sid, option=0)
        waiting = repo.list_conversation(sid)
        answer_decision(runner, repo, sid, option=0)
        assert repo.list_conversation(sid) == waiting
        assert agent.requests == []
        adjusted = answer_decision(runner, repo, sid, option=1)
        assert adjusted.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
        assert repo.get_session(sid)[1].resource_selection["knowledge_scope_decision"]["choice"] == "waive"
        assert len(agent.requests) == 1
    else:
        assert stored.resource_selection["knowledge_scope_decision"]["choice"] == "retain"
        assert stored.resource_selection["knowledge_decision_pending"]["scope_kind"] == "logical_task"
        card = repo.list_conversation(sid)[-2]
        assert card.kind == "form"
        assert card.payload["values"] == {pending["card_key"]: pending["options"][0]}
        assert not stored.checkpoint_id
        assert not stored.verify_run_id


@pytest.mark.parametrize("changed", ["goal", "task", "actor", "tenant", "missing_history"])
def test_stale_legacy_form_cannot_restore_for_a_different_goal_task_or_actor(changed: str) -> None:
    from runtime_contracts.builder.execution import canonical_digest

    runner, repo, sid, agent = decision_dialog()
    session, context = repo.get_session(sid)
    pending = context.resource_selection["knowledge_decision_pending"]
    pending.pop("scope_kind", None)
    pending["scope_digest"] = canonical_digest({"goal": context.goal_text, "generation": 0})
    context.task_control["generation"] = 1
    actor = Actor(account_id="actor", tenant_id="tenant")
    if changed == "goal":
        context.goal_text = "A different current goal"
    if changed == "task":
        context.logical_task_id = "another-task"
    if changed == "actor":
        actor = replace(actor, account_id="another-actor")
    if changed == "tenant":
        actor = replace(actor, tenant_id="another-tenant")
    if changed == "missing_history":
        pending["source_version"] = 10000
    version = repo.compare_and_advance(sid, session.version, session.current_state, context, [])
    conversation = repo.list_conversation(sid)
    runner.advance(
        sid,
        Turn(
            actor=actor,
            action=Action(
                kind="submit_requirements",
                payload={pending["card_key"]: pending["options"][1]},
                base_version=version,
            ),
        ),
    )
    assert repo.list_conversation(sid) == conversation
    assert "knowledge_scope_decision" not in repo.get_session(sid)[1].resource_selection
    assert agent.requests == []


@pytest.mark.parametrize("option", [0, 1])
def test_decision_is_rejected_after_goal_task_or_actor_changes(option: int) -> None:
    from services.dify_builder.application.handlers_build import handle_goal_analysis

    runner, repo, sid, agent = decision_dialog()
    del runner
    session, ctx = repo.get_session(sid)
    field = ctx.form_fields[0]
    for changed, actor, tenant in [
        (replace(ctx, goal_text="Different goal"), "actor", "tenant"),
        (replace(ctx, logical_task_id="another-task"), "actor", "tenant"),
        (replace(ctx), "another-actor", "tenant"),
        (replace(ctx), "actor", "another-tenant"),
    ]:
        result = handle_goal_analysis(
            Env(agent=agent, repo=repo, dify=FakeDifyPort(), now=lambda: datetime.min),
            Turn(
                actor=Actor(account_id=actor, tenant_id=tenant),
                action=Action(
                    kind="submit_requirements",
                    payload={field["key"]: field["options"][option]},
                    base_version=session.version,
                ),
            ),
            session,
            changed,
        )
        assert result.next == PcState.BUILD_GOAL_ANALYSIS
        assert "knowledge_scope_decision" not in changed.resource_selection
    assert agent.requests == []


@pytest.mark.parametrize(
    ("goal", "source_error", "model_need", "expected"),
    [
        ("必须使用知识库回答", None, False, PcState.BUILD_GOAL_ANALYSIS),
        ("基于公司的产品文档回答", None, True, PcState.BUILD_GOAL_ANALYSIS),
        ("Answer a question", "inventory_unavailable", False, PcState.BUILD_GOAL_ANALYSIS),
        ("Uppercase the input with native code", None, False, PcState.BUILD_PLAN_APPROVAL),
    ],
)
def test_real_discovery_empty_or_failed_source_cannot_authorize_omission(
    monkeypatch: pytest.MonkeyPatch, goal: str, source_error: str | None, model_need: bool, expected: PcState
) -> None:
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    inv = resources.TenantResources(models=[], datasets=[], tools=[], dataset_source_error=source_error)
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_k: inv)
    monkeypatch.setattr(
        build.llm,
        "invoke_json",
        lambda *_a, **_k: {"resource_ids": [], "knowledge_requires_clarification": model_need},
    )
    monkeypatch.setattr(build, "assess_capability_gap", lambda *_a, **_k: "")
    agent = LlmBuilderAgent("tenant", account_id="actor", model_resolver_fn=lambda: object())
    repo = InMemoryRepository()
    session = Session(app_id="app", entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_INITIAL_PLAN)
    repo.create_session(session, DifyBuilderContext(goal_text=goal, plan_items=["Handle the input"]), [])
    runner = Runner(Env(agent=agent, repo=repo, dify=FakeDifyPort(), now=lambda: datetime.min), build_registry())
    runner.advance(session.id, Turn(actor=Actor(account_id="actor", tenant_id="tenant")))
    current, _ = repo.get_session(session.id)
    result = runner.advance(
        session.id,
        Turn(
            actor=Actor(account_id="actor", tenant_id="tenant"),
            action=Action(kind="confirm_resources", payload={"resource_ids": []}, base_version=current.version),
        ),
    )
    assert result.current_state == expected
    if expected == PcState.BUILD_GOAL_ANALYSIS:
        assert not repo.get_session(session.id)[1].checkpoint_id


@pytest.mark.parametrize(
    ("goal", "requirements"),
    [
        (CAPTURED_AGENT_GOAL, {}),
        ("", CAPTURED_FORBIDDEN_ADDITIONS),
        (CAPTURED_AGENT_GOAL, CAPTURED_FORBIDDEN_ADDITIONS),
    ],
    ids=["goal", "requirements", "both"],
)
def test_excluded_resource_list_reaches_formal_plan_without_a_knowledge_waiver(
    goal: str, requirements: dict[str, object]
) -> None:
    plan = WorkflowPlan("Selected resource", "Input", "Output", ["Use selected resource"], used_resource_ids=[MODEL])
    context = DifyBuilderContext(
        goal_text=goal,
        requirements=requirements,
        resource_selection={"knowledge_source_unavailable": False, "knowledge_requires_clarification": False},
    )
    result, stored, _, items = confirm(ReconciliationAgent(plan), offered=[], ids=[MODEL], context=context)
    assert result.current_state == PcState.BUILD_PLAN_APPROVAL
    assert stored.resource_selection["resource_ids"] == [MODEL]
    assert "knowledge_decision_pending" not in stored.resource_selection
    assert any(item.kind == "plan" for item in items)
    assert not any(item.kind == "form" for item in items)


@pytest.mark.parametrize("guard", ["offered", "knowledge_source_unavailable", "knowledge_requires_clarification"])
def test_excluded_resource_list_never_disables_server_or_model_source_guards(guard: str) -> None:
    plan = WorkflowPlan("Selected resource", "Input", "Output", ["Use selected resource"], used_resource_ids=[MODEL])
    context = DifyBuilderContext(
        goal_text=CAPTURED_AGENT_GOAL,
        requirements=CAPTURED_FORBIDDEN_ADDITIONS,
        resource_selection={guard: True} if guard != "offered" else {"offered_knowledge_ids": [KNOWLEDGE]},
    )
    result, stored, _, _ = confirm(
        ReconciliationAgent(plan), offered=[KNOWLEDGE] if guard == "offered" else [], ids=[MODEL], context=context
    )
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert "knowledge_decision_pending" in stored.resource_selection
    assert not stored.checkpoint_id


def test_no_extra_components_resource_list_reaches_plan_without_changing_the_original_goal() -> None:
    plan = WorkflowPlan("Selected resource", "Input", "Output", ["Use selected resource"], used_resource_ids=[MODEL])
    context = DifyBuilderContext(
        goal_text=CAPTURED_AGENT_GOAL,
        requirements=CAPTURED_NO_EXTRA_COMPONENTS,
        resource_selection={"knowledge_source_unavailable": False, "knowledge_requires_clarification": False},
    )
    result, stored, _, items = confirm(ReconciliationAgent(plan), offered=[], ids=[MODEL], context=context)
    assert result.current_state == PcState.BUILD_PLAN_APPROVAL
    assert stored.goal_text == CAPTURED_AGENT_GOAL
    assert stored.resource_selection["resource_ids"] == [MODEL]
    assert "knowledge_decision_pending" not in stored.resource_selection
    assert any(item.kind == "plan" for item in items)
    assert not any(item.kind == "form" for item in items)


def test_full_captured_bare_resource_exclusion_reaches_plan_without_a_knowledge_waiver() -> None:
    plan = WorkflowPlan("Selected resource", "Input", "Output", ["Use selected resource"], used_resource_ids=[MODEL])
    context = DifyBuilderContext(
        goal_text=CAPTURED_AGENT_GOAL,
        requirements=CAPTURED_BARE_ROLE_REQUIREMENTS,
        resource_selection={"knowledge_source_unavailable": False, "knowledge_requires_clarification": False},
    )
    result, stored, _, items = confirm(ReconciliationAgent(plan), offered=[], ids=[MODEL], context=context)
    assert result.current_state == PcState.BUILD_PLAN_APPROVAL
    assert stored.goal_text == CAPTURED_AGENT_GOAL
    assert stored.resource_selection["resource_ids"] == [MODEL]
    assert "knowledge_decision_pending" not in stored.resource_selection
    assert any(item.kind == "plan" for item in items)
    assert not any(item.kind == "form" for item in items)


def test_captured_meeting_model_only_confirmation_preserves_goal_without_a_knowledge_waiver() -> None:
    plan = WorkflowPlan("Meeting minutes", "Input", "Output", ["Use the selected model"], used_resource_ids=[MODEL])
    context = DifyBuilderContext(
        goal_text=CAPTURED_MEETING_GOAL,
        requirements=CAPTURED_MEETING_REQUIREMENTS,
        resource_selection={"knowledge_source_unavailable": False, "knowledge_requires_clarification": False},
    )
    result, stored, _, items = confirm(ReconciliationAgent(plan), offered=[], ids=[MODEL], context=context)
    assert result.current_state == PcState.BUILD_PLAN_APPROVAL
    assert stored.goal_text == CAPTURED_MEETING_GOAL
    assert stored.requirements == CAPTURED_MEETING_REQUIREMENTS
    assert stored.resource_selection["resource_ids"] == [MODEL]
    assert "knowledge_decision_pending" not in stored.resource_selection
    assert "knowledge_scope_decision" not in stored.resource_selection
    assert any(item.kind == "plan" for item in items)
    assert not any(item.kind == "form" for item in items)


@pytest.mark.parametrize("prefix", ["不使用工具、", "不需要任何新资源、工具、"])
@pytest.mark.parametrize("suffix", ["仍需检索", "访问尚未决定", "不一定不用"])
def test_nonbare_knowledge_item_keeps_handler_clarification_with_false_model_hint(prefix: str, suffix: str) -> None:
    goal = prefix + "知识库" + suffix
    plan = WorkflowPlan("Text summary", "Input", "Summary", ["Use the selected model"], used_resource_ids=[MODEL])
    context = DifyBuilderContext(
        goal_text=goal,
        requirements=CAPTURED_MEETING_REQUIREMENTS,
        resource_selection={"knowledge_source_unavailable": False, "knowledge_requires_clarification": False},
    )
    result, stored, _, _ = confirm(ReconciliationAgent(plan), offered=[], ids=[MODEL], context=context)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert stored.resource_selection["knowledge_decision_pending"]["original_goal"] == goal
    assert not stored.checkpoint_id


@pytest.mark.parametrize(
    "goal",
    [
        "不需要新资源，知识库和文件仍需检索。",
        "不需要新资源，知识库、文件仍需检索。",
        "不需要新资源，知识库，文件仍需检索。",
        "Do not use new resources, knowledge bases and files are still required.",
        "不需要新资源，知识库和财务系统是否使用待确认。",
    ],
)
def test_shared_source_predicate_keeps_handler_clarification_with_false_model_hint(goal: str) -> None:
    plan = WorkflowPlan("Text summary", "Input", "Summary", ["Use the selected model"], used_resource_ids=[MODEL])
    context = DifyBuilderContext(
        goal_text=goal,
        requirements=CAPTURED_MEETING_REQUIREMENTS,
        resource_selection={"knowledge_source_unavailable": False, "knowledge_requires_clarification": False},
    )
    result, stored, _, _ = confirm(ReconciliationAgent(plan), offered=[], ids=[MODEL], context=context)
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert stored.resource_selection["knowledge_decision_pending"]["original_goal"] == goal
    assert not stored.checkpoint_id


def test_explicit_knowledge_waiver_can_clarify_business_rules_before_replanning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services.dify_builder.plan import BuildClarification

    runner, repo, sid, agent = decision_dialog()
    question = BuildClarification(
        fields=[
            {
                "key": "empty_text",
                "label": "Empty text",
                "type": "select",
                "options": ["Reject", "Skip"],
                "required": True,
            }
        ],
        values={"empty_text": "Reject"},
    )
    monkeypatch.setattr(agent, "propose_plan_v1", lambda *_a, **_kw: question)
    answered = answer_decision(runner, repo, sid, option=1)
    _, context = repo.get_session(sid)

    assert answered.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert context.form_fields == question.fields
    assert context.requirements == {"language": "Chinese", "empty_text": "Reject"}
    assert "Explicit user goal change" in context.goal_text
    assert context.resource_selection["knowledge_scope_decision"]["choice"] == "waive"
    assert "knowledge_decision_pending" not in context.resource_selection
    assert not context.checkpoint_id
    assert context.built_node_ids == []


def knowledge_preflight_dialog(
    monkeypatch: pytest.MonkeyPatch, entry: str, *, submit: bool = True
) -> tuple[Runner, InMemoryRepository, str, list[dict[str, object]], list[tuple[str, str | None]]]:
    """Replay the captured pre-discovery retain answer with real resource boundaries."""
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    goal = (
        "Discover my permitted knowledge base QA1386-product-docs-empty-1030 as a preference. "
        "Must retrieve from that knowledge base before answering with source citations; retain the goal if unsupported."
        if entry != "excluded"
        else "Do not use a knowledge base; format the supplied text."
    )
    retain = "等待（保留检索该知识库的业务目标，暂不构建）"
    values = (
        {
            "selected_knowledge_base": "QA1386-product-docs-empty-1030",
            "fallback_when_retrieval_unavailable": retain,
            "input_field": "question",
            "must_retrieve_before_answer": True,
            "require_source_citation": True,
        }
        if entry != "excluded"
        else {}
    )
    fields = (
        [
            {
                "key": "selected_knowledge_base",
                "label": "请选择本次使用的知识库",
                "type": "select",
                "options": ["QA1386-product-docs-empty-1030"],
                "required": True,
            },
            {
                "key": "fallback_when_retrieval_unavailable",
                "label": "若本期无法完成知识库检索，您希望如何处理",
                "type": "select",
                "options": [retain, "修改目标"],
                "required": True,
            },
        ]
        if entry == "captured_retain"
        else [
            {
                "key": "language",
                "label": "Answer language",
                "type": "select",
                "options": ["Chinese", "English"],
                "required": True,
            }
        ]
        if entry == "business_answer"
        else []
    )
    if entry == "business_answer":
        values["language"] = "Chinese"
    plan_requests: list[dict[str, object]] = []
    catalogue_calls: list[tuple[str, str | None]] = []
    native = WorkflowPlan(
        "Text formatter", "Question text", "Formatted text", ["start accepts question", "end returns it"]
    )

    def analyze_goal(goal_text: str, *, reply_language: str | None = None) -> dict[str, object]:
        assert goal_text == goal
        del reply_language
        return {"fields": fields, "values": values}

    def propose_plan_v1(
        requirements: dict[str, object], *, goal_text: str, reply_language: str | None = None
    ) -> WorkflowPlan | BuildClarification | None:
        del reply_language
        plan_requests.append({"requirements": requirements, "goal_text": goal_text})
        if entry == "excluded" or "empty_text" in requirements:
            return native
        if "_builder_knowledge_scope_change" in requirements:
            return BuildClarification(
                fields=[
                    {
                        "key": "empty_text",
                        "label": "Empty question",
                        "type": "select",
                        "options": ["Reject", "Skip"],
                        "required": True,
                    }
                ],
                values={"empty_text": "Reject"},
            )
        # The observed model response asks the already-confirmed stage
        # boundary again under a new key, rather than reaching discovery.
        return BuildClarification(
            fields=[
                {
                    "key": "confirm_wait_or_modify",
                    "label": "本期无法构建知识检索节点，您希望如何处理？",
                    "type": "select",
                    "options": ["等待", "修改目标"],
                    "required": True,
                }
            ],
            values={"confirm_wait_or_modify": "等待"},
        )

    def assess_capability_gap(*_args: object, **_kwargs: object) -> str:
        return "Knowledge discovery only; retrieval is unavailable."

    def load_inventory(
        tenant_id: str, *, account_id: str | None = None, **_kwargs: object
    ) -> resources.TenantResources:
        catalogue_calls.append((tenant_id, account_id))
        return inventory()

    monkeypatch.setattr(resources, "list_tenant_resources", load_inventory)
    monkeypatch.setattr(
        build.llm,
        "invoke_json",
        lambda *_a, **_kw: {
            "resource_ids": [] if entry == "excluded" else [KNOWLEDGE],
            "selection_reasons": {KNOWLEDGE: "Required discovery preference only."},
        },
    )
    repo = InMemoryRepository()
    session = Session(app_id="app", entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_CAPABILITY_CHECK)
    repo.create_session(session, DifyBuilderContext(goal_text=goal), [])
    agent = LlmBuilderAgent("tenant", account_id="actor", model_resolver_fn=lambda: object())
    monkeypatch.setattr(agent, "analyze_goal", analyze_goal)
    monkeypatch.setattr(agent, "propose_plan_v1", propose_plan_v1)
    monkeypatch.setattr(agent, "assess_capability_gap", assess_capability_gap)
    runner = Runner(Env(agent=agent, repo=repo, dify=FakeDifyPort(), now=lambda: datetime.min), build_registry())
    current = runner.advance(session.id, Turn(actor=Actor(account_id="actor", tenant_id="tenant")))
    if fields and submit:
        payload: dict[str, object] = {}
        for spec in fields:
            key = spec["key"]
            assert isinstance(key, str)
            payload[key] = values[key]
        if entry == "business_answer":
            payload["language"] = "English"
        runner.advance(
            session.id,
            Turn(
                actor=Actor(account_id="actor", tenant_id="tenant"),
                action=Action(kind="submit_requirements", payload=payload, base_version=current.version),
            ),
        )
    return runner, repo, session.id, plan_requests, catalogue_calls


@pytest.mark.parametrize("entry", ["no_form", "captured_retain", "business_answer"])
def test_required_knowledge_reaches_actor_scoped_discovery_before_executable_planning(
    monkeypatch: pytest.MonkeyPatch, entry: str
) -> None:
    _, repo, sid, plans, catalogue = knowledge_preflight_dialog(monkeypatch, entry)
    session, context = repo.get_session(sid)
    assert session.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert plans == []
    assert catalogue == [("tenant", "actor")]
    assert "Must retrieve from that knowledge base" in context.goal_text
    assert context.resource_selection["offered_knowledge_ids"] == [KNOWLEDGE]
    assert context.plan_items == []
    assert not context.checkpoint_id
    assert context.built_node_ids == []
    assert not any(item.kind == "plan" for item in repo.list_conversation(sid))
    if entry == "captured_retain":
        assert (
            context.requirements["fallback_when_retrieval_unavailable"]
            == "等待（保留检索该知识库的业务目标，暂不构建）"
        )
        assert context.confirmed_requirement_keys == ["selected_knowledge_base", "fallback_when_retrieval_unavailable"]
    if entry == "business_answer":
        assert context.requirements["language"] == "English"
        assert context.confirmed_requirement_keys == ["language"]


def test_required_business_answer_is_not_skipped_by_knowledge_discovery(monkeypatch: pytest.MonkeyPatch) -> None:
    runner, repo, sid, plans, catalogue = knowledge_preflight_dialog(monkeypatch, "business_answer", submit=False)
    current, _ = repo.get_session(sid)
    result = runner.advance(
        sid,
        Turn(
            actor=Actor(account_id="actor", tenant_id="tenant"),
            action=Action(kind="submit_requirements", payload={}, base_version=current.version),
        ),
    )
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert repo.get_session(sid)[1].confirmed_requirement_keys == []
    assert catalogue == plans == []


def test_excluded_knowledge_goal_keeps_normal_executable_planning(monkeypatch: pytest.MonkeyPatch) -> None:
    _, repo, sid, plans, catalogue = knowledge_preflight_dialog(monkeypatch, "excluded")
    assert repo.get_session(sid)[0].current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert len(plans) == 1
    assert catalogue == [("tenant", "actor")]
    assert repo.get_session(sid)[1].plan_items == ["start accepts question", "end returns it"]


def test_preflight_knowledge_selection_waits_until_waiver_then_preserves_business_clarification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, repo, sid, plans, catalogue = knowledge_preflight_dialog(monkeypatch, "captured_retain")
    current, context = repo.get_session(sid)
    assert current.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    original = context.goal_text
    result = runner.advance(
        sid,
        Turn(
            actor=Actor(account_id="actor", tenant_id="tenant"),
            action=Action(
                kind="confirm_resources", payload={"resource_ids": [KNOWLEDGE]}, base_version=current.version
            ),
        ),
    )
    assert result.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert repo.get_session(sid)[1].resource_selection["knowledge_preferences"] == [KNOWLEDGE]
    answer_decision(runner, repo, sid, option=0)
    answer_decision(runner, repo, sid, option=0)
    assert plans == []
    assert catalogue == [("tenant", "actor"), ("tenant", "actor")]
    answer_decision(runner, repo, sid, option=1)
    current, context = repo.get_session(sid)
    assert current.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert context.form_fields[0]["key"] == "empty_text"
    assert context.requirements["selected_knowledge_base"] == "QA1386-product-docs-empty-1030"
    assert context.resource_selection["knowledge_scope_decision"]["original_goal"] == original
    assert len(plans) == 1
    confirmed = plans[0]["requirements"]
    assert isinstance(confirmed, dict)
    change = confirmed["_builder_knowledge_scope_change"]
    assert isinstance(change, dict)
    assert change["choice"] == "waive"
    assert not context.checkpoint_id
    result = runner.advance(
        sid,
        Turn(
            actor=Actor(account_id="actor", tenant_id="tenant"),
            action=Action(kind="submit_requirements", payload={"empty_text": "Skip"}, base_version=current.version),
        ),
    )
    assert result.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert len(plans) == 2
    replanned = plans[1]["requirements"]
    assert isinstance(replanned, dict)
    assert replanned["empty_text"] == "Skip"
    assert repo.get_session(sid)[1].confirmed_requirement_keys == [
        "selected_knowledge_base",
        "fallback_when_retrieval_unavailable",
        "empty_text",
    ]
