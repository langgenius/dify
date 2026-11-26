"""Conflict rules across service admission, queued work and native execution admission."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import asdict
from typing import TYPE_CHECKING, TypedDict

import pytest

import tasks.dify_builder_advance_task as worker
from core.dify_builder.errors import BadRequestError, ConflictError
from core.dify_builder.models import (
    Action,
    Actor,
    Diagnosis,
    DifyBuilderContext,
    EntryMode,
    Inputs,
    MutationIntent,
    Run,
    Session,
)
from core.dify_builder.models import Graph as BuilderGraph
from core.dify_builder.state import PcState
from models.workflow import Workflow
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.services.dify_builder.test_advance_task import (
    ACCOUNT_ID,
    APP_ID,
    TENANT_ID,
    admitted_stub_cognition,
)
from tests.unit_tests.services.dify_builder.test_advance_task import (
    active_worker_lock as active_worker_lock,  # noqa: PLC0414 - shared pytest fixtures
)
from tests.unit_tests.services.dify_builder.test_advance_task import (
    queued_commands as queued_commands,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.test_advance_task import (
    wired as wired,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.typed_fixtures import dictionaries, dictionary

if TYPE_CHECKING:
    from sqlalchemy.orm import Session as DatabaseSession
    from sqlalchemy.orm import sessionmaker

    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.dify_builder.models import ConversationItem, Turn
    from models.account import Account
    from models.model import App
    from services.dify_builder.application.execution_policy import BuilderExecutionContext, JsonToolExecutionContext
    from services.dify_builder.application.ports import DifyPort
    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort

    type Owned = tuple[sessionmaker[DatabaseSession], Actor, App, Workflow, str, str]
    type QueuedCommands = tuple[
        DifyBuilderService,
        FakeDifyPort,
        list[Action],
        list[tuple[str, dict[str, object]]],
        list[tuple[str, str]],
    ]


class _PrepareArguments(TypedDict):
    session_id: str
    test_input_id: str
    app_id: str
    actor: Actor
    workflow: Workflow
    submitted_inputs: Inputs
    effective_inputs: Inputs


class _GenerateArguments(TypedDict):
    app_model: App
    user: Account
    args: Mapping[str, object]
    invoke_from: InvokeFrom
    session: DatabaseSession
    streaming: bool
    workflow_execution_mode: str
    builder_execution: BuilderExecutionContext | JsonToolExecutionContext
    builder_execution_admit: _BuilderExecutionLaunch


_ACTOR = Actor(account_id=ACCOUNT_ID, tenant_id=TENANT_ID)
_BASE = "a" * 64
_CURRENT = "b" * 64


__all__ = ["admitted_stub_cognition"]


def _row[T](db: DatabaseSession, model: type[T], row_id: str) -> T:
    row = db.get(model, row_id)
    assert row is not None
    return row


def _capture_run[**P](run_draft: Callable[P, Run], runs: list[Run]) -> Callable[P, Run]:
    def capture(*args: P.args, **kwargs: P.kwargs) -> Run:
        run = run_draft(*args, **kwargs)
        runs.append(run)
        return run

    return capture


def _submit(service: DifyBuilderService, session_id: str, kind: str) -> None:
    view = service.get_session_view(session_id, _ACTOR)
    assert view.app_revision is not None
    service.submit_action(
        session_id,
        _ACTOR,
        Action(kind=kind, base_version=view.version, base_app_revision=view.app_revision.current),
    )


@pytest.mark.parametrize("base_revision", ["", "stale-revision"])
@pytest.mark.parametrize("queued_drift", [False, True])
def test_message_revision_exemption_reaches_worker_and_durable_turn(
    repo: SqlDifyBuilderRepository, queued_commands: QueuedCommands, base_revision: str, queued_drift: bool
) -> None:
    service, port, queued, events, released = queued_commands
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_AWAIT_APPROVAL,
    )
    repo.create_session(session, DifyBuilderContext(last_snapshot_hash=_BASE), [])
    action = Action(
        kind="message",
        payload={"text": "Explain the proposed fix", "client_turn_id": "message-turn"},
        base_version=session.version,
        base_app_revision=base_revision,
    )
    service.submit_action(session.id, _ACTOR, action)
    if queued_drift:
        port.hash = _CURRENT

    worker.advance_session(session.id, asdict(queued.pop()), asdict(_ACTOR), "queued-token")

    stored, context = repo.get_session(session.id)
    assert stored.current_state == session.current_state
    assert stored.version == session.version + 2
    assert context.last_snapshot_hash == _BASE
    assert repo.get_conversation_turn_kinds(session.id, "message-turn") == {"user", "assistant_turn"}
    assert [item.seq for item in repo.list_conversation(session.id)] == [0, 1]
    assert events[-1][1]["kind"] == "command_finished"
    assert port.applied == []
    assert not port.published
    # A settled turn remains idempotent even though its submitted version is old.
    service.submit_action(session.id, _ACTOR, action)
    assert queued == []
    assert len(repo.list_conversation(session.id)) == 2
    assert released == [(session.id, "queued-token")]


def test_unchanged_interrupted_retry_reenters_the_working_handler(
    repo: SqlDifyBuilderRepository, queued_commands: QueuedCommands
) -> None:
    service, port, queued, events, _released = queued_commands
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_APPLY,
    )
    repair = MutationIntent(op="set_node_config", args={"node_id": "start", "path": "title", "value": "Fixed"})
    repo.create_session(
        session,
        DifyBuilderContext(
            staged_repair=[repair],
            last_snapshot_hash=_BASE,
            last_structure_fingerprint=port.structural_fingerprint(port.graph),
        ),
        [],
    )
    _submit(service, session.id, "recovery_continue")

    worker.advance_session(session.id, asdict(queued.pop()), asdict(_ACTOR), "queued-token")

    stored, context = repo.get_session(session.id)
    assert stored.current_state == PcState.FIX_AWAIT_VERIFY
    assert context.recovery_class == ""
    assert port.applied == [repair]
    assert port.expected_revision == _BASE
    assert events[-1][1]["kind"] == "command_finished"


def test_recovery_continue_reclassifies_targets_changed_since_the_recovery_offer(
    repo: SqlDifyBuilderRepository, queued_commands: QueuedCommands
) -> None:
    service, port, queued, events, _released = queued_commands
    port.graph["nodes"].append({"id": "output", "data": {"type": "end", "outputs": []}})
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_APPLY,
    )
    repair = MutationIntent(op="set_node_config", args={"node_id": "output", "path": "title", "value": "Fixed"})
    repo.create_session(
        session,
        DifyBuilderContext(
            diagnosis=Diagnosis(culprit_node_id="start"),
            staged_repair=[repair],
            last_snapshot_hash=_BASE,
            last_structure_fingerprint=port.structural_fingerprint(port.graph),
        ),
        [],
    )
    port.hash = _CURRENT
    _submit(service, session.id, "check_recovery")
    worker.advance_session(session.id, asdict(queued.pop()), asdict(_ACTOR), "queued-token")
    classified, context = repo.get_session(session.id)
    assert context.recovery_class == "config_only"
    # A collaborator replaces the original target after classification. The
    # repair still addresses an existing node, so patch validation alone cannot
    # enforce the recovery offer's structural-invalidating rule.
    replacement_nodes: list[BuilderGraph] = [
        {"id": "replacement", "data": {"type": "start", "variables": []}},
        {"id": "output", "data": {"type": "end", "outputs": []}},
    ]
    port.graph["nodes"] = replacement_nodes
    port.graph["edges"] = [{"source": "replacement", "target": "output"}]
    port.hash = "c" * 64
    _submit(service, session.id, "recovery_continue")

    worker.advance_session(session.id, asdict(queued.pop()), asdict(_ACTOR), "queued-token")

    stored, context = repo.get_session(session.id)
    assert stored.current_state == PcState.FIX_APPLY
    assert stored.version == classified.version + 1
    assert context.last_snapshot_hash == _BASE
    assert context.recovery_class == "structural_invalidating"
    assert context.staged_repair == [repair]
    assert port.applied == []
    assert events[-1][1]["kind"] == "command_finished"
    assert [action.id for action in service.get_session_view(session.id, _ACTOR).actions] == ["restart"]


@pytest.mark.parametrize(
    ("kind", "change_at", "recovery_class"),
    [
        ("recovery_continue", "classification", "config_only"),
        ("recovery_continue", "rebase", "config_only"),
        ("recovery_continue", "rebase", ""),
        ("recovery_restart", "rebase", "config_only"),
    ],
)
def test_recovery_does_not_rebase_to_a_draft_changed_after_the_worker_revision_check(
    repo: SqlDifyBuilderRepository,
    queued_commands: QueuedCommands,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    change_at: str,
    recovery_class: str,
) -> None:
    from services.dify_builder import recovery as recovery_module

    service, port, queued, events, released = queued_commands
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_APPLY,
    )
    repair = MutationIntent(op="set_node_config", args={"node_id": "start", "path": "title", "value": "Fixed"})
    repo.create_session(
        session,
        DifyBuilderContext(last_snapshot_hash=_BASE, recovery_class=recovery_class, staged_repair=[repair]),
        [],
    )
    port.hash = _CURRENT if recovery_class else _BASE
    _submit(service, session.id, kind)
    if change_at == "classification":
        original_read = port.read_graph
        reads = 0

        def read_with_drift(app_id: str, actor: Actor) -> tuple[BuilderGraph, str]:
            nonlocal reads
            reads += 1
            if reads == 2:
                port.hash = "c" * 64
            return original_read(app_id, actor)

        monkeypatch.setattr(port, "read_graph", read_with_drift)
    else:
        original_recovery = recovery_module.apply_recovery_action

        def rebase_with_drift(
            dify: DifyPort, turn: Turn, session: Session, context: DifyBuilderContext
        ) -> tuple[PcState, list[ConversationItem]]:
            port.hash = "c" * 64
            return original_recovery(dify, turn, session, context)

        monkeypatch.setattr(recovery_module, "apply_recovery_action", rebase_with_drift)

    worker.advance_session(session.id, asdict(queued.pop()), asdict(_ACTOR), "queued-token")

    stored, context = repo.get_session(session.id)
    assert stored.current_state == PcState.FIX_APPLY
    assert stored.version == session.version
    assert context.last_snapshot_hash == _BASE
    assert context.recovery_class == recovery_class
    assert context.staged_repair == [repair]
    assert port.applied == []
    assert events[-1][1]["error"] == "conflict"
    assert released == [(session.id, "queued-token")]


@pytest.mark.parametrize("conflict", ["draft_before_submit", "session_before_submit", "session_while_queued"])
def test_message_exemption_preserves_draft_baseline_and_session_version_checks(
    repo: SqlDifyBuilderRepository, queued_commands: QueuedCommands, conflict: str
) -> None:
    service, port, queued, events, released = queued_commands
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_AWAIT_APPROVAL,
    )
    repo.create_session(session, DifyBuilderContext(last_snapshot_hash=_BASE), [])
    action = Action(
        kind="message",
        payload={"text": "Explain the proposed fix", "client_turn_id": "message-turn"},
        base_version=session.version,
        base_app_revision="stale-revision",
    )
    if conflict == "draft_before_submit":
        port.hash = _CURRENT
    elif conflict == "session_before_submit":
        stored, context = repo.get_session(session.id)
        repo.compare_and_advance(session.id, stored.version, stored.current_state, context, [])
    if conflict != "session_while_queued":
        with pytest.raises(ConflictError):
            service.submit_action(session.id, _ACTOR, action)
        assert queued == []
        assert released == []
    else:
        service.submit_action(session.id, _ACTOR, action)
        stored, context = repo.get_session(session.id)
        repo.compare_and_advance(session.id, stored.version, stored.current_state, context, [])
        worker.advance_session(session.id, asdict(queued.pop()), asdict(_ACTOR), "queued-token")
        assert events[-1][1]["error"] == "conflict"
        assert released == [(session.id, "queued-token")]
    assert repo.list_conversation(session.id) == []
    assert port.applied == []


@pytest.mark.parametrize("drift", ["config_only", "structural_compatible", "structural_invalidating"])
def test_interrupted_conflict_is_classified_before_working_handler_can_resume(
    repo: SqlDifyBuilderRepository, queued_commands: QueuedCommands, drift: str
) -> None:
    service, port, queued, events, released = queued_commands
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_APPLY,
    )
    repair = MutationIntent(op="set_node_config", args={"node_id": "start", "path": "title", "value": "Fixed"})
    context = DifyBuilderContext(
        diagnosis=Diagnosis(culprit_node_id="start"),
        staged_repair=[repair],
        last_snapshot_hash=_BASE,
        last_structure_fingerprint=port.structural_fingerprint(port.graph),
    )
    repo.create_session(session, context, [])
    port.hash = _CURRENT
    if drift == "config_only":
        port.graph["nodes"][0]["data"]["title"] = "Manual edit"
    elif drift == "structural_compatible":
        port.graph["nodes"].append({"id": "new", "data": {"type": "end"}})
    else:
        port.graph["nodes"].clear()

    view = service.get_session_view(session.id, _ACTOR)
    assert view.interrupted
    assert view.app_revision is not None
    assert view.app_revision.conflicted
    assert [action.id for action in view.actions] == ["check_recovery"]
    # A direct retry still cannot silently accept a real configuration conflict.
    with pytest.raises(ConflictError):
        _submit(service, session.id, "recovery_continue")
    _submit(service, session.id, "check_recovery")
    worker.advance_session(session.id, asdict(queued.pop()), asdict(_ACTOR), "queued-token")

    stored, context = repo.get_session(session.id)
    assert stored.current_state == PcState.FIX_APPLY
    assert stored.version == session.version + 1
    assert context.last_snapshot_hash == _BASE
    assert context.recovery_class == drift
    assert port.applied == []
    assert port.run_draft_inputs == {}
    assert not port.published
    recovered = events[-1][1]
    assert recovered["kind"] == "command_finished"
    assert dictionary(recovered["recovery"])["recovery_class"] == drift
    actions = dictionaries(recovered["actions"])
    if drift == "structural_invalidating":
        assert [action["id"] for action in actions] == ["restart"]
        with pytest.raises(BadRequestError):
            _submit(service, session.id, "recovery_continue")
    else:
        assert [action["id"] for action in actions] == ["recovery_continue", "restart"]
        _submit(service, session.id, "recovery_continue")
        worker.advance_session(session.id, asdict(queued.pop()), asdict(_ACTOR), "queued-token")
        stored, context = repo.get_session(session.id)
        assert stored.current_state == PcState.FIX_AWAIT_VERIFY
        assert context.recovery_class == ""
        assert port.applied == [repair]
        assert port.expected_revision == _CURRENT
        assert events[-1][1]["kind"] == "command_finished"
    assert released == [(session.id, "queued-token")] * (1 if drift == "structural_invalidating" else 2)


@pytest.mark.parametrize("kind", ["check_recovery", "recovery_continue"])
@pytest.mark.parametrize("conflict", ["draft", "session"])
def test_recovery_commands_keep_revision_and_session_fences_while_queued(
    repo: SqlDifyBuilderRepository, queued_commands: QueuedCommands, kind: str, conflict: str
) -> None:
    service, port, queued, events, released = queued_commands
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_APPLY,
    )
    repo.create_session(
        session,
        DifyBuilderContext(
            last_snapshot_hash=_BASE,
            recovery_class="config_only" if kind == "recovery_continue" else "",
            staged_repair=[
                MutationIntent(op="set_node_config", args={"node_id": "start", "path": "title", "value": "Fix"})
            ],
        ),
        [],
    )
    port.hash = _CURRENT
    _submit(service, session.id, kind)
    if conflict == "draft":
        port.hash = "c" * 64
    else:
        stored, context = repo.get_session(session.id)
        repo.compare_and_advance(session.id, stored.version, stored.current_state, context, [])

    worker.advance_session(session.id, asdict(queued.pop()), asdict(_ACTOR), "queued-token")

    stored, context = repo.get_session(session.id)
    assert stored.current_state == PcState.FIX_APPLY
    assert context.last_snapshot_hash == _BASE
    assert port.applied == []
    assert events[-1][1]["error"] == "conflict"
    assert released == [(session.id, "queued-token")]
