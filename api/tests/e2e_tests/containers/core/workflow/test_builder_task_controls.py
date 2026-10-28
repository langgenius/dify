"""Task controls fence the real draft transaction, independently of Redis leases.

Only scheduling and post-commit notification are in-memory. The control service,
repository, adapter, WorkflowService writes, row locks and CAS all use PostgreSQL.
The dedicated container deliberately avoids the shared native runtime stack.
"""

from __future__ import annotations

import json
import socket
import threading
import time
from collections.abc import Callable, Generator, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from copy import deepcopy
from dataclasses import asdict, dataclass
from typing import Literal, cast
from uuid import uuid4

import pytest
from flask import Flask
from psycopg2 import extensions as pg_extensions
from sqlalchemy import Connection, Engine, create_engine, event, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.core.wait_strategies import ExecWaitStrategy
from testcontainers.postgres import PostgresContainer

from core.dify_builder.contract import SessionView
from core.dify_builder.errors import ConflictError
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Graph, MutationIntent
from core.dify_builder.models import Session as DomainSession
from core.dify_builder.state import PcState
from extensions.ext_database import db
from models.account import Account
from models.agent import WorkflowAgentNodeBinding
from models.base import Base
from models.dify_builder import (
    DifyBuilderConversationItem,
    DifyBuilderExecutionRequest,
    DifyBuilderRun,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
)
from models.model import App, AppMode
from models.trigger import WorkflowWebhookTrigger
from models.workflow import Workflow
from models.workflow_draft_coordination import WorkflowDraftCoordination
from services.dify_builder import dify_port
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import DifyBuilderService
from services.dify_builder.task_controls import ExecutionFence, execution_scope
from services.workflow_service import WorkflowService
from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

_TIMEOUT = 15
_GENERATION = 7
Mutation = Literal["restore", "repair"]
type Enqueued = tuple[str, Action, Actor, str]


@pytest.fixture(scope="module")
def task_postgres_engine() -> Iterator[Engine]:
    """A disposable PostgreSQL database; never read local application DB config."""
    container = PostgresContainer("postgres:14-alpine", tmpfs={"/var/lib/postgresql/data": "rw,size=256m"})
    # Match the migration witnesses: Docker Desktop's empty HostPort mapping
    # can accept and reset TCP connections. Bind an OS-selected IPv4 port.
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    bind = cast(Callable[[int, tuple[str, int]], object], container.with_bind_ports)
    bind(5432, ("127.0.0.1", port))
    container.waiting_for(
        ExecWaitStrategy(
            [
                "sh",
                "-c",
                'PGPASSWORD="$POSTGRES_PASSWORD" psql --username "$POSTGRES_USER" '
                '--dbname "$POSTGRES_DB" --host 127.0.0.1 -tAc "SELECT 1"',
            ]
        ).with_startup_timeout(30)
    )
    with container:
        engine = create_engine(
            make_url(container.get_connection_url()).set(host="127.0.0.1"),
            connect_args={"connect_timeout": 5, "options": "-c statement_timeout=15000 -c lock_timeout=15000"},
            pool_size=5,
            max_overflow=0,
        )
        try:
            assert engine.dialect.name == "postgresql"
            Base.metadata.create_all(
                engine,
                tables=[
                    Base.metadata.tables[model.__tablename__]
                    for model in (
                        Account,
                        App,
                        Workflow,
                        WorkflowDraftCoordination,
                        WorkflowAgentNodeBinding,
                        WorkflowWebhookTrigger,
                        DifyBuilderSession,
                        DifyBuilderSessionCommit,
                        DifyBuilderConversationItem,
                        DifyBuilderExecutionRequest,
                        DifyBuilderRun,
                    )
                ],
            )
            yield engine
        finally:
            engine.dispose()


@pytest.fixture
def task_flask_app(task_postgres_engine: Engine) -> Generator[Flask]:
    # Combined native tests register real draft-sync signal receivers. They
    # require an app context, including on the worker thread, and must use this
    # disposable database rather than whichever native app ran previously.
    app = Flask("builder-task-postgres")
    app.config["SQLALCHEMY_DATABASE_URI"] = task_postgres_engine.url.render_as_string(hide_password=False)
    db.init_app(app)
    with app.app_context():
        try:
            assert db.engine.url == task_postgres_engine.url
            yield app
        finally:
            db.session.remove()
            db.engine.dispose()


@dataclass
class TaskWorld:
    flask_app: Flask
    factory: sessionmaker[Session]
    repo: SqlDifyBuilderRepository
    service: DifyBuilderService
    actor: Actor
    app_id: str
    workflow_id: str
    session_id: str
    graph: Graph
    revision: str
    enqueued: list[Enqueued]

    def mutate(self, mutation: Mutation, *, generation: int = _GENERATION) -> object:
        # Deliberately model a worker that already passed its advisory check.
        # The transaction's persisted fence must remain sufficient on its own.
        with (
            self.flask_app.app_context(),
            execution_scope(ExecutionFence(self.session_id, generation, lambda: None, {})),
        ):
            port = WorkflowServiceDifyPort()
            if mutation == "restore":
                graph = deepcopy(self.graph)
                graph["nodes"][0]["data"]["title"] = "Old worker wrote this"
                return port.restore_graph(self.app_id, self.actor, graph, expected_revision=self.revision)
            return port.apply_repair(
                self.app_id,
                self.actor,
                [
                    MutationIntent(
                        op="set_node_config",
                        args={
                            "node_id": "start",
                            "path": "title",
                            "value": "Old worker wrote this",
                        },
                    )
                ],
                expected_revision=self.revision,
            )

    def draft(self) -> Graph:
        with self.factory() as sql:
            workflow = sql.get(Workflow, self.workflow_id)
            assert workflow is not None
            return dict(workflow.graph_dict)

    def stop(self, *, key: str = "stop") -> SessionView:
        with self.flask_app.app_context():
            return self.service.stop_task(self.session_id, self.actor, base_version=1, client_action_id=key)


@pytest.fixture
def task_world(task_postgres_engine: Engine, task_flask_app: Flask, monkeypatch: pytest.MonkeyPatch) -> TaskWorld:
    factory = sessionmaker(bind=task_postgres_engine, expire_on_commit=False)
    # Inject the disposable DB at existing adapter seams. Both objects still run
    # their real production methods; no mutation or authorization is replaced.
    monkeypatch.setattr(dify_port, "_session_factory", lambda: factory)
    monkeypatch.setattr(dify_port, "WorkflowService", lambda: WorkflowService(session_maker=factory))
    monkeypatch.setattr(dify_port, "notify_workflow_draft_changed", lambda *_args, **_kwargs: None)
    account = Account(name="Task fence owner", email=f"{uuid4()}@example.invalid")
    tenant_id = str(uuid4())
    graph: Graph = {
        "nodes": [
            {
                "id": "start",
                "type": "custom",
                "position": {"x": 0, "y": 0},
                "data": {"type": "start", "title": "Retained draft", "variables": []},
            },
            {
                "id": "end",
                "type": "custom",
                "position": {"x": 300, "y": 0},
                "data": {"type": "end", "title": "End", "outputs": []},
            },
        ],
        "edges": [
            {"id": "start-end", "source": "start", "target": "end", "sourceHandle": "source", "targetHandle": "target"}
        ],
    }
    with factory.begin() as sql:
        sql.add(account)
        sql.flush()
        app = App(tenant_id=tenant_id, name="Task fence", mode=AppMode.WORKFLOW, enable_site=False, enable_api=False)
        sql.add(app)
        sql.flush()
        workflow = Workflow.new(
            tenant_id=tenant_id,
            app_id=app.id,
            type="workflow",
            version="draft",
            graph=json.dumps(graph),
            features="{}",
            created_by=account.id,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        sql.add(workflow)
        sql.flush()
    repo = SqlDifyBuilderRepository(factory)
    domain = DomainSession(
        app_id=app.id,
        tenant_id=tenant_id,
        owner_account_id=account.id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_INITIAL_PLAN,
    )
    repo.create_session(
        domain,
        DifyBuilderContext(
            goal_text="Retain my work",
            checkpoint_id=str(uuid4()),
            task_control={"generation": _GENERATION},
        ),
        [],
    )
    actor = Actor(account_id=account.id, tenant_id=tenant_id)
    port = WorkflowServiceDifyPort()
    revision = port.read_graph(app.id, actor)[1]
    enqueued: list[Enqueued] = []

    def enqueue(session_id: str, action: Action, actor: Actor, token: str) -> None:
        enqueued.append((session_id, action, actor, token))

    service = DifyBuilderService(
        repo=repo,
        session_lock=FakeSessionLock(),
        enqueue_fn=enqueue,
        get_app_revision_fn=lambda app_id, actor: port.read_graph(app_id, actor)[1],
    )
    return TaskWorld(
        task_flask_app, factory, repo, service, actor, app.id, workflow.id, domain.id, graph, revision, enqueued
    )


def _session_lock_statement(statement: str) -> bool:
    return "FROM dify_builder_sessions" in statement and "FOR UPDATE" in statement


def _backend_pid(connection: Connection) -> int:
    driver = connection.connection.driver_connection
    assert isinstance(driver, pg_extensions.connection)
    return driver.get_backend_pid()


@pytest.mark.parametrize("mutation", ["restore", "repair"])
def test_stop_commits_before_old_worker_actual_draft_write(task_world: TaskWorld, mutation: Mutation) -> None:
    world = task_world
    at_write_fence, continue_worker = threading.Event(), threading.Event()
    role: ContextVar[Literal["worker"] | None] = ContextVar("sql_role", default=None)

    def before_sql(
        _connection: Connection, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        if role.get() == "worker" and _session_lock_statement(statement):
            at_write_fence.set()
            assert continue_worker.wait(_TIMEOUT), "worker was not released from the write barrier"

    def worker() -> object:
        role.set("worker")
        return world.mutate(mutation)

    engine = world.factory.kw["bind"]
    event.listen(engine, "before_cursor_execute", before_sql)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(worker)
            try:
                assert at_write_fence.wait(_TIMEOUT), "actual adapter never reached the SQL mutation fence"
                stopped = world.stop()
                assert stopped.run_status == "paused"
                assert not stopped.canvas_read_only
                assert world.draft() == world.graph
            finally:
                continue_worker.set()
            with pytest.raises(ConflictError, match="stopped or superseded"):
                future.result(timeout=_TIMEOUT)
        assert world.draft() == world.graph
        assert world.repo.get_session(world.session_id)[1].paused
    finally:
        continue_worker.set()
        event.remove(engine, "before_cursor_execute", before_sql)


@pytest.mark.parametrize("mutation", ["restore", "repair"])
def test_old_worker_draft_commit_before_stop_is_retained(task_world: TaskWorld, mutation: Mutation) -> None:
    world = task_world
    worker_has_lock, finish_worker, stop_attempting_lock = (threading.Event() for _ in range(3))
    role: ContextVar[Literal["worker", "stop"] | None] = ContextVar("sql_role", default=None)
    pids: dict[str, int] = {}
    worker_locks: list[str] = []

    def before_sql(
        connection: Connection, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        if role.get() == "stop" and _session_lock_statement(statement):
            pids["stop"] = _backend_pid(connection)
            stop_attempting_lock.set()

    def after_sql(
        connection: Connection, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        if role.get() != "worker" or "FOR UPDATE" not in statement:
            return
        if _session_lock_statement(statement):
            pids["worker"] = _backend_pid(connection)
            worker_locks.append("session")
            worker_has_lock.set()
            assert finish_worker.wait(_TIMEOUT), "worker was not released while holding the session row"
        elif "FROM workflows" in statement:
            worker_locks.append("workflow")

    def worker() -> object:
        role.set("worker")
        return world.mutate(mutation)

    def stop() -> SessionView:
        role.set("stop")
        return world.stop()

    engine = world.factory.kw["bind"]
    event.listen(engine, "before_cursor_execute", before_sql)
    event.listen(engine, "after_cursor_execute", after_sql)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            writer = pool.submit(worker)
            try:
                assert worker_has_lock.wait(_TIMEOUT), "adapter never acquired the persisted execution fence"
                stopper = pool.submit(stop)
                assert stop_attempting_lock.wait(_TIMEOUT), "Stop never attempted its session lock"
                # Witness the *database* wait, not just a submitted Python task.
                # There is no sleep or scheduling-dependent winning assertion.
                with engine.connect() as observer:
                    deadline = time.monotonic() + _TIMEOUT
                    blockers: list[int] = []
                    while time.monotonic() < deadline:
                        observed = observer.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": pids["stop"]})
                        assert observed is not None
                        blockers = observed
                        if pids["worker"] in blockers:
                            break
                    assert pids["worker"] in blockers, "PostgreSQL did not serialize Stop behind the actual writer"
                assert not stopper.done()
            finally:
                finish_worker.set()
            writer.result(timeout=_TIMEOUT)
            stopped = stopper.result(timeout=_TIMEOUT)
        assert stopped.run_status == "paused"
        assert worker_locks[:2] == ["session", "workflow"]
        expected = deepcopy(world.graph)
        expected["nodes"][0]["data"]["title"] = "Old worker wrote this"
        assert world.draft() == expected
        assert world.repo.get_session(world.session_id)[1].paused
    finally:
        finish_worker.set()
        event.remove(engine, "before_cursor_execute", before_sql)
        event.remove(engine, "after_cursor_execute", after_sql)


@pytest.mark.parametrize("mutation", ["restore", "repair"])
def test_resumed_generation_rejects_old_worker_even_at_current_revision(
    task_world: TaskWorld, mutation: Mutation
) -> None:
    world = task_world
    stopped = world.stop()
    with world.factory.begin() as sql:
        workflow = sql.get(Workflow, world.workflow_id)
        assert workflow is not None
        workflow.features = json.dumps({"opening_statement": "Edited while paused"})
    # Keep the graph/revision current: only the generation mismatch can reject it.
    world.revision = WorkflowServiceDifyPort().read_graph(world.app_id, world.actor)[1]
    resumed = world.service.resume_task(
        world.session_id,
        world.actor,
        base_version=stopped.version,
        client_action_id="resume",
    )
    domain, context = world.repo.get_session(world.session_id)
    # This enqueue only records a delivery: exactly one dispatch reservation
    # follows the pinned ACK, and no worker can advance the session head.
    assert domain.version == resumed.version + 1
    receipt = world.repo.find_task_control(world.session_id, "resume")
    assert receipt is not None
    assert receipt["version"] == resumed.version
    assert receipt["view"] == asdict(resumed)
    _, acknowledged_context = world.repo.get_session_at_version(world.session_id, resumed.version)
    assert acknowledged_context.task_control["receipt"]["view"] == asdict(resumed)
    assert acknowledged_context.task_control["receipt"]["enqueue"] == "pending"
    assert acknowledged_context.task_control["generation"] == _GENERATION + 1
    assert not acknowledged_context.paused
    assert not context.paused
    assert context.task_control["generation"] == _GENERATION + 1
    assert context.task_control["dsl"]["features"]["opening_statement"] == "Edited while paused"
    assert len(world.enqueued) == 1
    queued_session, action, queued_actor, _token = world.enqueued[0]
    assert queued_session == world.session_id
    assert queued_actor == world.actor
    assert action.base_version == domain.version
    assert action.command_id == "resume"
    assert action.execution_generation == _GENERATION + 1
    assert receipt["enqueue"] == "dispatching"
    assert receipt["delivery_id"]
    assert action.payload["task_control_delivery"] == receipt["delivery_id"]
    with pytest.raises(ConflictError, match="stopped or superseded"):
        world.mutate(mutation)
    assert world.draft() == world.graph
    # A current-generation writer is a positive control for the same SQL path.
    world.mutate(mutation, generation=_GENERATION + 1)
    assert world.draft()["nodes"][0]["data"]["title"] == "Old worker wrote this"


def test_late_worker_session_cas_cannot_overwrite_durable_stop(task_world: TaskWorld) -> None:
    world = task_world
    old, old_context = world.repo.get_session(world.session_id)
    stopped = world.stop()
    with pytest.raises(ConflictError, match="stale base_version"):
        world.repo.compare_and_advance(world.session_id, old.version, PcState.BUILD_EXECUTION, old_context, [])
    current, context = world.repo.get_session(world.session_id)
    assert current.version == stopped.version
    assert current.current_state == old.current_state
    assert context.paused
    assert context.checkpoint_id == old_context.checkpoint_id
    assert context.goal_text == old_context.goal_text
    with world.factory() as sql:
        assert (
            sql.scalar(
                select(func.count())
                .select_from(DifyBuilderSessionCommit)
                .where(
                    DifyBuilderSessionCommit.session_id == world.session_id,
                    DifyBuilderSessionCommit.version > stopped.version,
                )
            )
            == 0
        )


def test_control_receipt_replay_survives_resume_without_new_commit(task_world: TaskWorld) -> None:
    world = task_world
    stopped = world.stop()
    assert asdict(world.stop()) == asdict(stopped)
    world.service.resume_task(
        world.session_id,
        world.actor,
        base_version=stopped.version,
        client_action_id="resume",
    )
    current, context = world.repo.get_session(world.session_id)
    assert not context.paused
    assert asdict(world.stop()) == asdict(stopped)
    assert world.repo.get_session(world.session_id)[0].version == current.version
    receipt = world.repo.find_task_control(world.session_id, "stop")
    assert receipt is not None
    assert receipt["view"] == asdict(stopped)
    with pytest.raises(ConflictError, match="different intent"):
        world.service.stop_task(world.session_id, world.actor, base_version=current.version, client_action_id="stop")
    with pytest.raises(ConflictError, match="superseded"):
        world.stop(key="old-generation-stop")
    assert not world.repo.get_session(world.session_id)[1].paused
    assert world.repo.get_session(world.session_id)[0].version == current.version


def test_simultaneous_same_stop_identity_commits_one_durable_projection(task_world: TaskWorld) -> None:
    world = task_world
    both_at_lock = threading.Barrier(2, timeout=_TIMEOUT)
    arrived: ContextVar[bool] = ContextVar("arrived_at_sql_lock", default=False)

    def before_sql(
        _connection: Connection, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        if not arrived.get() and _session_lock_statement(statement):
            arrived.set(True)
            both_at_lock.wait()

    engine = world.factory.kw["bind"]
    event.listen(engine, "before_cursor_execute", before_sql)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(world.stop)
            second = pool.submit(world.stop)
            first_view = first.result(timeout=_TIMEOUT)
            second_view = second.result(timeout=_TIMEOUT)
        assert asdict(first_view) == asdict(second_view)
        current, context = world.repo.get_session(world.session_id)
        assert current.version == first_view.version
        assert context.paused
        assert context.task_control["generation"] == _GENERATION
        assert context.task_control["receipt"]["view"] == asdict(first_view)
        assert world.draft() == world.graph
    finally:
        event.remove(engine, "before_cursor_execute", before_sql)
