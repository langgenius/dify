"""A confirmed resource must reconcile an abstract plan before plan approval.

Regression from ENG-1376: abstract planning precedes resource search. Discovery
can find a callable Agent after the abstract planner guessed none existed.
Appending its identity to the old fallback does not make that plan consistent.
These handler tests use a generic ticket-classifier Agent, no business runtime.
"""

from dataclasses import replace
from datetime import datetime
from typing import override

import pytest

from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.state import PcState
from services.dify_builder.application.handlers_build import build_registry
from services.dify_builder.application.runner import Env, Runner
from services.dify_builder.plan import WorkflowPlan
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent

SELECTED = "agent:published-classifier:snapshot-v3:" + "a" * 64
GOAL = "Classify supplied tickets using an existing published Agent; preserve ticket_text input and category output."
REQUIREMENTS = {"no_agent_fallback": "Stop with an unavailable explanation", "no_external_accounts": True}
ABSTRACT = WorkflowPlan(
    title="Ticket classification unavailable",
    input_summary="Required ticket_text.",
    output_summary="Unavailable explanation.",
    items=[
        "Start accepts ticket_text.",
        "No eligible Agent was provided; Template returns unavailable.",
        "End returns explanation.",
    ],
)
BOUND = WorkflowPlan(
    title="Classify tickets with an existing Agent",
    input_summary="Required ticket_text.",
    output_summary="category from the Agent node-job declaration.",
    items=[
        "Start accepts ticket_text.",
        (
            f"New Agent v2 classifies ticket_text using {SELECTED}; published v3; reference eligible; "
            "runtime authorization unverified; no external accounts."
        ),
        "End returns category from the Agent node-job output.",
    ],
)


class ReconciliationAgent(StubAgent):
    def __init__(self, replacement: WorkflowPlan | None) -> None:
        super().__init__()
        self.replacement = replacement
        self.requests: list[dict[str, object]] = []

    @override
    def bind_resources(self, plan_items: list[str], resource_ids: list[str]) -> list[str]:
        # Current implementation only decorates old prose; this fixture retains
        # its contradictory meaning, so success cannot follow from an ID suffix.
        return [f"{step} (using {','.join(resource_ids)})" for step in plan_items]

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
        del reply_language
        self.requests.append(
            {"plan": plan, "resource_ids": resource_ids, "goal_text": goal_text, "requirements": requirements}
        )
        return self.replacement


def confirm(
    agent: ReconciliationAgent, selected_ids: list[str] | None = None
) -> tuple[Session, InMemoryRepository, str]:
    repo = InMemoryRepository()
    session = Session(app_id="app", entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_RESOURCE_RECOMMENDATION)
    context = DifyBuilderContext(
        goal_text=GOAL,
        requirements=REQUIREMENTS,
        plan_title=ABSTRACT.title,
        plan_input_summary=ABSTRACT.input_summary,
        plan_output_summary=ABSTRACT.output_summary,
        plan_items=list(ABSTRACT.items),
    )
    repo.create_session(session, context, [])
    runner = Runner(Env(agent=agent, repo=repo, dify=FakeDifyPort(), now=lambda: datetime.min), build_registry())
    result = runner.advance(
        session.id,
        Turn(
            actor=Actor(account_id="account", tenant_id="tenant"),
            action=Action(
                kind="confirm_resources", payload={"resource_ids": selected_ids or [SELECTED]}, base_version=1
            ),
        ),
    )
    return result, repo, session.id


def test_confirmed_resource_reconciles_fallback_and_overview_before_approval() -> None:
    agent = ReconciliationAgent(BOUND)
    result, repo, session_id = confirm(agent)
    assert agent.requests == [
        {"plan": ABSTRACT, "resource_ids": [SELECTED], "goal_text": GOAL, "requirements": REQUIREMENTS}
    ]
    assert result.current_state == PcState.BUILD_PLAN_APPROVAL
    _, context = repo.get_session(session_id)
    assert context.plan_items == BOUND.items
    card = next(item for item in repo.list_conversation(session_id) if item.kind == "plan")
    assert card.payload["title"] == BOUND.title
    assert card.payload["input_summary"] == BOUND.input_summary
    assert card.payload["output_summary"] == BOUND.output_summary
    assert card.payload["items"] == BOUND.items
    assert context.resource_selection == {"resource_ids": [SELECTED]}


@pytest.mark.parametrize("failure", ["model_unavailable", "inventory_unknown", "selected_resource_unavailable"])
def test_unusable_reconciliation_keeps_resource_gate_and_does_not_offer_approval(failure: str) -> None:
    # The cognition/catalog owner returns no usable replacement for each case;
    # handler must not turn that absence into a successful plan or checkpoint.
    agent = ReconciliationAgent(None)
    result, repo, session_id = confirm(agent)
    assert result.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION, failure
    _, context = repo.get_session(session_id)
    assert context.plan_items == ABSTRACT.items
    assert context.plan_title == ABSTRACT.title
    assert not context.checkpoint_id
    conversation = repo.list_conversation(session_id)
    assert not any(item.kind == "plan" for item in conversation)
    assert any(item.kind == "assistant_turn" for item in conversation)


def test_reconciliation_rereads_selected_facts_and_uses_one_model_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    import json

    from services.dify_builder.agent import build, resources

    ref = resources.ResourceRef(
        id=SELECTED,
        label="Published ticket classifier",
        meta="Published version 3; reference eligible; runtime authorization unverified; node-job outputs required.",
    )
    inventory = resources.TenantResources(models=[], datasets=[], tools=[], agents=[ref])
    reads: list[object] = []
    calls: list[dict[str, str]] = []

    def list_selected(tenant_id: str, **kwargs: object) -> resources.TenantResources:
        reads.append((tenant_id, kwargs))
        return inventory

    def invoke(_model: object, *, system: str, user: str, **_kwargs: object) -> str:
        calls.append({"system": system, "user": user})
        return json.dumps(
            {
                "title": BOUND.title,
                "input_summary": BOUND.input_summary,
                "output_summary": BOUND.output_summary,
                "plan": BOUND.items,
                "resource_resolution": {
                    "preserves_requirements": True,
                    "bindings": [
                        {
                            "resource_id": SELECTED,
                            "status": "used",
                            "step_index": 1,
                            "step_kind": "resource_action",
                            "action": "Classify ticket_text",
                        }
                    ],
                },
            }
        )

    monkeypatch.setattr(resources, "list_tenant_resources", list_selected)
    monkeypatch.setattr(build.llm, "invoke_text", invoke)
    result = build.reconcile_resource_plan(
        object(), "tenant", ABSTRACT, [SELECTED], account_id="actor", goal_text=GOAL, requirements=REQUIREMENTS
    )
    assert result == replace(BOUND, used_resource_ids=[SELECTED])
    assert len(reads) == 1
    assert reads[0] == ("tenant", {"account_id": "actor", "selected_agent_ids": frozenset({"published-classifier"})})
    assert len(calls) == 1
    assert GOAL in calls[0]["user"]
    assert "no_external_accounts" in calls[0]["user"]
    assert SELECTED in calls[0]["user"]
    assert ref.meta in calls[0]["user"]
    assert ABSTRACT.items[1] in calls[0]["user"]


@pytest.mark.parametrize("source", ["missing", "unknown", "changed_snapshot"])
def test_reconciliation_never_invents_an_available_selected_agent(monkeypatch: pytest.MonkeyPatch, source: str) -> None:
    from services.dify_builder.agent import build, resources

    agents: list[resources.ResourceRef] = []
    if source == "changed_snapshot":
        agents = [resources.ResourceRef(id=SELECTED.replace("snapshot-v3", "snapshot-v4"), label="Changed classifier")]
    inventory = resources.TenantResources(
        models=[],
        datasets=[],
        tools=[],
        agents=agents,
        agent_source_error="catalog unavailable" if source == "unknown" else None,
    )
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_kw: inventory)

    def forbid_model(*_args: object, **_kwargs: object) -> str:
        raise AssertionError("Unverified selection must stop before cognition")

    monkeypatch.setattr(build.llm, "invoke_text", forbid_model)
    if source == "changed_snapshot":
        from services.dify_builder.native_testing.agent_binding import AgentSnapshotChanged

        with pytest.raises(AgentSnapshotChanged):
            build.reconcile_resource_plan(
                object(), "tenant", ABSTRACT, [SELECTED], account_id="actor", goal_text=GOAL, requirements=REQUIREMENTS
            )
        return
    assert (
        build.reconcile_resource_plan(
            object(), "tenant", ABSTRACT, [SELECTED], account_id="actor", goal_text=GOAL, requirements=REQUIREMENTS
        )
        is None
    )


def test_discovery_gap_receives_candidate_facts_and_does_not_treat_abstract_absence_as_fact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.dify_builder.contract import ResourceOption
    from services.dify_builder.agent import build

    seen: dict[str, str] = {}
    meta = "Published version 3; reference eligible; runtime authorization unverified."

    def invoke(_model: object, *, system: str, user: str, **_kwargs: object) -> dict[str, str]:
        seen.update(system=system, user=user)
        return {"gap": ""}

    monkeypatch.setattr(build.llm, "invoke_json", invoke)
    assert (
        build.assess_capability_gap(
            object(),
            ABSTRACT.items,
            [ResourceOption(id=SELECTED, label="Ticket classifier", meta=meta, kind="agent", readiness="ready")],
            goal_text=GOAL,
            requirements=REQUIREMENTS,
        )
        == ""
    )
    assert meta in seen["user"]
    assert "abstract plan is not evidence" in seen["system"]
    assert "not yet confirmed" in seen["system"]


@pytest.mark.parametrize("resolution", [None, "fallback", "unresolved", "source_not_preserved"])
def test_real_id_suffix_does_not_turn_a_fallback_into_a_bound_action(
    monkeypatch: pytest.MonkeyPatch, resolution: str | None
) -> None:
    import json

    from services.dify_builder.agent import build, resources

    inventory = resources.TenantResources(
        models=[], datasets=[], tools=[], agents=[resources.ResourceRef(id=SELECTED, label="Ticket classifier")]
    )
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_kw: inventory)
    response: dict[str, object] = {
        "title": ABSTRACT.title,
        "input_summary": ABSTRACT.input_summary,
        "output_summary": ABSTRACT.output_summary,
        "plan": [ABSTRACT.items[0], ABSTRACT.items[1] + f" (using {SELECTED})", ABSTRACT.items[2]],
    }
    if resolution:
        response["resource_resolution"] = {
            "preserves_requirements": resolution != "source_not_preserved",
            "bindings": [
                {
                    "resource_id": SELECTED,
                    "status": "unresolved" if resolution == "unresolved" else "used",
                    "step_index": 1,
                    "step_kind": "fallback",
                    "action": "Return unavailable explanation",
                }
            ],
        }
    calls: list[bool] = []

    def invoke(*_args: object, **_kwargs: object) -> str:
        calls.append(True)
        return json.dumps(response)

    monkeypatch.setattr(build.llm, "invoke_text", invoke)
    assert (
        build.reconcile_resource_plan(
            object(), "tenant", ABSTRACT, [SELECTED], account_id="actor", goal_text=GOAL, requirements=REQUIREMENTS
        )
        is None
    )
    # Schema-only omissions have one correction opportunity. Explicit failure
    # or unresolved reasoning must stop without coercing a successful answer.
    assert len(calls) == (2 if resolution is None else 1)


def test_an_unused_extra_selection_does_not_force_an_invented_action(monkeypatch: pytest.MonkeyPatch) -> None:
    import json

    from services.dify_builder.agent import build, resources

    extra = SELECTED.replace("published-classifier", "extra-classifier")
    inventory = resources.TenantResources(
        models=[],
        datasets=[],
        tools=[],
        agents=[
            resources.ResourceRef(id=SELECTED, label="Ticket classifier"),
            resources.ResourceRef(id=extra, label="Optional extra classifier"),
        ],
    )
    monkeypatch.setattr(resources, "list_tenant_resources", lambda *_a, **_kw: inventory)
    response = {
        "title": BOUND.title,
        "input_summary": BOUND.input_summary,
        "output_summary": BOUND.output_summary,
        "plan": BOUND.items,
        "resource_resolution": {
            "preserves_requirements": True,
            "bindings": [
                {
                    "resource_id": SELECTED,
                    "status": "used",
                    "step_index": 1,
                    "step_kind": "resource_action",
                    "action": "Classify ticket_text",
                },
                {"resource_id": extra, "status": "unused", "reason": "The first classifier covers the requested job"},
            ],
        },
    }
    monkeypatch.setattr(build.llm, "invoke_text", lambda *_a, **_kw: json.dumps(response))
    result = build.reconcile_resource_plan(
        object(), "tenant", ABSTRACT, [SELECTED, extra], account_id="actor", goal_text=GOAL, requirements=REQUIREMENTS
    )
    assert result is not None
    assert result.used_resource_ids == [SELECTED]
    assert extra not in "\n".join(result.items)
    agent = ReconciliationAgent(result)
    _, repo, session_id = confirm(agent, [SELECTED, extra])
    assert repo.get_session(session_id)[1].resource_selection == {"resource_ids": [SELECTED]}


def test_failed_reconciliation_keeps_live_resource_card_and_accepts_a_new_selection() -> None:
    from core.dify_builder.errors import ConflictError
    from core.dify_builder.models import ConversationItem
    from services.dify_builder.service import DifyBuilderService
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    other = SELECTED.replace("published-classifier", "other-classifier")
    repo = InMemoryRepository()
    actor = Actor(account_id="account", tenant_id="tenant")
    session = Session(
        app_id="app",
        tenant_id=actor.tenant_id,
        owner_account_id=actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_RESOURCE_RECOMMENDATION,
    )
    repo.create_session(
        session,
        DifyBuilderContext(
            goal_text=GOAL,
            requirements=REQUIREMENTS,
            plan_title=ABSTRACT.title,
            plan_input_summary=ABSTRACT.input_summary,
            plan_output_summary=ABSTRACT.output_summary,
            plan_items=list(ABSTRACT.items),
        ),
        [
            ConversationItem(
                seq=0,
                kind="resource_select",
                payload={
                    "title": "Resources",
                    "recommended": [
                        {"id": SELECTED, "label": "First classifier"},
                        {"id": other, "label": "Other classifier"},
                    ],
                },
            )
        ],
    )
    agent = ReconciliationAgent(None)
    runner = Runner(Env(agent=agent, repo=repo, dify=FakeDifyPort(), now=lambda: datetime.min), build_registry())
    service = DifyBuilderService(repo=repo, session_lock=FakeSessionLock(), enqueue_fn=lambda *_args: None)
    initial = service.get_session_view(session.id, actor)
    action = Action(kind="confirm_resources", base_version=initial.version, payload={"resource_ids": [SELECTED]})
    _, dispatch, _ = service._prepare_action(session.id, actor, action)
    assert dispatch
    runner.advance(session.id, Turn(actor=actor, action=action))
    failed = service.get_session_view(session.id, actor)
    assert len(agent.requests) == 1
    assert [item.id for item in failed.actions] == ["confirm_resources"]
    assert failed.active_interaction is not None
    assert initial.active_interaction is not None
    assert failed.active_interaction.card.seq == initial.active_interaction.card.seq
    assert failed.active_interaction.valid_at_version == failed.version > initial.version
    # Re-reading and a stale action never invoke cognition or silently replay.
    service.get_session_view(session.id, actor)
    with pytest.raises(ConflictError):
        service._prepare_action(session.id, actor, action)
    assert len(agent.requests) == 1
    assert not repo.get_session(session.id)[1].checkpoint_id
    replacement = replace(
        BOUND, items=[step.replace(SELECTED, other) for step in BOUND.items], used_resource_ids=[other]
    )
    agent.replacement = replacement
    next_action = Action(kind="confirm_resources", base_version=failed.version, payload={"resource_ids": [other]})
    _, dispatch, _ = service._prepare_action(session.id, actor, next_action)
    assert dispatch
    completed = runner.advance(session.id, Turn(actor=actor, action=next_action))
    assert len(agent.requests) == 2
    assert completed.current_state == PcState.BUILD_PLAN_APPROVAL
    assert repo.get_session(session.id)[1].resource_selection == {"resource_ids": [other]}
    assert len([item for item in repo.list_conversation(session.id) if item.kind == "plan"]) == 1


@pytest.mark.parametrize("fresh_visible", [True, False])
def test_snapshot_drift_requires_explicit_rediscovery_and_new_snapshot_confirmation(fresh_visible: bool) -> None:
    from core.dify_builder.contract import ResourceOption
    from core.dify_builder.errors import NotFoundError
    from core.dify_builder.models import ConversationItem
    from services.dify_builder.native_testing.agent_binding import AgentSnapshotChanged
    from services.dify_builder.service import DifyBuilderService, resolve_submitted_action
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    fresh_id = SELECTED.replace("snapshot-v3", "snapshot-v4")

    class ChangedAgent(ReconciliationAgent):
        def __init__(self) -> None:
            super().__init__(None)
            self.discovery_calls = 0

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
            del plan, goal_text, requirements, reply_language
            self.requests.append({"resource_ids": resource_ids})
            if resource_ids == [SELECTED]:
                raise AgentSnapshotChanged(effective_snapshot_id="snapshot-v4")
            return replace(
                BOUND, items=[step.replace(SELECTED, fresh_id) for step in BOUND.items], used_resource_ids=[fresh_id]
            )

        @override
        def discover_resources(
            self,
            plan_items: list[str],
            *,
            goal_text: str,
            requirements: dict[str, object],
            reply_language: str | None = None,
        ) -> list[ResourceOption]:
            del plan_items, goal_text, requirements, reply_language
            self.discovery_calls += 1
            return (
                [
                    ResourceOption(
                        id=fresh_id,
                        label="Classifier v4",
                        meta="Published v4; reference eligible",
                        kind="agent",
                        readiness="ready",
                    )
                ]
                if fresh_visible
                else []
            )

    actor = Actor(account_id="account", tenant_id="tenant")
    repo = InMemoryRepository()
    session = Session(
        app_id="app",
        tenant_id=actor.tenant_id,
        owner_account_id=actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_RESOURCE_RECOMMENDATION,
    )
    repo.create_session(
        session,
        DifyBuilderContext(
            goal_text=GOAL,
            requirements=REQUIREMENTS,
            plan_title=ABSTRACT.title,
            plan_input_summary=ABSTRACT.input_summary,
            plan_output_summary=ABSTRACT.output_summary,
            plan_items=list(ABSTRACT.items),
        ),
        [
            ConversationItem(
                seq=0,
                kind="resource_select",
                payload={
                    "title": "Resources",
                    "recommended": [
                        {"id": SELECTED, "label": "Classifier v3"},
                    ],
                },
            )
        ],
    )
    agent = ChangedAgent()
    runner = Runner(Env(agent=agent, repo=repo, dify=FakeDifyPort(), now=lambda: datetime.min), build_registry())
    access = {"allowed": True}

    def authorize(*_args: object) -> None:
        if not access["allowed"]:
            raise NotFoundError("Current app access is required")

    service = DifyBuilderService(
        repo=repo, session_lock=FakeSessionLock(), enqueue_fn=lambda *_args: None, authorize_app_fn=authorize
    )
    initial_action = Action(kind="confirm_resources", base_version=1, payload={"resource_ids": [SELECTED]})
    service._prepare_action(session.id, actor, initial_action)
    runner.advance(session.id, Turn(actor=actor, action=initial_action))
    stale = service.get_session_view(session.id, actor)
    assert stale.active_interaction is None  # Existing client now renders its generic ChoiceInteraction.
    assert stale.decision is not None
    assert [option.id for option in stale.decision.options] == ["rediscover_resources"]
    assert agent.discovery_calls == 0  # No automatic refresh or silent snapshot replacement.
    assert len(agent.requests) == 1
    assert not repo.get_session(session.id)[1].checkpoint_id
    from core.dify_builder.errors import BadRequestError

    with pytest.raises(BadRequestError):
        service._prepare_action(
            session.id,
            actor,
            Action(kind="confirm_resources", base_version=stale.version, payload={"resource_ids": [SELECTED]}),
        )
    refresh_payload = {"option_id": "rediscover_resources"}
    refresh = Action(
        kind=resolve_submitted_action("confirm", refresh_payload), base_version=stale.version, payload=refresh_payload
    )
    access["allowed"] = False
    with pytest.raises(NotFoundError):
        service._prepare_action(session.id, actor, refresh)
    assert agent.discovery_calls == 0
    access["allowed"] = True
    service._prepare_action(session.id, actor, refresh)
    runner.advance(session.id, Turn(actor=actor, action=refresh))
    refreshed = service.get_session_view(session.id, actor)
    assert agent.discovery_calls == 1
    assert len(agent.requests) == 1  # Rediscovery does not approve/build/run anything.
    assert refreshed.active_interaction is not None
    assert refreshed.active_interaction.action_id == "confirm_resources"
    assert refreshed.active_interaction.card.seq > 0
    options = refreshed.active_interaction.card.payload["recommended"]
    assert [option["id"] for option in options] == ([fresh_id] if fresh_visible else [])
    assert not any(item.kind == "plan" for item in repo.list_conversation(session.id))
    assert not repo.get_session(session.id)[1].checkpoint_id
    # A duplicate/stale refresh submission cannot trigger another source read.
    from core.dify_builder.errors import ConflictError

    with pytest.raises((ConflictError, BadRequestError)):
        service._prepare_action(session.id, actor, refresh)
    assert agent.discovery_calls == 1
    if fresh_visible:
        confirmation = Action(
            kind="confirm_resources", base_version=refreshed.version, payload={"resource_ids": [fresh_id]}
        )
        service._prepare_action(session.id, actor, confirmation)
        runner.advance(session.id, Turn(actor=actor, action=confirmation))
        assert len(agent.requests) == 2
        assert repo.get_session(session.id)[1].resource_selection == {"resource_ids": [fresh_id]}
        assert service.get_session_view(session.id, actor).phase == "plan"
