"""Independent task controls use SQL history rather than the advance lease."""

import pytest

from core.dify_builder.errors import ConflictError
from core.dify_builder.models import DifyBuilderContext, EntryMode, Session
from core.dify_builder.state import PcState
from tests.unit_tests.services.dify_builder.test_service import ACCOUNT_ID, APP_ID, TENANT_ID, _actor

pytest_plugins = ["tests.unit_tests.services.dify_builder.test_service"]


def seed(repo, state=PcState.BUILD_TEST_AND_REPAIR):
    s = Session(
        app_id=APP_ID, tenant_id=TENANT_ID, owner_account_id=ACCOUNT_ID, entry_mode=EntryMode.BUILD, current_state=state
    )
    repo.create_session(s, DifyBuilderContext(goal_text="keep goal", checkpoint_id="checkpoint"), [])
    return s


def test_stop_during_advance_preserves_checkpoint_and_fences_generation(service, repo, lock):
    s = seed(repo)
    lock.acquire(s.id)
    view = service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop-one")
    assert str(view.run_status) == "paused"
    assert not view.canvas_read_only
    _, fc = repo.get_session(s.id)
    assert fc.checkpoint_id == "checkpoint"
    assert fc.goal_text == "keep goal"
    assert fc.paused
    assert service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop-one").version == view.version
    with pytest.raises(ConflictError):
        service.resume_task(s.id, _actor(), base_version=1, client_action_id="stop-one")


def test_stop_accepts_progress_but_old_stop_cannot_pause_resumed_generation(service, repo):
    s = seed(repo, PcState.BUILD_PLAN_APPROVAL)
    service._read_task_dsl_fn = lambda *_: ({"graph": {"nodes": [], "edges": []}, "features": {}}, "new-revision")
    _, fc = repo.get_session(s.id)
    repo.compare_and_advance(s.id, 1, s.current_state, fc, [])
    stopped = service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop")
    service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    assert not repo.get_session(s.id)[1].paused
    with pytest.raises(ConflictError):
        service.stop_task(s.id, _actor(), base_version=1, client_action_id="old-stop")
    before_replay = repo.get_session(s.id)[0].version
    replay = service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop")
    assert replay.version == stopped.version
    assert repo.get_session(s.id)[0].version == before_replay


def test_resume_enqueue_failure_is_retryable_without_duplicate_command(service, repo, enqueued):
    s = seed(repo, PcState.BUILD_PLAN_APPROVAL)
    service._read_task_dsl_fn = lambda *_: ({"graph": {"nodes": [], "edges": []}}, "current")
    stopped = service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop")
    enqueue = service._enqueue_fn
    service._enqueue_fn = lambda *_: (_ for _ in ()).throw(RuntimeError("queue unavailable"))
    with pytest.raises(RuntimeError, match="queue unavailable"):
        service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    service._enqueue_fn = enqueue
    service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    assert len(enqueued) == 1
    service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    assert len(enqueued) == 1


def test_stop_replay_returns_durable_original_projection_after_resume(service, repo):
    s = seed(repo, PcState.BUILD_PLAN_APPROVAL)
    service._read_task_dsl_fn = lambda *_: ({"graph": {"nodes": [], "edges": []}}, "current")
    service._get_app_revision_fn = lambda *_: "original"
    stopped = service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop")
    service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    service._get_app_revision_fn = lambda *_: "edited-after-ack"
    from dataclasses import asdict

    assert asdict(service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop")) == asdict(stopped)


def test_blocked_provider_late_result_cannot_be_consumed(service, repo):
    from types import SimpleNamespace

    from services.dify_builder.agent.llm import invoke_text
    from services.dify_builder.task_controls import ExecutionFence, execution_scope, require_active

    s = seed(repo)
    consumed = []

    class Model:
        def invoke_llm(self, **_kwargs):
            service.stop_task(s.id, _actor(), base_version=1, client_action_id="blocked-stop")
            return SimpleNamespace(message=SimpleNamespace(get_text_content=lambda: consumed.append("late") or "late"))

    fence = ExecutionFence(s.id, 0, lambda: require_active(repo, s.id, 0), {})
    with execution_scope(fence), pytest.raises(ConflictError):
        invoke_text(Model(), system="system", user="user")
    assert consumed == []


def test_continuation_delivery_is_claimed_once_and_old_finally_keeps_new_owner(service, repo, lock, enqueued):
    from services.dify_builder.task_control_service import claim_continuation

    s = seed(repo, PcState.BUILD_PLAN_APPROVAL)
    service._read_task_dsl_fn = lambda *_: ({"graph": {}}, "revision")
    old_token = lock.acquire(s.id)
    old_owner = lock.activate(s.id, old_token)
    stopped = service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop")
    service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    action = enqueued[0][1]
    new_owner = lock.current_owner(s.id)
    assert new_owner is not None
    lock.release(s.id, old_owner)
    assert lock.current_owner(s.id) == new_owner
    claim_continuation(repo, s.id, _actor(), action)
    from types import SimpleNamespace

    from services.dify_builder.task_control_service import refresh_continuation

    refresh_continuation(
        repo, SimpleNamespace(read_task_dsl=lambda *_: ({"graph": {}}, "revision")), s.id, _actor(), action
    )
    with pytest.raises(ConflictError):
        claim_continuation(repo, s.id, _actor(), action)
    lock.release(s.id, new_owner)
    service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    assert len(enqueued) == 1


def test_stopped_generation_rejects_sql_mutation_even_with_unchanged_app_revision(service, repo):
    from services.dify_builder.task_controls import ExecutionFence, execution_scope, lock_execution

    s = seed(repo)
    service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop")
    with execution_scope(ExecutionFence(s.id, 0, lambda: None, {})):
        with repo._session_factory() as sql, sql.begin(), pytest.raises(ConflictError):
            lock_execution(sql, app_id=APP_ID)


def test_internal_continuation_cannot_enter_through_public_action(service, repo):
    from core.dify_builder.errors import BadRequestError
    from core.dify_builder.models import Action

    s = seed(repo, PcState.BUILD_PLAN_APPROVAL)
    with pytest.raises(BadRequestError, match="not allowed"):
        service.submit_action(s.id, _actor(), Action(kind="task_continue", base_version=1))


@pytest.mark.parametrize(
    ("outcome", "status", "expected", "editable"),
    [
        ("cancelled", "terminal", "paused", True),
        ("unknown", "terminal", "failed", False),
        (None, "running", "processing", False),
    ],
)
def test_native_stop_settlement_is_truthful_and_unknown_never_resumes(
    service, repo, outcome, status, expected, editable
):
    from uuid import uuid4

    from models.dify_builder import DifyBuilderExecutionRequest
    from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt

    s = seed(repo)
    _, fc = repo.get_session(s.id)
    fc.test_input_ref = str(uuid4())
    base = repo.compare_and_advance(s.id, 1, s.current_state, fc, [])
    request_id = str(uuid4())
    with repo._session_factory() as sql, sql.begin():
        sql.add(
            DifyBuilderExecutionRequest(
                id=request_id,
                tenant_id=TENANT_ID,
                actor_id=ACCOUNT_ID,
                app_id=APP_ID,
                workflow_id=str(uuid4()),
                session_id=s.id,
                test_input_id=fc.test_input_ref,
                context={"policy_version": "builder-native-test-v1"},
                context_digest="a" * 64,
                state="running",
            )
        )
    receipt = NativeTestPublicReceipt(
        request_id=request_id,
        generation=0,
        version=1,
        status=status,
        wait_reason=None,
        native_run_id=None,
        native_status=None,
        pending=(),
        outcome=outcome,
        evidence_refs=(),
    )

    class Actions:
        def current(self, **_kwargs):
            return receipt

        def execute(self, **kwargs):
            assert kwargs["command"].method == "cancel"
            assert kwargs["idempotency_key"] == "task-stop:stop"
            return receipt

    service._test_actions = Actions()
    view = service.stop_task(s.id, _actor(), base_version=base, client_action_id="stop")
    assert str(view.run_status) == expected
    assert view.canvas_read_only is not editable
    if outcome != "cancelled":
        service._read_task_dsl_fn = lambda *_: ({"graph": {}}, "revision")
        with pytest.raises(ConflictError, match="settled"):
            service.resume_task(s.id, _actor(), base_version=view.version, client_action_id="resume")


def test_resume_preserves_goal_inputs_checkpoint_and_passes_complete_dsl_to_cognition(service, repo, enqueued):
    from types import SimpleNamespace

    from services.dify_builder.agent.llm import invoke_text
    from services.dify_builder.task_controls import ExecutionFence, execution_scope

    s = seed(repo, PcState.BUILD_PLAN_APPROVAL)
    _, fc = repo.get_session(s.id)
    fc.test_input_ref = "old-input"
    fc.effect_confirmation = {"http": "old-consent"}
    base = repo.compare_and_advance(s.id, 1, s.current_state, fc, [])
    dsl = {
        "graph": {"nodes": [{"id": "model", "data": {"model": {"name": "new-model"}}}]},
        "features": {"file_upload": {"enabled": True}},
        "environment_variables": [{"name": "region", "value": "new-region"}],
        "conversation_variables": [{"name": "message", "value": "new-message"}],
    }
    service._read_task_dsl_fn = lambda *_: (dsl, "changed")
    stopped = service.stop_task(s.id, _actor(), base_version=base, client_action_id="stop")
    service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    _, fresh = repo.get_session(s.id)
    assert fresh.goal_text == "keep goal"
    assert fresh.checkpoint_id == "checkpoint"
    assert fresh.retained_test_input_ref == "old-input"
    assert fresh.test_input_ref == ""
    assert fresh.effect_confirmation == {}
    prompts = []

    class Model:
        def invoke_llm(self, **kwargs):
            prompts.extend(kwargs["prompt_messages"])
            return SimpleNamespace(message=SimpleNamespace(get_text_content=lambda: "ok"))

    with execution_scope(ExecutionFence(s.id, 1, lambda: None, fresh.task_control["dsl"])):
        invoke_text(Model(), system="system", user="continue")
    assert all(value in str(prompts[-1].content) for value in ["new-model", "file_upload", "new-region", "new-message"])
    assert enqueued[0][1].execution_generation == 1


def test_pending_stop_get_reconciles_terminal_evidence_without_cancelling_again(service, repo):
    from uuid import uuid4

    from models.dify_builder import DifyBuilderExecutionRequest
    from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt

    s = seed(repo)
    _, fc = repo.get_session(s.id)
    fc.test_input_ref = str(uuid4())
    base = repo.compare_and_advance(s.id, 1, s.current_state, fc, [])
    request_id = str(uuid4())
    with repo._session_factory() as sql, sql.begin():
        sql.add(
            DifyBuilderExecutionRequest(
                id=request_id,
                tenant_id=TENANT_ID,
                actor_id=ACCOUNT_ID,
                app_id=APP_ID,
                workflow_id=str(uuid4()),
                session_id=s.id,
                test_input_id=fc.test_input_ref,
                context={"policy_version": "builder-native-test-v1"},
                context_digest="a" * 64,
                state="running",
            )
        )
    current = NativeTestPublicReceipt(
        request_id=request_id,
        generation=0,
        version=1,
        status="running",
        wait_reason=None,
        native_run_id=None,
        native_status=None,
        pending=(),
        outcome=None,
        evidence_refs=(),
    )
    calls = []

    class Actions:
        def current(self, **_kwargs):
            return current

        def execute(self, **_kwargs):
            calls.append("cancel")
            return current

    service._test_actions = Actions()
    stopped = service.stop_task(s.id, _actor(), base_version=base, client_action_id="stop")
    assert str(stopped.run_status) == "processing"
    current = current.model_copy(update={"status": "terminal", "outcome": "cancelled"})
    view = service.get_session_view(s.id, _actor())
    assert str(view.run_status) == "paused"
    assert not view.canvas_read_only
    assert calls == ["cancel"]
    history = service.get_conversation_page(s.id, _actor(), limit=20)
    assert history.data == []


def test_resume_rejects_autosave_between_dsl_read_and_reservation(service, repo):
    import json

    from models.workflow import Workflow
    from services.dify_builder.task_controls import draft_binding

    s = seed(repo, PcState.BUILD_PLAN_APPROVAL)
    with repo._session_factory() as sql, sql.begin():
        workflow = Workflow(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            type="workflow",
            version="draft",
            created_by=ACCOUNT_ID,
            graph=json.dumps({"nodes": [], "edges": []}),
            features="{}",
            environment_variables=[],
            conversation_variables=[],
        )
        sql.add(workflow)
        sql.flush()
        workflow_id = workflow.id
        binding = draft_binding(workflow)
    stopped = service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop")

    def read_then_autosave(*_args):
        with repo._session_factory() as sql, sql.begin():
            workflow = sql.get(Workflow, workflow_id)
            workflow.features = '{"edited":true}'
        return {"graph": {}, "_draft_binding": {"workflow_id": workflow_id, "digest": binding}}, "old"

    service._read_task_dsl_fn = read_then_autosave
    with pytest.raises(ConflictError, match="synchronizing"):
        service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    assert repo.get_session(s.id)[1].paused


def test_retest_after_resume_mints_new_input_and_builder_run_without_consent(service, repo, enqueued):
    from datetime import datetime

    from core.dify_builder.models import Action, Run, TestInput, Turn
    from services.dify_builder.application.handlers_build import build_registry
    from services.dify_builder.application.placeholder_agent import PlaceholderAgent
    from services.dify_builder.application.runner import Env, Runner
    from services.dify_builder.task_control_service import claim_continuation
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    s = seed(repo)
    old_input = TestInput(session_id=s.id, inputs={}, source="upload")
    repo.save_test_input(old_input)
    old_run = Run(kind="test", inputs_ref=old_input.id, status="stopped", immutable=True, dify_run_id="old-native")
    repo.save_run(s.id, old_run)
    _, fc = repo.get_session(s.id)
    fc.test_input_ref, fc.verify_run_id = old_input.id, old_run.id
    fc.effect_confirmation = {"http": "old"}
    base = repo.compare_and_advance(s.id, 1, s.current_state, fc, [])
    port = FakeBuildDifyPort()
    service._read_task_dsl_fn = lambda *_: ({"graph": port.graph}, port.hash)
    stopped = service.stop_task(s.id, _actor(), base_version=base, client_action_id="stop")
    service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    continuation = enqueued[0][1]
    claim_continuation(repo, s.id, _actor(), continuation)
    runner = Runner(Env(dify=port, repo=repo, agent=PlaceholderAgent(), now=lambda: datetime.min), build_registry())
    runner.advance(s.id, Turn(actor=_actor(), action=continuation))
    current, _ = repo.get_session(s.id)
    assert current.current_state == PcState.BUILD_AWAIT_TESTDATA
    runner.advance(
        s.id,
        Turn(
            actor=_actor(),
            action=Action(
                kind="provide_testdata", payload={"inputs": {}}, base_version=current.version, command_id="new-test"
            ),
        ),
    )
    _, fresh = repo.get_session(s.id)
    assert fresh.test_input_ref != old_input.id
    assert fresh.verify_run_id != old_run.id
    assert repo.get_run(old_run.id).status == "stopped"
    assert repo.get_run(old_run.id).immutable
    assert port.run_draft_effect_confirmation == {}


def test_stop_captures_late_old_generation_lease_and_resume_keeps_new_owner(service, repo, lock, monkeypatch):
    s = seed(repo, PcState.BUILD_PLAN_APPROVAL)
    transact = repo.control_transaction
    old_owner = None
    inject = True

    def transaction(session_id, change):
        def late_acquire(sql, session, fc):
            nonlocal inject, old_owner
            if inject:
                inject = False
                old_owner = lock.acquire(s.id, generation=0)
            return change(sql, session, fc)

        return transact(session_id, late_acquire)

    monkeypatch.setattr(repo, "control_transaction", transaction)
    stopped = service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop")
    assert not lock.exists(s.id)
    service._read_task_dsl_fn = lambda *_: ({"graph": {}}, "current")
    service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    owner = lock.current_owner(s.id)
    assert owner.startswith("g1:")
    lock.release(s.id, old_owner)
    assert lock.current_owner(s.id) == owner


def test_stale_queued_action_cannot_bind_to_new_resumed_generation(service, repo):
    from core.dify_builder.models import Action

    s = seed(repo, PcState.BUILD_PLAN_APPROVAL)
    stopped = service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop")
    service._read_task_dsl_fn = lambda *_: ({"graph": {}}, "current")
    service.resume_task(s.id, _actor(), base_version=stopped.version, client_action_id="resume")
    action = Action(kind="approve_repair", base_version=1)
    with pytest.raises(ConflictError):
        service.dispatch(s.id, action, _actor())
    assert action.execution_generation == 0


def test_actual_action_stream_closes_on_stop_of_blocked_command(service, repo, monkeypatch):
    import json

    from core.dify_builder.models import Action
    from services.dify_builder import progress_bus

    s = seed(repo, PcState.BUILD_PLAN_APPROVAL)
    monkeypatch.setattr(progress_bus, "publish_native_change", lambda *_: None)

    class Subscription:
        closed = False

        def receive(self, **_kwargs):
            service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop-active")
            return json.dumps({"kind": "native_state_changed", "session_id": s.id}).encode()

        def close(self):
            self.closed = True

    sub = Subscription()
    service._subscribe_fn = lambda *_: sub
    frames = list(service.submit_action_stream(s.id, _actor(), Action(kind="approve_repair", base_version=1)))
    decoded = [json.loads(frame.split("data: ", 1)[1]) for frame in frames if "data: " in frame]
    assert [frame["event"] for frame in decoded] == ["command_started", "command_finished"]
    assert decoded[-1]["data"]["run_status"] == "paused"
    assert decoded[-1]["data"]["command_id"] == decoded[0]["data"]["command_id"]
    assert sub.closed


def test_actual_wired_command_stream_reads_after_request_context_teardown(repo, monkeypatch):
    from types import SimpleNamespace

    from flask import Flask, current_app

    from core.dify_builder.models import Action
    from services.dify_builder import wiring
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    s = seed(repo, PcState.BUILD_PLAN_APPROVAL)
    app = Flask("task-control-stream")

    class Subscription:
        def receive(self, **_kwargs):
            return None

        def close(self):
            pass

    lock = FakeSessionLock()
    monkeypatch.setattr(wiring, "db", SimpleNamespace(engine=repo._session_factory.kw["bind"]))
    monkeypatch.setattr(wiring, "session_lock", lock)
    monkeypatch.setattr(wiring, "_enqueue", lambda *_: None)
    monkeypatch.setattr(wiring, "_build_test_actions", lambda: None)

    def read_revision(*_args):
        assert current_app._get_current_object() is app
        return app.name

    monkeypatch.setattr(wiring, "_authorize_app", read_revision)
    monkeypatch.setattr(wiring, "_get_app_revision", read_revision)
    monkeypatch.setattr(wiring, "_get_verification_identity", lambda *_: (read_revision(), "graph"))
    monkeypatch.setattr(wiring.progress_bus, "subscribe", lambda *_: Subscription())
    monkeypatch.setattr(wiring.progress_bus, "publish_native_change", lambda *_: None)
    with app.test_request_context("/"):
        service = wiring.build_service()
        stream = service.submit_action_stream(
            s.id, _actor(), Action(kind="approve_repair", base_version=1, base_app_revision=app.name)
        )
        service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop-after-stream")
    frames = list(stream)
    assert '"run_status": "paused"' in frames[-1]
    assert "command_finished" in frames[-1]


def test_legacy_flag_only_pause_resumes_through_dsl_owner(service, repo, enqueued):
    from core.dify_builder.models import Action

    s = seed(repo, PcState.BUILD_REVIEW)
    _, fc = repo.get_session(s.id)
    fc.paused = True
    base = repo.compare_and_advance(s.id, 1, s.current_state, fc, [])
    dsl = {"graph": {"nodes": []}, "features": {"edited": True}}
    service._read_task_dsl_fn = lambda *_: (dsl, "edited")
    view = service.submit_action(s.id, _actor(), Action(kind="resume", base_version=base))
    assert str(view.run_status) == "processing"
    _, resumed = repo.get_session(s.id)
    assert not resumed.paused
    assert resumed.task_control["dsl"] == dsl
    assert resumed.checkpoint_id == "checkpoint"
    assert enqueued[0][1].kind == "task_continue"


def test_direct_native_admission_rejects_stopped_task_without_worker_context(service, repo):
    from services.dify_builder.task_controls import lock_task_admission

    s = seed(repo)
    service.stop_task(s.id, _actor(), base_version=1, client_action_id="stop")
    with repo._session_factory() as sql, sql.begin(), pytest.raises(ConflictError, match="paused"):
        lock_task_admission(sql, s.id)


def test_resume_response_receipt_cannot_invalidate_running_worker_cas(tmp_path, monkeypatch):
    from dataclasses import asdict
    from threading import Event, Thread

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
    from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
    from models.base import Base
    from services.dify_builder.agent.llm import invoke_text
    from services.dify_builder.application.runner import StepResult
    from services.dify_builder.repository import SqlDifyBuilderRepository
    from services.dify_builder.service import DifyBuilderService
    from tasks import dify_builder_advance_task as task
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    engine = create_engine(f"sqlite:///{tmp_path / 'resume-race.db'}")
    Base.metadata.create_all(engine)
    repository = SqlDifyBuilderRepository(sessionmaker(engine, expire_on_commit=False))
    lock = FakeSessionLock()
    entered, release = Event(), Event()
    workers = []
    failures = []
    port = FakeBuildDifyPort()
    port.read_task_dsl = lambda *_: ({"graph": port.graph}, port.hash)

    class Model:
        def invoke_llm(self, **_kwargs):
            entered.set()
            assert release.wait(5)
            return LLMResult(
                model="barrier", message=AssistantPromptMessage(content="continued"), usage=LLMUsage.empty_usage()
            )

    def cognition(_env, _turn, _session, context):
        invoke_text(Model(), system="continue", user="continue")
        return StepResult(next=PcState.BUILD_REVIEW, context=context)

    monkeypatch.setattr(task, "_build_repo", lambda: repository)
    monkeypatch.setattr(task, "_build_test_actions", lambda _: None)
    monkeypatch.setattr(task, "WorkflowServiceDifyPort", lambda: port)
    monkeypatch.setattr(task, "build_dify_builder_agent", lambda **_: StubAgent())
    monkeypatch.setattr(task, "build_registry", lambda: {PcState.BUILD_INITIAL_PLAN: cognition})
    monkeypatch.setattr(task, "fix_registry", dict)
    monkeypatch.setattr(task, "edit_registry", dict)
    monkeypatch.setattr(task.session_lock, "activate", lock.activate)
    monkeypatch.setattr(task.session_lock, "release", lock.release)
    monkeypatch.setattr(task.progress_bus, "publish", lambda *_: None)
    monkeypatch.setattr(task.progress_bus, "publish_native_change", lambda *_: None)
    monkeypatch.setattr(task.progress_snapshot, "save", lambda *_args, **_kwargs: None)

    def enqueue(session_id, action, actor, token):
        def work():
            try:
                task.advance_session(session_id, asdict(action), asdict(actor), token)
            except BaseException as error:
                failures.append(error)

        worker = Thread(target=work)
        workers.append(worker)
        worker.start()
        assert entered.wait(5)

    service = DifyBuilderService(repository, lock, enqueue, read_task_dsl_fn=port.read_task_dsl)
    session = seed(repository, PcState.BUILD_PLAN_APPROVAL)
    stopped = service.stop_task(session.id, _actor(), base_version=1, client_action_id="stop")
    try:
        resumed = service.resume_task(session.id, _actor(), base_version=stopped.version, client_action_id="resume")
        assert str(resumed.run_status) == "processing"
        assert resumed.canvas_read_only
    finally:
        release.set()
        for worker in workers:
            worker.join(5)
    assert not any(worker.is_alive() for worker in workers)
    assert failures == []
    head, context = repository.get_session(session.id)
    assert head.current_state == PcState.BUILD_REVIEW
    assert context.task_control["receipt"]["enqueue"] == "settled"
    assert service.resume_task(session.id, _actor(), base_version=stopped.version, client_action_id="resume") == resumed
    assert len(workers) == 1
    engine.dispose()
