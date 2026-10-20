"""A failed replacement plan keeps the durable plan and an actionable gate."""

from copy import deepcopy
from datetime import datetime
from unittest.mock import patch

import pytest

from core.dify_builder.contract import ProgressEventData
from core.dify_builder.handlers_edit import edit_registry
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Graph, MutationIntent, Session, Turn
from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.runner import Env, Runner
from core.dify_builder.state import PcState
from services.dify_builder.copy_ids import BuilderCopyId
from services.dify_builder.plan import WorkflowPlan, make_plan_card
from services.dify_builder.serde import context_from_dict, context_to_dict
from tests.unit_tests.core.dify_builder.fakes import FakeEditDifyPort, InMemoryRepository


@pytest.mark.parametrize(
    "entry_state",
    [PcState.EDIT_IMPACT_ANALYSIS, PcState.EDIT_PLAN_APPROVAL, PcState.EDIT_REVIEW, PcState.EDIT_REVERTED],
)
def test_failed_replanning_preserves_snapshot_and_recovers_on_retry(
    monkeypatch: pytest.MonkeyPatch, entry_state: PcState
) -> None:
    agent = PlaceholderAgent()
    new_plan = WorkflowPlan("New title", "New input", "New output", ["New step", "Return answer"])
    proposals = iter([None, new_plan])
    monkeypatch.setattr(agent, "propose_edit_plan", lambda *_: next(proposals))
    repo = InMemoryRepository()
    dify = FakeEditDifyPort()
    progress: list[ProgressEventData] = []
    canvas: list[Graph] = []
    env = Env(
        agent=agent,
        repo=repo,
        dify=dify,
        now=lambda: datetime.min,
        emit_progress=progress.append,
        emit_canvas=canvas.append,
    )
    actor = Actor(account_id="account", tenant_id="tenant")
    session = Session(
        app_id="app",
        tenant_id="tenant",
        owner_account_id="account",
        entry_mode=EntryMode.EDIT,
        current_state=entry_state,
    )
    context = DifyBuilderContext(
        reply_language="zh-Hans",
        goal_text="Make replies formal",
        form_fields=[{"key": "tone", "label": "Tone", "type": "text", "required": True, "max_length": 30}],
        edit_rules={"tone": "friendly"},
        plan_title="Previous title",
        plan_input_summary="Previous input",
        plan_output_summary="Previous output",
        plan_items=["Previous step"],
        checkpoint_id="previous-checkpoint",
        checkpoint_seq=0,
        test_input_ref="previous-input",
        verify_run_id="previous-run",
        repair_attempts=2,
        last_repair_error="previous-error",
        unknown_outcome_count=1,
        staged_repair=[MutationIntent(op="set_node_config", args={"node_id": "llm"})],
    )
    original_card = make_plan_card(context).to_item(seq=0, at_version=1)
    repo.create_session(session, context, [original_card])
    runner = Runner(env, edit_registry())
    current = session
    if entry_state in {PcState.EDIT_PLAN_APPROVAL, PcState.EDIT_REVIEW}:
        current = runner.advance(session.id, Turn(actor=actor, action=Action(kind="re_fix", base_version=1)))
    _, before = repo.get_session(session.id)
    preserved = deepcopy(before)
    waiting_state = PcState.EDIT_REVERTED if entry_state == PcState.EDIT_REVERTED else PcState.EDIT_IMPACT_ANALYSIS
    kind = "re_fix" if waiting_state == PcState.EDIT_REVERTED else "submit_edit_rules"
    with patch.object(repo, "create_checkpoint", wraps=repo.create_checkpoint) as create_checkpoint:
        failed = runner.advance(
            session.id,
            Turn(actor=actor, action=Action(kind=kind, payload={"tone": "formal"}, base_version=current.version)),
        )
        assert failed.current_state == waiting_state
        assert create_checkpoint.call_count == 0
        _, stored = repo.get_session(session.id)
        for key in (
            "plan_title",
            "plan_input_summary",
            "plan_output_summary",
            "plan_items",
            "checkpoint_id",
            "checkpoint_seq",
            "test_input_ref",
            "verify_run_id",
            "repair_attempts",
            "last_repair_error",
            "unknown_outcome_count",
            "staged_repair",
        ):
            assert getattr(stored, key) == getattr(preserved, key), key
        items = repo.list_conversation(session.id)
        assert [item for item in items if item.kind == "plan"] == [original_card]
        assistant = next(item for item in reversed(items) if item.kind == "assistant_turn")
        assert assistant.payload["execution"]["status"] == "error"
        assert assistant.payload["reply_language"] == "zh-Hans"
        assert assistant.payload["reply_text"]["id"] == BuilderCopyId.REPLIES_BUILDER_COULDN_T_PRODUCE_A_USABLE
        if waiting_state == PcState.EDIT_IMPACT_ANALYSIS:
            form = next(item for item in reversed(items) if item.kind == "form")
            assert form.payload["values"] == {"tone": "formal"}
            assert form.payload["frozen"] is False
            assert form.payload["fields"][0]["required"] is True
            assert form.payload["fields"][0]["max_length"] == 30
        assert not any(event.get("event") == "apply_edit_plan" for event in canvas)

        recovered = runner.advance(session.id, Turn(actor=actor, action=Action(kind=kind, base_version=failed.version)))
        assert recovered.current_state == PcState.EDIT_PLAN_APPROVAL
        assert create_checkpoint.call_count == 1
    _, final = repo.get_session(session.id)
    restored = context_from_dict(context_to_dict(final))
    assert (restored.plan_title, restored.plan_input_summary, restored.plan_output_summary, restored.plan_items) == (
        new_plan.title,
        new_plan.input_summary,
        new_plan.output_summary,
        new_plan.items,
    )
    cards = [item for item in repo.list_conversation(session.id) if item.kind == "plan"]
    assert cards[0] == original_card
    assert cards[1].payload["title"] == new_plan.title
    assert cards[1].payload["items"] == new_plan.items
