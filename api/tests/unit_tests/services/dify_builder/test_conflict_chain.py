"""Conflict rules across service admission, queued work and native execution admission."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import asdict
from types import SimpleNamespace
from typing import TYPE_CHECKING, TypedDict, Unpack, cast
from unittest.mock import MagicMock, Mock

import pytest

import tasks.dify_builder_advance_task as worker
from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
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
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderTestInput
from models.workflow import Workflow
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.revision import executable_graph_revision, execution_revision
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.core.dify_builder.fakes import StubAgent
from tests.unit_tests.core.dify_builder.test_execution_policy import fixture, graph
from tests.unit_tests.services.dify_builder.test_advance_task import (
    ACCOUNT_ID,
    APP_ID,
    TENANT_ID,
)
from tests.unit_tests.services.dify_builder.test_advance_task import (
    active_worker_lock as active_worker_lock,  # noqa: PLC0414 - shared pytest fixtures
)
from tests.unit_tests.services.dify_builder.test_advance_task import (
    engine as engine,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.test_advance_task import (
    queued_commands as queued_commands,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.test_advance_task import (
    repo as repo,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.test_advance_task import (
    wired as wired,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414

if TYPE_CHECKING:
    from sqlalchemy.orm import Session as DatabaseSession
    from sqlalchemy.orm import sessionmaker

    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.dify_builder.execution_policy import BuilderExecutionContext, JsonToolExecutionContext
    from core.dify_builder.models import ConversationItem, Turn
    from core.dify_builder.ports import DifyPort
    from models.account import Account
    from models.model import App
    from services.dify_builder.dify_port import _BuilderExecutionLaunch
    from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
    from services.dify_builder.json_tool_metadata import InstalledJsonParse
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
    assert cast(dict[str, object], recovered["recovery"])["recovery_class"] == drift
    actions = cast(list[dict[str, object]], recovered["actions"])
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


@pytest.mark.parametrize("phase", ["prepare", "native_generator", "native_launch"])
@pytest.mark.parametrize("presentation", ["layout", "selection", "configuration", "fixture_revision"])
def test_canvas_presentation_survives_the_service_worker_port_and_native_admission_chain(
    owned: Owned, monkeypatch: pytest.MonkeyPatch, phase: str, presentation: str
) -> None:
    """Use real admission/claim owners; stop before native graph effects, with unknown execution evidence."""
    import core.app.apps.workflow.app_generator as native
    import services.dify_builder.dify_port as port_module
    from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService

    factory, actor, app, workflow, _sid, _tid = owned
    configuration: BuilderGraph = graph(http=True)
    configuration["nodes"][0]["data"]["variables"] = [
        {"variable": "n", "label": "Number", "type": "number", "required": True}
    ]
    workflow.graph = json.dumps(configuration)
    with factory.begin() as db:
        _row(db, Workflow, workflow.id).graph = workflow.graph
    repository = SqlDifyBuilderRepository(factory)
    session = Session(
        app_id=app.id,
        tenant_id=actor.tenant_id,
        owner_account_id=actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_AWAIT_TESTDATA,
    )
    revision = execution_revision(workflow)
    graph_revision = executable_graph_revision(dict(workflow.graph_dict))
    repository.create_session(session, DifyBuilderContext(last_snapshot_hash=revision), [])
    sid = session.id
    port = port_module.WorkflowServiceDifyPort()
    events: list[dict[str, object]] = []
    released: list[str] = []
    queued: list[Action] = []
    admitted: list[_BuilderExecutionLaunch] = []
    runs: list[Run] = []
    execution_test_input_id = ""
    monkeypatch.setattr(port_module, "_session_factory", lambda: factory)
    monkeypatch.setattr(
        port_module, "_load_draft_workflow_or_raise", lambda _app, *, session: session.get(Workflow, workflow.id)
    )
    monkeypatch.setattr(port_module, "set_login_user", lambda _: None)
    monkeypatch.setattr(worker, "_build_repo", lambda: repository)
    monkeypatch.setattr(worker, "WorkflowServiceDifyPort", lambda: port)
    monkeypatch.setattr(worker, "build_dify_builder_agent", lambda **_: StubAgent())
    monkeypatch.setattr(worker.progress_bus, "publish", lambda _sid, event: events.append(event))
    monkeypatch.setattr(worker.session_lock, "exists", lambda _sid: False)
    monkeypatch.setattr(worker.session_lock, "acquire", lambda _sid: "queued-token")
    monkeypatch.setattr(worker.session_lock, "release", lambda _sid, token: released.append(token))
    monkeypatch.setattr(native, "db", SimpleNamespace(engine=factory.kw["bind"]))
    monkeypatch.setattr(native, "TraceQueueManager", MagicMock())
    monkeypatch.setattr(native, "DifyCoreRepositoryFactory", MagicMock())
    generator = native.WorkflowAppGenerator(execution_driver=Mock())
    monkeypatch.setattr(generator, "_generate", lambda **kwargs: kwargs)
    monkeypatch.setattr(port, "run_draft", _capture_run(port.run_draft, runs))

    def change_canvas() -> None:
        with factory.begin() as db:
            if presentation == "fixture_revision":
                test_input = _row(db, DifyBuilderTestInput, execution_test_input_id)
                assert isinstance(test_input.http_fixtures, dict)
                test_input.http_fixtures = {**test_input.http_fixtures, "execution_revision": "d" * 64}
                return
            current = _row(db, Workflow, workflow.id)
            original_hash = current.unique_hash
            graph = dict(current.graph_dict)
            if presentation == "layout":
                graph["nodes"][0]["position"] = {"x": 500, "y": 800}
                graph["viewport"] = {"x": 40, "y": 30, "zoom": 1.2}
            elif presentation == "selection":
                for node in graph["nodes"]:
                    node["data"]["selected"] = True
            else:
                graph["nodes"][1]["data"]["url"] = "https://changed.invalid"
            current.graph = json.dumps(graph)
            assert current.unique_hash != original_hash
            if presentation == "configuration":
                assert execution_revision(current) != revision
                assert executable_graph_revision(dict(current.graph_dict)) != graph_revision
            else:
                assert execution_revision(current) == revision
                assert executable_graph_revision(dict(current.graph_dict)) == graph_revision

    original_prepare = BuilderExecutionPolicyService.prepare

    def prepare(
        policy: BuilderExecutionPolicyService, **kwargs: Unpack[_PrepareArguments]
    ) -> BuilderExecutionContext | JsonToolExecutionContext:
        nonlocal execution_test_input_id
        execution_test_input_id = kwargs["test_input_id"]
        if phase == "prepare":
            change_canvas()
        return original_prepare(
            policy,
            session_id=kwargs["session_id"],
            test_input_id=kwargs["test_input_id"],
            app_id=kwargs["app_id"],
            actor=kwargs["actor"],
            workflow=kwargs["workflow"],
            submitted_inputs=kwargs["submitted_inputs"],
            effective_inputs=kwargs["effective_inputs"],
        )

    monkeypatch.setattr(BuilderExecutionPolicyService, "prepare", prepare)

    def generate(**kwargs: Unpack[_GenerateArguments]) -> dict[str, object]:
        if phase == "native_generator":
            change_canvas()
        with factory() as db:
            current = _row(db, Workflow, workflow.id)
        launch = kwargs["builder_execution_admit"]
        generated = generator.generate(
            app_model=kwargs["app_model"],
            workflow=current,
            user=kwargs["user"],
            args=kwargs["args"],
            invoke_from=kwargs["invoke_from"],
            builder_execution=kwargs["builder_execution"],
            builder_execution_admit=launch,
            streaming=True,
            call_depth=0,
        )
        if phase == "native_launch":
            change_canvas()
            with factory() as db:
                current = _row(db, Workflow, workflow.id)
        assert isinstance(generated, Mapping)
        entity = generated["application_generate_entity"]
        assert isinstance(entity, WorkflowAppGenerateEntity)
        launch(current, app, entity, "start", False)
        # The native factory and Graph.init recheck raw node bindings too.
        from core.app.entities.app_invoke_entities import UserFrom, build_dify_run_context
        from core.workflow.node_factory import DifyNodeFactory
        from graphon.graph import Graph
        from graphon.runtime import InitParams, RuntimeState, VariablePool

        configuration = current.graph_dict
        node_factory = DifyNodeFactory(
            init_params=InitParams(
                workflow_id=current.id,
                graph_config=configuration,
                call_depth=0,
                run_context=build_dify_run_context(
                    tenant_id=actor.tenant_id,
                    app_id=app.id,
                    user_id=actor.account_id,
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=kwargs["invoke_from"],
                    builder_execution=launch.context,
                ),
            ),
            runtime_state=RuntimeState(variable_pool=VariablePool(), start_at=0, workflow_id=current.id),
            execution_recorder=launch.recorder,
        )
        Graph.init(graph_config=configuration, node_factory=node_factory, root_node_id="start")
        admitted.append(launch)
        return {}

    monkeypatch.setattr(port_module.AppGenerateService, "generate", generate)
    service = DifyBuilderService(
        repository,
        worker.session_lock,
        lambda _sid, action, _actor, _token: queued.append(action),
        get_app_revision_fn=lambda app_id, actor: port.read_graph(app_id, actor)[1],
        stamp_http_fixtures_fn=port.stamp_http_fixtures,
    )
    view = service.get_session_view(sid, actor)
    service.submit_action(
        sid,
        actor,
        Action(
            kind="provide_testdata",
            payload={
                "mode": "provide",
                "inputs": {"n": "41"},
                "http_fixtures": [fixture().model_dump(mode="json")],
            },
            base_version=view.version,
            base_app_revision=revision,
        ),
    )
    worker.advance_session(sid, asdict(queued.pop()), asdict(actor), "queued-token")

    assert events[-1]["kind"] == "command_finished"
    assert not any(event["kind"] == "error" for event in events)
    assert released == ["queued-token"]
    _stored, context = repository.get_session(sid)
    stored_run = repository.get_run(context.verify_run_id)
    assert len(runs) == 1
    run = runs[0]
    if presentation in {"configuration", "fixture_revision"}:
        assert admitted == []
        assert run.execution_refusal is not None
        assert run.execution_refusal.reason_code in {
            "stale_execution_revision",
            "node_binding_mismatch",
            "stale_http_fixtures",
        }
        from core.dify_builder.verification import publication_decision

        assert not publication_decision(
            stored_run, session_id=sid, current_revision=revision, current_graph_revision=graph_revision
        ).allowed
        return
    assert len(admitted) == 1
    assert admitted[0].recorder is not None
    assert admitted[0].context.execution_revision == revision
    assert admitted[0].context.graph_revision == graph_revision
    from services.dify_builder.execution_contracts import BuilderExecutionContext

    assert isinstance(admitted[0].context, BuilderExecutionContext)
    assert admitted[0].context.http_fixtures == (fixture(),)
    assert run.execution_refusal is None
    # Admission alone is never presented as a verified native execution.
    assert run.verification is not None
    assert run.verification.execution_evidence is not None
    assert stored_run.verification is not None
    assert stored_run.verification.execution_evidence is not None
    assert run.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"
    assert stored_run.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"


@pytest.mark.parametrize("phase", ["prepare", "revalidate"])
@pytest.mark.parametrize("change", ["layout", "selection", "configuration", "session_version", "inputs", "fixtures"])
def test_json_metadata_io_rechecks_execution_configuration_and_owned_state(
    owned: Owned, monkeypatch: pytest.MonkeyPatch, phase: str, change: str
) -> None:
    """JSON's post-I/O owner check must retain the same presentation exemption and ownership fences."""
    from services.dify_builder import execution_policy_service as policy_module
    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, JsonToolExecutionContext
    from tests.unit_tests.services.dify_builder.test_json_tool_execution_admission import GRAPH_FIXTURE
    from tests.unit_tests.services.dify_builder.test_json_tool_metadata import _installation, _owners

    factory, actor, app, workflow, sid, tid = owned
    _owners(monkeypatch, installations=[_installation(tenant_id=actor.tenant_id)])
    workflow.graph = GRAPH_FIXTURE.read_text()
    inputs = {"payload": '{"x":"value"}', "json_path": "$.x"}
    with factory.begin() as db:
        _row(db, Workflow, workflow.id).graph = workflow.graph
        _row(db, DifyBuilderTestInput, tid).inputs = inputs
    service = policy_module.BuilderExecutionPolicyService(factory)

    def prepare() -> JsonToolExecutionContext:
        result = service.prepare(
            session_id=sid,
            test_input_id=tid,
            app_id=app.id,
            actor=actor,
            workflow=workflow,
            submitted_inputs=inputs,
            effective_inputs=inputs,
        )
        assert isinstance(result, JsonToolExecutionContext)
        return result

    context = prepare() if phase == "revalidate" else None
    original = policy_module.resolve_installed_json_parse

    def resolve_with_concurrent_change(*, tenant_id: str) -> InstalledJsonParse:
        with factory.begin() as db:
            if change == "session_version":
                _row(db, DifyBuilderSession, sid).version += 1
            elif change == "inputs":
                _row(db, DifyBuilderTestInput, tid).inputs = {**inputs, "payload": "{}"}
            elif change == "fixtures":
                _row(db, DifyBuilderTestInput, tid).http_fixtures = {}
            else:
                current = _row(db, Workflow, workflow.id)
                graph = dict(current.graph_dict)
                if change == "layout":
                    graph["nodes"][1]["position"] = {"x": 999, "y": 123}
                    graph["viewport"] = {"x": 60, "y": 20, "zoom": 0.8}
                elif change == "selection":
                    for node in graph["nodes"]:
                        node["data"]["selected"] = True
                else:
                    graph["nodes"][1]["data"]["tool_configurations"]["ensure_ascii"] = False
                current.graph = json.dumps(graph)
        return original(tenant_id=tenant_id)

    monkeypatch.setattr(policy_module, "resolve_installed_json_parse", resolve_with_concurrent_change)

    def revalidate() -> None:
        assert context is not None
        service.revalidate(
            context=context,
            workflow=workflow,
            app=app,
            actor_id=actor.account_id,
            effective_inputs=inputs,
            root_node_id="node1",
            call_depth=0,
            transport="in_process",
            resume=False,
        )

    operation = prepare if phase == "prepare" else revalidate
    if change in {"layout", "selection"}:
        result = operation()
        if phase == "prepare":
            assert result is not None
            context = result
        # Also compare the now-reloaded canvas with the original admitted
        # bindings, as the real native generator and node factory do later.
        with factory() as db:
            workflow = _row(db, Workflow, workflow.id)
        monkeypatch.setattr(policy_module, "resolve_installed_json_parse", original)
        revalidate()
        assert context is not None
        assert context.execution_revision == execution_revision(workflow)
        with factory() as db:
            assert _row(db, DifyBuilderExecutionRequest, context.request_id).state == "prepared"
    else:
        with pytest.raises(BuilderExecutionPolicyError, match="stale_execution_revision"):
            operation()
        with factory() as db:
            assert db.query(DifyBuilderExecutionRequest).count() == (1 if phase == "revalidate" else 0)
