"""P3a acceptance: the real P1 engine runs end to end on the SQL ``Repository``.

Wires the same engine pieces the P1 full-flow acceptance
(``tests/unit_tests/core/workflow_copilot/test_fix_flow.py``) exercises --
``Runner`` + ``fix_registry()`` + ``PlaceholderAgent`` + ``FakeDifyPort`` --
but swaps the in-memory fake ``Repository`` for ``SqlCopilotRepository``
backed by a SQLite in-memory database. Proves the CAS advance loop, the
checkpoint/run persistence side effects, and the second (checklist) entry
path all round-trip through a real ``UPDATE ... WHERE version=`` + a real
``UNIQUE(session_id, seq)`` constraint, not just the Python-level checks the
in-memory fake enforces.

Test-only: no engine or repository changes belong in this file.
"""

from collections.abc import Iterator
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow_copilot.errors import ConflictError
from core.workflow_copilot.handlers_fix import fix_registry
from core.workflow_copilot.models import (
    Action,
    Actor,
    ChecklistError,
    ConversationItem,
    EntryMode,
    FixContext,
    Run,
    Session,
    Turn,
)
from core.workflow_copilot.placeholder_agent import FIXED_CODE, PlaceholderAgent
from core.workflow_copilot.ports import Repository
from core.workflow_copilot.runner import Env, Runner
from core.workflow_copilot.state import PcState, canvas_read_only
from models.base import Base
from services.workflow_copilot.repository import SqlCopilotRepository
from tests.unit_tests.core.workflow_copilot.fakes import FakeDifyPort

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"


@pytest.fixture
def engine() -> Iterator[Engine]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def repo(engine: Engine) -> SqlCopilotRepository:
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return SqlCopilotRepository(factory)


def _actor() -> Actor:
    return Actor(account_id=ACCOUNT_ID, tenant_id=TENANT_ID)


def _new_env(repo: SqlCopilotRepository) -> tuple[Env, FakeDifyPort]:
    dify = FakeDifyPort()
    env = Env(dify=dify, agent=PlaceholderAgent(), repo=repo, now=lambda: datetime.min, emit=None)
    return env, dify


def _fix_session(**overrides) -> Session:
    fields: dict = {
        "app_id": APP_ID,
        "tenant_id": TENANT_ID,
        "owner_account_id": ACCOUNT_ID,
        "entry_mode": EntryMode.FIX,
        "current_state": PcState.FIX_DIAGNOSE,
    }
    fields.update(overrides)
    return Session(**fields)


def _seed_fix_session(repo: SqlCopilotRepository) -> Session:
    """Seed a session at fix.diagnose with a run-context item and a
    FixContext pointing at a pre-existing failed run -- mirrors the P1
    full-flow acceptance's seed, persisted through the SQL repo instead of
    the in-memory fake."""
    s = _fix_session()
    repo.create_session(
        s,
        FixContext(failed_run_id="TR-1"),
        [ConversationItem(kind="run-context", seq=0, payload={"failed_run_id": "TR-1"})],
    )
    repo.save_run(s.id, Run(id="TR-1", kind="original-failed", status="failed", immutable=True))
    return s


# ---- full happy-path acceptance --------------------------------------------


def test_full_fix_flow_request_fix_to_publish_success_on_sql_repo(repo: SqlCopilotRepository) -> None:
    assert isinstance(repo, Repository)

    env, dify = _new_env(repo)
    s = _seed_fix_session(repo)

    runner = Runner(env, fix_registry())

    # 1) request_fix: auto-advances diagnose -> propose -> apply -> await_verify
    #    (PlaceholderAgent's canned repair is low-risk => no approval gate).
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_VERIFY
    assert not canvas_read_only(out.current_state), "await_verify must leave the canvas editable"
    version_after_request_fix = out.version
    assert version_after_request_fix > 1, "the CAS must have advanced the version monotonically"

    _, fc = repo.get_session(s.id)
    assert fc.diagnosis is not None
    assert fc.diagnosis.culprit_node_id == "output"  # FakeDifyPort.node_outputs' sole failed node
    assert fc.staged_repair
    assert fc.risk is not None
    assert fc.risk.level == "low"
    assert fc.checkpoint_id, "diagnose must create a checkpoint before any mutation"

    # a checkpoint was actually persisted (via the SQL repo) and restorable.
    cp, snap = repo.get_checkpoint(fc.checkpoint_id)
    assert cp.session_id == s.id
    assert cp.state == PcState.FIX_DIAGNOSE
    assert snap.id == cp.snapshot_id

    # canvas-lock: every state observed so far on the working leg was locked.
    assert canvas_read_only(PcState.FIX_DIAGNOSE)
    assert canvas_read_only(PcState.FIX_PROPOSE)
    assert canvas_read_only(PcState.FIX_APPLY)

    # apply_repair received the placeholder's set_node_config intent.
    assert dify.applied
    assert dify.applied[0].op == "set_node_config"
    assert dify.applied[0].args["path"] == "code"
    assert dify.applied[0].args["value"] == FIXED_CODE

    # the original failed run is untouched by diagnose/propose/apply.
    original = repo.get_run("TR-1")
    assert original.status == "failed"
    assert original.immutable

    # 2) run_verify -> fix.await_testdata.
    turn = Turn(action=Action(kind="run_verify", base_version=out.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_TESTDATA
    assert canvas_read_only(out.current_state) is False, "await_testdata must leave the canvas editable"
    assert out.version > version_after_request_fix

    # 3) provide_testdata (mock) -> fix.verify (working, green) -> await_decision.
    turn = Turn(
        action=Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version),
        actor=_actor(),
    )
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_DECISION
    assert not canvas_read_only(out.current_state), "await_decision must leave the canvas editable"
    assert canvas_read_only(PcState.FIX_VERIFY), "fix.verify (the working step in between) must be locked"

    _, fc = repo.get_session(s.id)
    assert fc.test_input_ref, "mock mode must stage a TestInput"
    assert dify.run_draft_inputs == {"query": "mock"}, "PlaceholderAgent.generate_mock_inputs' canned inputs"

    # run-immutability: verify minted a brand NEW run id, distinct from the
    # original failed run, and it is persisted as an immutable row.
    assert fc.verify_run_id
    assert fc.verify_run_id != "TR-1"
    original_again = repo.get_run("TR-1")
    assert original_again.status == "failed", "original failed run must remain untouched by verify"

    verify_run = repo.get_run(fc.verify_run_id)
    assert verify_run.id == fc.verify_run_id, "fc.verify_run_id must match the persisted verify run"
    assert verify_run.id != "TR-1", "the verify run must be a NEW row, not the original failed run"
    assert verify_run.kind == "verify"
    assert verify_run.immutable is True
    assert verify_run.status == "succeeded", "verify_pass=True (default) => the repair verifies GREEN"

    # 4) publish -> fix.publish (working) -> success.
    turn = Turn(action=Action(kind="publish", base_version=out.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.SUCCESS
    assert canvas_read_only(PcState.FIX_PUBLISH), "fix.publish (the working step in between) must be locked"

    assert dify.published is True

    stored, _ = repo.get_session(s.id)
    assert stored.current_state == PcState.SUCCESS
    assert stored.version == out.version

    # the full conversation log persisted through the SQL repo, in seq order.
    conv = repo.list_conversation(s.id)
    assert [item.seq for item in conv] == list(range(len(conv)))
    assert conv[0].kind == "run-context"
    assert any(item.kind == "diagnosis" for item in conv)
    assert any(item.kind == "verify-result" for item in conv)
    assert conv[-1].payload == {"text": "published"}


def test_full_fix_flow_stale_base_version_raises_conflict_on_sql_repo(repo: SqlCopilotRepository) -> None:
    """CAS: each mutating action must carry the session's current version;
    a stale one is rejected by the SQL repo's real ``UPDATE ... WHERE
    version=`` and nothing is applied."""
    env, _dify = _new_env(repo)
    s = _seed_fix_session(repo)
    runner = Runner(env, fix_registry())

    # correct base_version (1) advances all the way to fix.await_verify.
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_VERIFY
    version_after_first_turn = out.version

    # a stale base_version on the next action raises ConflictError and
    # applies nothing.
    stale_turn = Turn(action=Action(kind="run_verify", base_version=1), actor=_actor())
    with pytest.raises(ConflictError):
        runner.advance(s.id, stale_turn)

    stored, _ = repo.get_session(s.id)
    assert stored.current_state == PcState.FIX_AWAIT_VERIFY
    assert stored.version == version_after_first_turn, "a lost CAS race must leave the session untouched"

    # the correct (current) base_version succeeds.
    turn = Turn(action=Action(kind="run_verify", base_version=version_after_first_turn), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_TESTDATA
    assert out.version > version_after_first_turn


# ---- checklist-entry smoke -------------------------------------------------


def _seed_checklist_session(repo: SqlCopilotRepository, errors: list[ChecklistError]) -> Session:
    s = _fix_session(entry_mode=EntryMode.FIX_CHECKLIST, current_state=PcState.CHECKLIST_DIAGNOSE)
    repo.create_session(
        s,
        FixContext(source="checklist", checklist_errors=errors),
        [ConversationItem(kind="run-context", seq=0)],
    )
    return s


def test_checklist_entry_flow_wires_diagnose_through_await_recheck_to_decision_on_sql_repo(
    repo: SqlCopilotRepository,
) -> None:
    """Smoke test for the second entry path: checklist.diagnose ->
    checklist.propose -> fix.apply -> checklist.await_recheck, then a
    recheck(passed=True) action hands off to the shared fix.await_decision
    gate -- proving the checklist path persists correctly through the SQL
    repo too."""
    env, dify = _new_env(repo)
    errors = [ChecklistError(node_id="n1", node_type="llm", title="LLM", messages=["missing prompt"])]
    s = _seed_checklist_session(repo, errors)

    runner = Runner(env, fix_registry())
    turn = Turn(action=Action(kind="request_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, turn)

    # low-risk placeholder repair => auto-advance diagnose -> propose -> apply
    # -> checklist.await_recheck (no approval gate).
    assert out.current_state == PcState.CHECKLIST_AWAIT_RECHECK
    assert not canvas_read_only(out.current_state)
    assert canvas_read_only(PcState.CHECKLIST_DIAGNOSE)
    assert canvas_read_only(PcState.CHECKLIST_PROPOSE)
    assert canvas_read_only(PcState.FIX_APPLY)

    _, fc = repo.get_session(s.id)
    assert fc.diagnosis is not None
    assert fc.diagnosis.culprit_node_id == "n1"
    assert fc.checkpoint_id, "checklist diagnose must also create a checkpoint before mutation"
    assert dify.applied

    cp, snap = repo.get_checkpoint(fc.checkpoint_id)
    assert cp.session_id == s.id
    assert cp.state == PcState.CHECKLIST_DIAGNOSE
    assert snap.id == cp.snapshot_id

    turn = Turn(action=Action(kind="recheck", payload={"passed": True}, base_version=out.version), actor=_actor())
    out = runner.advance(s.id, turn)
    assert out.current_state == PcState.FIX_AWAIT_DECISION
    assert not canvas_read_only(out.current_state)

    stored, _ = repo.get_session(s.id)
    assert stored.current_state == PcState.FIX_AWAIT_DECISION
    assert stored.version == out.version
