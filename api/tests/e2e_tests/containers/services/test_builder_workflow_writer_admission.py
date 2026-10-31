"""Cross-session Builder admission against isolated PostgreSQL and Redis.

The queue is captured instead of running a model or workflow. PostgreSQL
session commits and the production Redis lease are real. Native App metadata
writes and session CAS verify SQL fencing; no model or workflow nodes run.
"""

from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from threading import Barrier, Lock
from uuid import uuid4

import pytest
from redis import Redis
from sqlalchemy import create_engine, update
from sqlalchemy.orm import Session as SqlSession
from sqlalchemy.orm import sessionmaker
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

from core.dify_builder.errors import BusyError, ConflictError
from core.dify_builder.models import Action, Actor
from core.dify_builder.state import PcState
from extensions import ext_redis
from extensions.ext_redis import RedisClientWrapper
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import Base
from models.dify_builder import (
    DifyBuilderCheckpoint,
    DifyBuilderConversationItem,
    DifyBuilderExecutionRequest,
    DifyBuilderRun,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderSnapshot,
    DifyBuilderTestInput,
    DifyBuilderWorkflowWriter,
)
from models.model import App, AppMode
from services.dify_builder import session_lock
from services.dify_builder.app_metadata import NativeAppMetadata
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import DifyBuilderService
from services.dify_builder.task_controls import ExecutionFence, execution_scope, require_active

type Infrastructure = tuple[sessionmaker[SqlSession], Redis[bytes]]
type Enqueued = tuple[str, Action, Actor, str]


@dataclass
class Harness:
    repo: SqlDifyBuilderRepository
    service: DifyBuilderService
    factory: sessionmaker[SqlSession]
    redis: Redis[bytes]
    queued: list[Enqueued] = field(default_factory=list)

    def create_tenant(self) -> str:
        with self.factory.begin() as sql:
            tenant = Tenant(name="Isolated Builder concurrency test")
            sql.add(tenant)
            sql.flush()
            return tenant.id

    def create_actor(self, tenant_id: str) -> Actor:
        with self.factory.begin() as sql:
            account = Account(name="Builder tester", email=f"{uuid4()}@example.invalid")
            sql.add(account)
            sql.flush()
            sql.add(TenantAccountJoin(tenant_id=tenant_id, account_id=account.id, role=TenantAccountRole.EDITOR))
            return Actor(account_id=account.id, tenant_id=tenant_id)

    def create_app(self, owner: Actor) -> str:
        with self.factory.begin() as sql:
            app = App(
                tenant_id=owner.tenant_id,
                name="Isolated Builder concurrency test",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=False,
                created_by=owner.account_id,
                updated_by=owner.account_id,
            )
            sql.add(app)
            sql.flush()
            return app.id


@pytest.fixture(scope="module")
def infrastructure() -> Iterator[Infrastructure]:
    # Two disposable service containers only; never point at the user's Local stack.
    with PostgresContainer("postgres:14-alpine") as postgres, RedisContainer("redis:6-alpine") as redis:
        engine = create_engine(postgres.get_connection_url())
        tables = [
            Base.metadata.tables[model.__tablename__]
            for model in (
                Tenant,
                Account,
                TenantAccountJoin,
                App,
                DifyBuilderSession,
                DifyBuilderWorkflowWriter,
                DifyBuilderSessionCommit,
                DifyBuilderConversationItem,
                DifyBuilderCheckpoint,
                DifyBuilderExecutionRequest,
                DifyBuilderRun,
                DifyBuilderSnapshot,
                DifyBuilderTestInput,
            )
        ]
        Base.metadata.create_all(engine, tables=tables)
        client: Redis[bytes] = Redis(host=redis.get_container_host_ip(), port=int(redis.get_exposed_port(6379)))
        assert client.ping()
        yield sessionmaker(bind=engine, expire_on_commit=False), client
        client.close()
        engine.dispose()


@pytest.fixture
def harness(infrastructure: Infrastructure, monkeypatch: pytest.MonkeyPatch) -> Iterator[Harness]:
    factory, client = infrastructure
    wrapper = RedisClientWrapper()
    wrapper.initialize(client)
    monkeypatch.setattr(session_lock, "redis_client", wrapper)
    monkeypatch.setattr(ext_redis, "_pubsub_redis_client", client)
    repo = SqlDifyBuilderRepository(factory)
    queued: list[Enqueued] = []
    queue_lock = Lock()

    def enqueue(session_id: str, action: Action, actor: Actor, token: str) -> None:
        with queue_lock:
            queued.append((session_id, action, actor, token))

    # This admission-focused harness does not call the model, Celery, or an
    # external permission service. These values are known synthetic fixtures.
    service = DifyBuilderService(
        repo=repo,
        session_lock=session_lock,
        enqueue_fn=enqueue,
        cognition_policy_fn=lambda _actor, _config: {
            "provider": "synthetic/provider",
            "name": "synthetic-model",
            "mode": "chat",
            "completion_params": {},
        },
        get_app_revision_fn=lambda _app, _actor: "synthetic-draft-revision",
    )
    yield Harness(repo=repo, service=service, factory=factory, redis=client, queued=queued)
    # Isolated container and randomly generated identities: only remove leases
    # created by this fixture; never flush the user's Redis or delete data.
    for sid, _action, _actor, token in queued:
        session_lock.release(sid, token)


def test_two_sessions_for_same_workflow_cannot_both_dispatch(harness: Harness) -> None:
    tenant = harness.create_tenant()
    owner, other_editor = harness.create_actor(tenant), harness.create_actor(tenant)
    app = harness.create_app(owner)
    barrier = Barrier(2, timeout=15)

    def start(editor: Actor) -> tuple[str, str | None, str | None]:
        barrier.wait()
        try:
            view = harness.service.create_build_session(app, editor, "Synthetic goal")
            return ("accepted", view.session_id, view.run_status)
        except (BusyError, ConflictError):
            return ("busy", None, None)

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(start, (owner, other_editor)))

    assert sorted(outcome[0] for outcome in outcomes) == ["accepted", "busy"], outcomes
    assert len(harness.queued) == 1
    assert session_lock.exists(harness.queued[0][0])


def test_different_workflows_and_tenants_can_dispatch_independently(harness: Harness) -> None:
    tenant_a, tenant_b = harness.create_tenant(), harness.create_tenant()
    owner_a, owner_b = harness.create_actor(tenant_a), harness.create_actor(tenant_b)
    app_a, app_b, app_other = harness.create_app(owner_a), harness.create_app(owner_a), harness.create_app(owner_b)
    views = [
        harness.service.create_build_session(app_a, owner_a, "First workflow"),
        harness.service.create_build_session(app_b, owner_a, "Second workflow"),
        harness.service.create_build_session(app_other, owner_b, "Other tenant"),
    ]
    assert len({view.session_id for view in views}) == 3
    assert all(view.run_status == "processing" for view in views)
    assert len(harness.queued) == 3


@pytest.mark.parametrize("paused", [False, True], ids=["waiting", "paused"])
def test_existing_waiting_or_paused_session_does_not_block_new_command(harness: Harness, paused: bool) -> None:
    tenant = harness.create_tenant()
    owner = harness.create_actor(tenant)
    other_editor = harness.create_actor(tenant)
    app = harness.create_app(owner)
    sid, _action = harness.service._prepare_build_session(app, owner, "First synthetic goal")
    existing, context = harness.repo.get_session(sid)
    context.paused = paused
    harness.repo.compare_and_advance(sid, existing.version, PcState.BUILD_PLAN_APPROVAL, context, [])

    current = harness.service.create_build_session(app, other_editor, "Second synthetic goal")

    assert current.run_status == "processing"
    assert len(harness.queued) == 1


def test_unknown_enqueue_ack_keeps_writer_until_explicit_stop(harness: Harness) -> None:
    tenant = harness.create_tenant()
    owner = harness.create_actor(tenant)
    app = harness.create_app(owner)
    original_enqueue = harness.service._enqueue_fn

    def fail_enqueue(*_args: object) -> None:
        raise RuntimeError("synthetic enqueue rejected")

    harness.service._enqueue_fn = fail_enqueue
    sid, action = harness.service._prepare_build_session(app, owner, "First synthetic goal")
    assert action is not None
    with pytest.raises(RuntimeError, match="synthetic enqueue rejected"):
        harness.service.dispatch(sid, action, owner)
    harness.service._enqueue_fn = original_enqueue
    with pytest.raises((BusyError, ConflictError)):
        harness.service.create_build_session(app, owner, "Second synthetic goal")
    existing, _ = harness.repo.get_session(sid)
    harness.service.stop_task(sid, owner, base_version=existing.version, client_action_id=str(uuid4()))

    current = harness.service.create_build_session(app, owner, "Second synthetic goal")
    assert current.run_status == "processing"
    assert len(harness.queued) == 1


def test_lost_enqueue_ack_cannot_open_second_writer_after_worker_claim(harness: Harness) -> None:
    tenant = harness.create_tenant()
    owner = harness.create_actor(tenant)
    app = harness.create_app(owner)
    original_enqueue = harness.service._enqueue_fn
    claimed: list[tuple[str, str]] = []

    def claim_then_lose_ack(session_id: str, _action: Action, _actor: Actor, token: str) -> None:
        # The worker's actual Redis claim wins before the sender observes an
        # error. No worker body, external operation, or automatic replay runs.
        worker_owner = session_lock.activate(session_id, token)
        assert worker_owner is not None
        claimed.append((session_id, worker_owner))
        raise RuntimeError("synthetic enqueue acknowledgement lost")

    harness.service._enqueue_fn = claim_then_lose_ack
    try:
        with pytest.raises(RuntimeError, match="synthetic enqueue acknowledgement lost"):
            harness.service.create_build_session(app, owner, "First synthetic goal")
        harness.service._enqueue_fn = original_enqueue

        with pytest.raises((BusyError, ConflictError)):
            harness.service.create_build_session(app, owner, "Independent second goal")
        assert len(claimed) == 1
        assert session_lock.exists(claimed[0][0])
    finally:
        harness.service._enqueue_fn = original_enqueue
        for session_id, worker_owner in claimed:
            session_lock.release(session_id, worker_owner)


def test_replacement_writer_fences_late_sql_write_after_redis_lease_loss(harness: Harness) -> None:
    tenant = harness.create_tenant()
    first_actor, second_actor = harness.create_actor(tenant), harness.create_actor(tenant)
    app_id = harness.create_app(first_actor)
    first = harness.service.create_build_session(app_id, first_actor, "First synthetic goal")
    old_owner = session_lock.activate(first.session_id, harness.queued[0][3])
    assert old_owner is not None

    # This is a disposable Redis container dedicated to the tests. Removing
    # its leases simulates lease expiry or Redis loss while an old worker may
    # still have a late result. It never touches the user's Local Redis.
    harness.redis.flushdb()
    # Expire the durable lease in this isolated database as well: Redis loss
    # alone conservatively retains the writer until Stop or durable expiry.
    with harness.factory.begin() as sql:
        sql.execute(
            update(DifyBuilderWorkflowWriter)
            .where(
                DifyBuilderWorkflowWriter.session_id == first.session_id,
            )
            .values(expires_at=datetime.now() - timedelta(days=1))
        )
    harness.service.create_build_session(app_id, second_actor, "Second synthetic goal")

    fence = ExecutionFence(
        session_id=first.session_id,
        generation=0,
        check=lambda: require_active(harness.repo, first.session_id, 0),
        dsl={},
    )
    with execution_scope(fence):
        # The real native metadata writer calls lock_execution inside its own
        # transaction; its best-effort refusal may return an empty string.
        NativeAppMetadata(harness.factory).describe_empty_app(
            app_id=app_id,
            tenant_id=tenant,
            account_id=first_actor.account_id,
            description="late result must not commit",
        )

    with harness.factory() as sql:
        app = sql.get(App, app_id)
        assert app is not None
        assert app.description == ""


def test_stop_and_old_owner_cannot_release_replacement_workflow_writer(harness: Harness) -> None:
    tenant = harness.create_tenant()
    first_actor, second_actor = harness.create_actor(tenant), harness.create_actor(tenant)
    app = harness.create_app(first_actor)
    first = harness.service.create_build_session(app, first_actor, "First synthetic goal")
    old_token = harness.queued[0][3]

    harness.service.stop_task(first.session_id, first_actor, base_version=first.version, client_action_id=str(uuid4()))
    paused, context = harness.repo.get_session(first.session_id)
    assert context.paused
    assert paused.version > first.version
    second = harness.service.create_build_session(app, second_actor, "Second synthetic goal")
    session_lock.release(first.session_id, old_token)

    with pytest.raises((BusyError, ConflictError)):
        harness.service.create_build_session(app, first_actor, "Third synthetic goal")
    assert session_lock.exists(second.session_id)


def test_redis_loss_alone_keeps_durable_writer(harness: Harness) -> None:
    tenant = harness.create_tenant()
    owner = harness.create_actor(tenant)
    app = harness.create_app(owner)
    first = harness.service.create_build_session(app, owner, "First goal")
    harness.redis.flushdb()
    with pytest.raises((BusyError, ConflictError)):
        harness.service.create_build_session(app, owner, "Second goal")
    assert harness.repo.is_task_active(first.session_id, 0, harness.queued[0][3])


def test_replacement_between_redis_and_sql_activation_refuses_old_worker(harness: Harness) -> None:
    tenant = harness.create_tenant()
    owner = harness.create_actor(tenant)
    app = harness.create_app(owner)
    first = harness.service.create_build_session(app, owner, "First goal")
    old_token = harness.queued[0][3]
    old_owner = session_lock.activate(first.session_id, old_token)
    assert old_owner is not None
    # The worker has claimed Redis but has not extended SQL ownership yet.
    harness.redis.flushdb()
    with harness.factory.begin() as sql:
        sql.execute(
            update(DifyBuilderWorkflowWriter)
            .where(
                DifyBuilderWorkflowWriter.session_id == first.session_id,
            )
            .values(expires_at=datetime.now() - timedelta(days=1))
        )
    replacement = harness.service.create_build_session(app, owner, "Second goal")
    replacement_token = harness.queued[-1][3]

    assert not harness.repo.activate_workflow_writer(first.session_id, old_token, 60)
    with pytest.raises(ConflictError):
        require_active(harness.repo, first.session_id, 0, writer_token=old_token)
    harness.repo.release_workflow_writer(first.session_id, token=old_token)
    session_lock.release(first.session_id, old_owner)
    assert harness.repo.is_task_active(replacement.session_id, 0, replacement_token)
    with pytest.raises((BusyError, ConflictError)):
        harness.service.create_build_session(app, owner, "Third goal")


def test_expired_same_session_token_cannot_commit_late_native_write(harness: Harness) -> None:
    from core.dify_builder.models import Action

    tenant = harness.create_tenant()
    owner = harness.create_actor(tenant)
    app_id = harness.create_app(owner)
    first = harness.service.create_build_session(app_id, owner, "First goal")
    old_token = harness.queued[0][3]
    harness.redis.flushdb()
    with harness.factory.begin() as sql:
        sql.execute(
            update(DifyBuilderWorkflowWriter)
            .where(
                DifyBuilderWorkflowWriter.session_id == first.session_id,
            )
            .values(expires_at=datetime.now() - timedelta(days=1))
        )
    harness.service.dispatch(first.session_id, Action(kind="start_build", base_version=first.version), owner)
    assert harness.queued[-1][3] != old_token
    fence = ExecutionFence(first.session_id, 0, lambda: None, {}, writer_token=old_token)
    with execution_scope(fence):
        NativeAppMetadata(harness.factory).describe_empty_app(
            app_id=app_id,
            tenant_id=tenant,
            account_id=owner.account_id,
            description="stale same session result",
        )
    with harness.factory() as sql:
        app = sql.get(App, app_id)
        assert app is not None
        assert app.description == ""
    # Positive control: the same writer/DB fixture accepts the current owner.
    current = ExecutionFence(first.session_id, 0, lambda: None, {}, writer_token=harness.queued[-1][3])
    with execution_scope(current):
        assert (
            NativeAppMetadata(harness.factory).describe_empty_app(
                app_id=app_id,
                tenant_id=tenant,
                account_id=owner.account_id,
                description="current owner description",
            )
            == "current owner description"
        )
    with harness.factory() as sql:
        app = sql.get(App, app_id)
        assert app is not None
        assert app.description == "current owner description"


def test_workflow_writer_migration_upgrade_and_downgrade(infrastructure: Infrastructure) -> None:
    from importlib import import_module

    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect, text

    factory, _redis = infrastructure
    schema = "writer_migration_" + uuid4().hex
    migration = import_module("migrations.versions.2026_10_30_1200-5b73e0c8f124_builder_workflow_writer")
    with factory.kw["bind"].begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            inspector = inspect(connection)
            assert inspector.get_pk_constraint("dify_builder_workflow_writers")["constrained_columns"] == [
                "tenant_id",
                "app_id",
            ]
            columns = {column["name"]: column for column in inspector.get_columns("dify_builder_workflow_writers")}
            assert set(columns) == {"tenant_id", "app_id", "session_id", "token", "generation", "expires_at"}
            assert all(not column["nullable"] for column in columns.values())
            assert {index["name"] for index in inspector.get_indexes("dify_builder_workflow_writers")} == {
                "builder_workflow_writer_session_idx",
            }
            migration.downgrade()
            assert not inspect(connection).has_table("dify_builder_workflow_writers")
        connection.execute(text(f'DROP SCHEMA "{schema}"'))


def test_replacement_token_fences_sql_session_cas_at_unchanged_version(harness: Harness) -> None:
    from core.dify_builder.models import Action

    tenant = harness.create_tenant()
    owner = harness.create_actor(tenant)
    app_id = harness.create_app(owner)
    first = harness.service.create_build_session(app_id, owner, "First goal")
    old_token = harness.queued[0][3]
    harness.redis.flushdb()
    with harness.factory.begin() as sql:
        sql.execute(
            update(DifyBuilderWorkflowWriter)
            .where(
                DifyBuilderWorkflowWriter.session_id == first.session_id,
            )
            .values(expires_at=datetime.now() - timedelta(days=1))
        )
    harness.service.dispatch(first.session_id, Action(kind="start_build", base_version=first.version), owner)
    session, context = harness.repo.get_session(first.session_id)
    with execution_scope(ExecutionFence(first.session_id, 0, lambda: None, {}, writer_token=old_token)):
        with pytest.raises(ConflictError):
            harness.repo.compare_and_advance(session.id, session.version, PcState.FAILED, context, [])
    stored, _ = harness.repo.get_session(session.id)
    assert stored.version == session.version
    assert stored.current_state == session.current_state
    with execution_scope(ExecutionFence(first.session_id, 0, lambda: None, {}, writer_token=harness.queued[-1][3])):
        version = harness.repo.compare_and_advance(
            session.id, session.version, PcState.BUILD_PLAN_APPROVAL, context, []
        )
    assert version == session.version + 1


def test_clear_fences_sql_inserts_after_a_worker_last_checked(harness: Harness) -> None:
    """A real SQL fence closes the check→insert gap while Redis is released."""
    from threading import Event

    from core.dify_builder.models import Checkpoint, DifyBuilderContext, EntryMode, Run, Session, Snapshot, TestInput
    from services.dify_builder.conversation_lifecycle import clear

    tenant = harness.create_tenant()
    actor = harness.create_actor(tenant)
    app = harness.create_app(actor)
    session = Session(
        app_id=app,
        tenant_id=tenant,
        owner_account_id=actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_PLAN_APPROVAL,
    )
    harness.repo.create_session(session, DifyBuilderContext(goal_text="Synthetic clear race"), [])
    token = harness.service._acquire_workflow_writer(session.id)
    assert token is not None
    checked, cleared = Event(), Event()

    def worker() -> list[str]:
        fence = ExecutionFence(
            session.id,
            0,
            lambda: require_active(harness.repo, session.id, 0, writer_token=token),
            {},
            writer_token=token,
        )
        outcomes = []
        with execution_scope(fence):
            fence.check()
            checked.set()
            assert cleared.wait(15)
            writes = (
                lambda: harness.repo.create_checkpoint(
                    Checkpoint(session_id=session.id, state=session.current_state), Snapshot(session_id=session.id)
                ),
                lambda: harness.repo.save_run(session.id, Run(kind="verify", status="failed")),
                lambda: harness.repo.save_test_input(TestInput(session_id=session.id, inputs={"synthetic": "value"})),
            )
            for write in writes:
                try:
                    write()
                except ConflictError:
                    outcomes.append("fenced")
        return outcomes

    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(worker)
        assert checked.wait(15)
        receipt = clear(
            harness.service, session.id, actor, base_version=1, client_action_id="clear-race", confirmed=True
        )
        cleared.set()
        assert pending.result(timeout=15) == ["fenced", "fenced", "fenced"]
    assert receipt["conversation_cleared"]
    assert not session_lock.exists(session.id)
    assert harness.repo.list_conversation(session.id) == []


def test_first_fix_selection_and_creation_is_serialized_under_app_lock(harness: Harness) -> None:
    from core.dify_builder.models import DifyBuilderContext, EntryMode, Run, Session

    tenant = harness.create_tenant()
    actor = harness.create_actor(tenant)
    app = harness.create_app(actor)
    barrier = Barrier(2, timeout=15)

    def select_or_create(_index: int) -> tuple[str, bool]:
        candidate = Session(
            app_id=app,
            tenant_id=tenant,
            owner_account_id=actor.account_id,
            entry_mode=EntryMode.FIX,
            current_state=PcState.FIX_DIAGNOSE,
        )
        barrier.wait()
        source = Run(
            id=str(uuid4()), kind="original-failed", status="failed", immutable=True, dify_run_id="synthetic-failed"
        )
        session, created = harness.repo.create_fix_session_or_select(
            candidate, DifyBuilderContext(failed_run_id=source.id), [], source_run=source
        )
        _, context = harness.repo.get_session(session.id)
        saved = harness.repo.get_run(context.failed_run_id)
        assert saved.dify_run_id == "synthetic-failed"
        assert saved.origin_task_id == session.id + ":0"
        return session.id, created

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(select_or_create, (0, 1)))
    assert outcomes[0][0] == outcomes[1][0]
    assert sorted(created for _, created in outcomes) == [False, True]
