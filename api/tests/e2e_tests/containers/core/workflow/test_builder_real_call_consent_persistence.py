"""CI-only PostgreSQL row-lock, race and actual-migration controls for real-call consent.

Installed plugin metadata and qualification constants are SYNTHETIC test-only
values exercising exact matching; they attest nothing about a deployed
artifact, and real qualification stays unavailable outside this module. No
provider, OAuth endpoint or credential decryption is reached: the refresh
ciphertext below is an opaque fixture string written by the CAS owner.

The shared container schema comes from ``db.create_all()``. Before this
module's first test, ``migrated_builder_tables`` rebuilds the execution-request
and consent tables in that same database through their actual migrations, so
every race below runs against migration-built constraints, not model metadata.
"""

import importlib.util
import json
import multiprocessing
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from multiprocessing.connection import Connection
from pathlib import Path
from threading import Event, Thread
from time import monotonic, sleep
from types import ModuleType
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from flask import Flask
from sqlalchemy import Engine, create_engine, event, func, inspect, select, text
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import ConnectionPoolEntry, NullPool

from configs import dify_config
from core.dify_builder import gmail_read_policy
from core.dify_builder.errors import ConflictError
from core.dify_builder.execution_policy import (
    BuilderExecutionPolicyError,
    ConfirmedToolExecutionContext,
    validate_execution_context,
)
from core.dify_builder.input_schema import schema_hash, start_schema
from core.dify_builder.models import Actor, ConversationItem, DifyBuilderContext
from core.dify_builder.real_call_consent import (
    ConfirmedToolBinding,
    ConsentReceipt,
    GmailReadParameters,
    InstalledToolBinding,
    Phase,
)
from core.dify_builder.state import PcState
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.plugin_service import PluginService
from models.dify_builder import (
    DifyBuilderExecutionRequest,
    DifyBuilderRealCallConsent,
    DifyBuilderSessionCommit,
    DifyBuilderTestInput,
)
from models.enums import PermissionEnum
from models.model import App
from models.tools import BuiltinToolProvider, ToolOAuthTenantClient
from models.workflow import Workflow
from services.dify_builder import real_call_consent_service, real_call_metadata
from services.dify_builder.real_call_consent_service import BuilderRealCallConsentService
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.revision import execution_revision
from services.dify_builder.serde import context_to_dict
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from tests.test_containers_integration_tests.core.workflow.test_builder_execution_policy_persistence import race
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    native_owner as native_owner,  # noqa: PLC0414 - shared pytest fixture
)

PROVIDER = "langgenius/dify-gmail/dify-gmail"
PLUGIN = "langgenius/dify-gmail"
SECRET = "ci-consent-secret"
# SYNTHETIC test-only artifact; never a reviewed, qualified or deployed revision.
SYNTHETIC_ARTIFACT = f"{PLUGIN}:9.9.9@{'f' * 64}"
SYNTHETIC_SCHEMA = "e" * 64
SYNTHETIC_AUDIT = "synthetic-ci-audit-revision"
APPROVED = GmailReadParameters(message_id="18cab_1", include_body=False, include_attachments=False)
MIGRATION = "migrations/versions/2026_10_11_1200-d82f9a6c31e0_add_builder_real_call_consents.py"
EXECUTION_MIGRATION = "migrations/versions/2026_10_09_1300-c84e6a217b90_add_builder_execution_requests.py"
# Table comments written only by ``migrated_builder_tables`` after each actual migration built the table.
MIGRATED_TABLES = {
    "dify_builder_execution_requests": "ci-alembic:c84e6a217b90",
    "dify_builder_real_call_consents": "ci-alembic:d82f9a6c31e0",
}


def _migration(relative: str, name: str) -> ModuleType:
    path = Path(__file__).parents[4] / relative
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


@pytest.fixture(scope="module", autouse=True)
def migrated_builder_tables(flask_app_with_containers: Flask) -> None:
    """Rebuild the shared database's Builder sidecar tables through their actual migrations.

    Drops the ``create_all`` execution-request and consent tables (no foreign key references
    them; the per-test cleanup leaves them empty) and the request migration's added test-input
    column, then runs the actual ``c84e6a217b90`` and ``d82f9a6c31e0`` ``upgrade()`` against the
    same ``public`` schema every test here uses, and marks each rebuilt table with a comment.
    """
    from extensions.ext_database import db

    execution = _migration(EXECUTION_MIGRATION, "builder_execution_migration_for_ci_tables")
    consent = _migration(MIGRATION, "builder_real_call_consent_migration_for_ci_tables")
    assert (execution.revision, consent.revision, consent.down_revision) == (
        "c84e6a217b90",
        "d82f9a6c31e0",
        "c84e6a217b90",
    )
    with flask_app_with_containers.app_context():
        db.session.remove()
        with db.engine.begin() as connection:
            assert connection.dialect.name == "postgresql"
            connection.execute(text("SET LOCAL lock_timeout = '10s'"))
            connection.execute(text("DROP TABLE IF EXISTS dify_builder_real_call_consents"))
            connection.execute(text("DROP TABLE IF EXISTS dify_builder_execution_requests"))
            connection.execute(text("ALTER TABLE dify_builder_test_inputs DROP COLUMN IF EXISTS http_fixtures"))
            with Operations.context(MigrationContext.configure(connection)):
                execution.upgrade()
                consent.upgrade()
            for table, marker in MIGRATED_TABLES.items():
                connection.execute(text(f"COMMENT ON TABLE {table} IS '{marker}'"))


def gmail_graph(credential_id: str) -> dict[str, object]:
    constant = {"type": "constant"}
    nodes: list[dict[str, object]] = [
        {
            "id": "start",
            "data": {
                "type": "start",
                "title": "Start",
                "variables": [{"variable": "note", "label": "Note", "type": "text-input", "required": False}],
            },
        },
        {
            "id": "tool",
            "data": {
                "type": "tool",
                "title": "Get message",
                "provider_id": PROVIDER,
                "provider_type": "builtin",
                "provider_name": PROVIDER,
                "tool_name": "get_message",
                "tool_label": "Get message",
                "tool_configurations": {},
                "credential_id": credential_id,
                "tool_node_version": "2",
                "tool_parameters": {
                    "message_id": {**constant, "value": APPROVED.message_id},
                    "include_body": {**constant, "value": APPROVED.include_body},
                    "include_attachments": {**constant, "value": APPROVED.include_attachments},
                },
            },
        },
        {
            "id": "end",
            "data": {"type": "end", "title": "End", "outputs": [{"variable": "r", "value_selector": ["tool", "json"]}]},
        },
    ]
    return {"nodes": nodes, "edges": [{"source": a["id"], "target": b["id"]} for a, b in zip(nodes, nodes[1:])]}


class World:
    def __init__(self, factory: sessionmaker[Session], actor: Actor, session_id: str, test_input_id: str) -> None:
        self.factory, self.actor, self.session_id, self.test_input_id = factory, actor, session_id, test_input_id
        self.credential_id = ""
        self.client_id = ""
        self.workflow_id = ""

    def service(self) -> BuilderRealCallConsentService:
        return BuilderRealCallConsentService(self.factory)

    def prepare(self, key: str = "prepare-1") -> ConsentReceipt:
        with self.factory() as db:
            workflow = db.get(Workflow, self.workflow_id)
            assert workflow is not None
            revision = execution_revision(workflow)
        return self.service().prepare(
            actor=self.actor,
            session_id=self.session_id,
            node_id="tool",
            test_input_id=self.test_input_id,
            credential_id=self.credential_id,
            at_version=1,
            base_app_revision=revision,
            idempotency_key=key,
        )

    def confirmed(self) -> ConsentReceipt:
        prepared = self.prepare()
        return self.service().confirm(
            actor=self.actor,
            session_id=self.session_id,
            consent_id=prepared.consent_id,
            decision="confirm",
            scope_digest=prepared.scope_digest,
            at_version=prepared.at_version,
            idempotency_key="confirm-1",
        )

    def reserve(self, receipt: ConsentReceipt, key: str = "execute-1") -> tuple[ConsentReceipt, bool]:
        return self.service().reserve_execution(
            actor=self.actor,
            session_id=self.session_id,
            consent_id=receipt.consent_id,
            scope_digest=receipt.scope_digest,
            at_version=receipt.at_version,
            idempotency_key=key,
        )

    def launched(self) -> tuple[ConsentReceipt, ConfirmedToolExecutionContext, str]:
        reserved, won = self.reserve(self.confirmed())
        assert won is True
        run_id = str(uuid4())
        # Stand-in for Task 6's launch-identity claim; not native Run proof.
        with self.factory.begin() as db:
            request = db.get(DifyBuilderExecutionRequest, reserved.execution_request_id)
            assert request is not None
            request.state, request.native_run_id, request.task_id = "running", run_id, "ci-task"
            context = validate_execution_context(request.context)
        assert isinstance(context, ConfirmedToolExecutionContext)
        return reserved, context, run_id

    def claimed(self) -> tuple[ConsentReceipt, ConfirmedToolBinding]:
        reserved, context, run_id = self.launched()
        binding = self.service().claim_tool(
            context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-execution"
        )
        return reserved, binding

    def consent(self, consent_id: str) -> DifyBuilderRealCallConsent:
        with self.factory() as db:
            row = db.get(DifyBuilderRealCallConsent, consent_id)
            assert row is not None
            return row

    def count(
        self,
        model: type[DifyBuilderRealCallConsent] | type[DifyBuilderExecutionRequest] | type[DifyBuilderSessionCommit],
    ) -> int:
        with self.factory() as db:
            return db.scalar(select(func.count()).select_from(model).where(model.session_id == self.session_id)) or 0

    def reference_revision(self) -> str:
        with self.factory() as db:
            return BuiltinToolManageService.resolve_builder_reference(
                db=db,
                actor=self.actor,
                provider_id=PROVIDER,
                credential_id=self.credential_id,
                verified_plugin=False,
                revision_key=SECRET.encode(),
            ).revision

    def rotate_credential(self, ciphertext: str) -> None:
        # Native credential writer: never takes consent locks.
        with self.factory.begin() as db:
            row = db.get(BuiltinToolProvider, self.credential_id)
            assert row is not None
            row.encrypted_credentials = ciphertext


@pytest.fixture
def world(
    native_owner: tuple[sessionmaker[Session], Actor, App, Workflow, str, str], monkeypatch: pytest.MonkeyPatch
) -> World:
    factory, actor, _app, workflow, session_id, test_input_id = native_owner
    monkeypatch.setattr(dify_config, "SECRET_KEY", SECRET)
    monkeypatch.setattr(dify_config, "DIFY_BUILDER_CONFIRMED_TOOL_ENABLED", True)
    monkeypatch.setattr(gmail_read_policy, "QUALIFIED_GMAIL_ARTIFACT", SYNTHETIC_ARTIFACT)
    monkeypatch.setattr(gmail_read_policy, "QUALIFIED_GMAIL_SCHEMA_DIGEST", SYNTHETIC_SCHEMA)
    monkeypatch.setattr(gmail_read_policy, "GMAIL_SOURCE_AUDIT_REVISION", SYNTHETIC_AUDIT)

    def synthetic_installation(*, tenant_id: str, provider_id: str) -> InstalledToolBinding:
        assert provider_id == PROVIDER
        return InstalledToolBinding(
            tenant_id=tenant_id,
            installation_id="synthetic-installation",
            plugin_id=PLUGIN,
            provider_id=PROVIDER,
            tool_name="get_message",
            unique_identifier=SYNTHETIC_ARTIFACT,
            version="9.9.9",
            checksum="f" * 64,
            schema_digest=SYNTHETIC_SCHEMA,
            source_audit_revision=SYNTHETIC_AUDIT,
            daemon_contract_revision=gmail_read_policy.DAEMON_CONTRACT_REVISION,
            runtime_type="local",
        )

    def unverified(_tenant_id: str, _plugin_unique_identifier: str) -> bool:
        return False

    monkeypatch.setattr(real_call_metadata, "resolve_installed_get_message", synthetic_installation)
    monkeypatch.setattr(PluginService, "is_plugin_verified", unverified)
    state = World(factory, actor, session_id, test_input_id)
    with factory.begin() as db:
        credential = BuiltinToolProvider(
            name="CI mailbox",
            tenant_id=actor.tenant_id,
            user_id=actor.account_id,
            provider=PROVIDER,
            credential_type=CredentialType.OAUTH2,
            encrypted_credentials='{"access_token":"ci-opaque"}',
            expires_at=1_900_000_000,
            visibility=PermissionEnum.ALL_TEAM,
            is_default=False,
        )
        client = ToolOAuthTenantClient(tenant_id=actor.tenant_id, plugin_id=PLUGIN, provider="dify-gmail")
        client.encrypted_oauth_params = '{"client_id":"ci-opaque-client"}'
        client.enabled = True
        db.add_all([credential, client])
        db.flush()
        graph = gmail_graph(credential.id)
        draft = db.get(Workflow, workflow.id)
        assert draft is not None
        draft.graph = json.dumps(graph)
        test_input = db.get(DifyBuilderTestInput, test_input_id)
        assert test_input is not None
        test_input.inputs = {"note": "ci"}
        test_input.start_schema_hash = schema_hash(start_schema(graph))
        db.add(
            DifyBuilderSessionCommit(
                session_id=session_id,
                version=1,
                state=str(PcState.BUILD_AWAIT_TESTDATA),
                context=context_to_dict(DifyBuilderContext(plan_items=["Read one message"])),
                actor="",
            )
        )
        state.credential_id, state.client_id, state.workflow_id = credential.id, client.id, workflow.id
    return state


def both(call: Callable[[], object]) -> list[object]:
    return race(call, call)


def test_postgres_identical_prepare_collision_has_one_row(world: World) -> None:
    results = both(world.prepare)
    assert isinstance(results[0], ConsentReceipt)
    assert results[0] == results[1]
    assert world.count(DifyBuilderRealCallConsent) == 1


def test_postgres_simultaneous_execute_commits_exactly_one_launch(world: World) -> None:
    decision = world.confirmed()
    results = both(lambda: world.reserve(decision))
    flags = sorted(result[1] for result in results if isinstance(result, tuple))
    assert flags == [False, True]
    receipts = [result[0] for result in results if isinstance(result, tuple)]
    assert receipts[0] == receipts[1]
    assert world.count(DifyBuilderExecutionRequest) == 1
    session, fc = SqlDifyBuilderRepository(world.factory).get_session(world.session_id)
    assert session.version == 2
    assert fc.last_command_id == receipts[0].command_id


def test_postgres_execute_with_colliding_keys_has_one_winner(world: World) -> None:
    decision = world.confirmed()
    results = race(lambda: world.reserve(decision, "execute-a"), lambda: world.reserve(decision, "execute-b"))
    winners = [result for result in results if isinstance(result, tuple) and result[1] is True]
    assert len(winners) == 1
    assert "idempotency_conflict" in results
    assert world.count(DifyBuilderExecutionRequest) == 1


def test_postgres_reservation_and_unrelated_commit_cannot_both_advance(world: World) -> None:
    decision = world.confirmed()
    repo = SqlDifyBuilderRepository(world.factory)
    _session, fc = repo.get_session(world.session_id)

    def unrelated() -> str:
        try:
            repo.compare_and_advance(world.session_id, 1, PcState.BUILD_AWAIT_TESTDATA, fc, [])
        except ConflictError:
            return "conflict"
        return "advanced"

    reservation, other = race(lambda: world.reserve(decision), unrelated)
    session, _fc = repo.get_session(world.session_id)
    assert session.version == 2
    if isinstance(reservation, tuple):
        assert other == "conflict"
        assert world.count(DifyBuilderExecutionRequest) == 1
    else:
        assert (reservation, other) == ("consent_invalidated", "advanced")
        assert world.count(DifyBuilderExecutionRequest) == 0
        assert world.consent(decision.consent_id).state == "invalidated"


def test_postgres_stale_session_cas_rolls_back_every_reservation_write(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    decision = world.confirmed()
    original = SqlDifyBuilderRepository._compare_and_advance_in_session

    def lose(
        self: SqlDifyBuilderRepository,
        db: Session,
        session_id: str,
        base_version: int,
        next: PcState,
        fc: DifyBuilderContext,
        items: list[ConversationItem],
    ) -> int:
        original(self, db, session_id, base_version, next, fc, items)
        raise ConflictError("stale")

    monkeypatch.setattr(SqlDifyBuilderRepository, "_compare_and_advance_in_session", lose)
    assert race(lambda: world.reserve(decision)) == ["stale_session_version"]
    assert world.count(DifyBuilderExecutionRequest) == 0
    assert world.count(DifyBuilderSessionCommit) == 1
    row = world.consent(decision.consent_id)
    assert (row.state, row.command_id, row.execute_key) == ("confirmed", None, None)


def test_postgres_simultaneous_tool_claims_have_one_winner_and_survive_restart(world: World) -> None:
    reserved, context, run_id = world.launched()

    def claim() -> str:
        BuilderRealCallConsentService(world.factory).claim_tool(
            context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-execution"
        )
        return "claimed"

    assert sorted(str(result) for result in both(claim)) == ["claimed", "consent_already_claimed"]
    # Kill boundary: a fresh service instance (new process) cannot reopen the committed claim.
    assert race(claim) == ["consent_already_claimed"]
    assert world.consent(reserved.consent_id).state == "claimed"


@pytest.mark.parametrize("phase", ["refresh", "business"])
def test_postgres_simultaneous_phase_claims_spend_once(world: World, phase: Phase) -> None:
    reserved, binding = world.claimed()
    parameters = None if phase == "refresh" else APPROVED

    def spend() -> str:
        world.service().claim_phase(binding=binding, phase=phase, final_parameters=parameters)
        return "spent"

    assert sorted(str(result) for result in both(spend)) == ["consent_already_claimed", "spent"]
    row = world.consent(reserved.consent_id)
    assert (row.refresh_count, row.business_count) == ((1, 0) if phase == "refresh" else (0, 1))


def test_postgres_expiry_boundary_blocks_the_grant_claim(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    reserved, context, run_id = world.launched()
    expires_at = world.consent(reserved.consent_id).expires_at.replace(tzinfo=UTC)
    monkeypatch.setattr(real_call_consent_service, "_utcnow", lambda: expires_at)

    def claim() -> str:
        world.service().claim_tool(
            context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-execution"
        )
        return "claimed"

    assert race(claim) == ["consent_expired"]
    monkeypatch.setattr(real_call_consent_service, "_utcnow", lambda: expires_at - timedelta(microseconds=1))
    assert race(claim) == ["consent_not_confirmed"]
    assert world.consent(reserved.consent_id).state == "expired"


# Held-lock regression containment
# --------------------------------
# The whole scenario (holder, spender, PG witness polling, row assertions facts and engine cleanup)
# runs in a dedicated forked CI child process. Process termination is the containment boundary: it
# ends every worker thread and every in-flight SQL read, even a connection hang outside a server
# statement or before a backend PID is published. The parent never runs scenario SQL while waiting;
# it only polls one plain pipe with a deadline, then joins, terminates and finally kills the child,
# each with a bounded join, and fails if the child still exists. No Manager, Queue, Event or lock is
# shared across the process boundary, so killing the child cannot strand the parent.
#
# Inside the child, server-side bounds are applied per connection through libpq ``options`` (the
# same mechanism as ``SQLALCHEMY_ENGINE_OPTIONS``) so the child also cleans up normally:
# - ``lock_timeout`` aborts any single lock acquisition that waits longer (SQLSTATE 55P03).
# - ``statement_timeout`` aborts any single statement, including one blocked on a lock (57014).
# - ``idle_in_transaction_session_timeout`` makes the server terminate a session left idle inside an
#   open transaction, so a stalled holder cannot keep the consent row locked after the child dies.
_HOLDER_OPTIONS = "-c lock_timeout=5000 -c statement_timeout=5000 -c idle_in_transaction_session_timeout=20000"
_SPENDER_OPTIONS = "-c lock_timeout=15000 -c statement_timeout=20000 -c idle_in_transaction_session_timeout=20000"
_PROBE_OPTIONS = "-c lock_timeout=5000 -c statement_timeout=5000"
_HOLDER_LOCK_SECONDS = 10
_HOLDER_RELEASE_SECONDS = 15  # < holder idle-in-transaction bound
_WITNESS_SECONDS = 10  # < spender lock_timeout, so the witnessed wait is still in progress
_THREAD_JOIN_SECONDS = 60  # > every server-side bound above (inside the child only)
_CHILD_RESULT_SECONDS = 180  # > the child's own worst case: lock + witness + both thread joins
_CHILD_JOIN_SECONDS = 10  # each of: normal join, after terminate(), after kill()


def _bounded_engine(base: Engine, options: str, backend_pids: list[int] | None = None) -> Engine:
    """A child-owned NullPool engine on the fixture's database whose every connection carries ``options``."""
    inherited = dify_config.SQLALCHEMY_ENGINE_OPTIONS.get("connect_args", {}).get("options", "")
    engine = create_engine(base.url, poolclass=NullPool, connect_args={"options": f"{inherited} {options}".strip()})
    if backend_pids is not None:

        def record_backend(dbapi_connection: DBAPIConnection, _record: ConnectionPoolEntry) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("SELECT pg_backend_pid()")
            row = cursor.fetchone()
            cursor.close()
            if row is not None:
                backend_pids.append(int(row[0]))

        event.listen(engine, "connect", record_backend)
    return engine


def _held_lock_scenario(
    base: Engine,
    consent_id: str,
    expires_at: datetime,
    spend: Callable[[BuilderRealCallConsentService], object],
) -> dict[str, object]:
    """Run INSIDE the forked child only: real service and real row locks on child-owned engines.

    The clock advances only after THIS spender's own backend is witnessed blocked by THIS holder's
    backend on the consent query, so a pre-lock clock read would authorize and fail the assertion.
    """
    spender_pids: list[int] = []
    holder_engine = _bounded_engine(base, _HOLDER_OPTIONS)
    spender_engine = _bounded_engine(base, _SPENDER_OPTIONS, spender_pids)
    probe_engine = _bounded_engine(base, _PROBE_OPTIONS)
    # Every session the real service opens (owner read, permission, locked transaction) comes from
    # this factory, so all spender SQL inherits the spender bounds.
    service = BuilderRealCallConsentService(sessionmaker(bind=spender_engine, expire_on_commit=False))
    clock = {"now": expires_at - timedelta(seconds=5)}  # eligible when the spender call starts
    # Child-process memory only; the parent's module is untouched.
    real_call_consent_service._utcnow = lambda: clock["now"]
    locked, release = Event(), Event()
    results: dict[str, object] = {}

    def hold_consent_lock() -> None:
        try:
            with Session(holder_engine) as db, db.begin():
                results["holder_pid"] = int(db.scalar(text("SELECT pg_backend_pid()")) or 0)
                db.execute(
                    select(DifyBuilderRealCallConsent.id)
                    .where(DifyBuilderRealCallConsent.id == consent_id)
                    .with_for_update()
                )
                locked.set()
                release.wait(timeout=_HOLDER_RELEASE_SECONDS)
        except Exception as error:  # reported to the parent, which asserts on it
            results["holder_error"] = type(error).__name__

    def run_spender() -> None:
        try:
            results["spender"] = spend(service)
        except BuilderExecutionPolicyError as error:
            results["spender"] = error.reason_code
        except Exception as error:
            results["spender"] = f"error:{type(error).__name__}"

    def spender_witnessed_blocked_by_holder() -> bool:
        # Correlated: one of THIS spender's backends waits on a lock, is blocked by THIS holder's
        # backend (which holds only the consent row lock), and is executing the consent lock query.
        with Session(probe_engine) as db:
            return bool(
                db.scalar(
                    text(
                        "SELECT count(*) FROM pg_stat_activity AS a WHERE a.pid = ANY(CAST(:pids AS integer[])) "
                        "AND a.wait_event_type = 'Lock' AND CAST(:holder AS integer) = ANY(pg_blocking_pids(a.pid)) "
                        "AND a.query ILIKE '%dify_builder_real_call_consents%'"
                    ),
                    {"pids": list(spender_pids), "holder": results.get("holder_pid", 0)},
                )
            )

    holder = Thread(target=hold_consent_lock, name="consent-lock-holder", daemon=True)
    spender = Thread(target=run_spender, name="consent-spender", daemon=True)
    try:
        holder.start()
        results["holder_locked"] = locked.wait(timeout=_HOLDER_LOCK_SECONDS)
        if results["holder_locked"]:
            results["eligible_at_start"] = clock["now"] < expires_at
            spender.start()
            deadline = monotonic() + _WITNESS_SECONDS
            witnessed = False
            while spender.is_alive() and monotonic() < deadline:
                if spender_witnessed_blocked_by_holder():
                    witnessed = True
                    break
                sleep(0.05)
            results["witnessed"] = witnessed
            if witnessed:
                clock["now"] = expires_at  # expiry passes while the spender is blocked
    finally:
        release.set()
        holder.join(timeout=_THREAD_JOIN_SECONDS)
        if spender.ident is not None:
            spender.join(timeout=_THREAD_JOIN_SECONDS)
        results["threads_alive"] = holder.is_alive() or spender.is_alive()
        if not results["threads_alive"]:
            with Session(probe_engine) as db:
                row = db.get(DifyBuilderRealCallConsent, consent_id)
                if row is not None:
                    results["row"] = (
                        row.state,
                        row.claimed_at is None,
                        row.business_count,
                        row.business_claimed_at is None,
                    )
        holder_engine.dispose()
        spender_engine.dispose()
        probe_engine.dispose()
    return results


@pytest.mark.parametrize("spend", ["tool", "business"])
def test_postgres_spend_blocked_on_row_lock_across_expiry_is_refused(world: World, spend: str) -> None:
    """A spend that starts eligible and waits on a real held consent row lock across expiry must refuse.

    The scenario runs in a killable forked child (see the containment notes above); the parent only
    supervises it through a bounded pipe and asserts on the facts the child reports.
    """
    assert "fork" in multiprocessing.get_all_start_methods(), "held-lock containment needs fork (Linux CI)"
    base: Engine = world.factory.kw["bind"]
    spend_with: Callable[[BuilderRealCallConsentService], object]
    if spend == "tool":
        reserved, context, run_id = world.launched()

        def spend_with(service: BuilderRealCallConsentService) -> object:
            return service.claim_tool(
                context=context, node_id="tool", native_run_id=run_id, native_node_execution_id="node-execution"
            )
    else:
        reserved, binding = world.claimed()

        def spend_with(service: BuilderRealCallConsentService) -> object:
            service.claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
            return "spent"

    expires_at = world.consent(reserved.consent_id).expires_at.replace(tzinfo=UTC)
    # Explicit fork: the child keeps this process's patched synthetic metadata/flags in memory.
    ctx = multiprocessing.get_context("fork")
    receiver, sender = ctx.Pipe(duplex=False)

    def child_main(channel: Connection) -> None:
        facts: dict[str, object] = {}
        try:
            # Drop the inherited fixture pool without closing the parent's sockets; the child then
            # uses only its own NullPool engines (SQLAlchemy multiprocessing guidance).
            base.dispose(close=False)
            facts = _held_lock_scenario(base, reserved.consent_id, expires_at, spend_with)
        except BaseException as error:
            facts["child_error"] = type(error).__name__
        finally:
            channel.send(facts)
            channel.close()

    child = ctx.Process(target=child_main, args=(sender,), name="held-lock-consent-scenario", daemon=True)
    facts: dict[str, object] | None = None
    child_alive = False
    try:
        child.start()
        sender.close()  # only the child may write
        if receiver.poll(_CHILD_RESULT_SECONDS):
            try:
                facts = receiver.recv()
            except EOFError:
                facts = None  # child exited without reporting
    finally:
        sender.close()
        if child.pid is not None:  # started: always reap within bounds
            child.join(timeout=_CHILD_JOIN_SECONDS)
            if child.is_alive():
                child.terminate()
                child.join(timeout=_CHILD_JOIN_SECONDS)
            if child.is_alive():
                child.kill()
                child.join(timeout=_CHILD_JOIN_SECONDS)
            child_alive = child.is_alive()
            if not child_alive:
                child.close()
        receiver.close()
    assert not child_alive, "held-lock child survived terminate() and kill()"
    assert facts is not None, "held-lock child reported nothing within its deadline"
    assert "child_error" not in facts, facts
    assert "holder_error" not in facts, facts
    assert facts.get("holder_locked") is True, facts
    assert facts.get("eligible_at_start") is True, facts
    assert facts.get("witnessed") is True, facts
    assert facts.get("threads_alive") is False, facts
    assert facts.get("spender") == "consent_expired", facts
    if spend == "tool":
        assert facts.get("row") == ("expired", True, 0, True), facts
    else:
        assert facts.get("row") == ("failed", False, 0, True), facts


def test_postgres_refresh_cas_never_overwrites_same_timestamp_rotation(world: World) -> None:
    reserved, binding = world.claimed()
    initial = world.reference_revision()
    world.service().claim_phase(binding=binding, phase="refresh", final_parameters=None)
    rotated = '{"access_token":"rotated-by-native-writer"}'

    def finish() -> str:
        return world.service().finish_refresh(
            binding=binding, old_revision=initial, encrypted_credentials='{"access_token":"ci-new"}', expires_at=1
        )

    def rotate() -> str:
        world.rotate_credential(rotated)
        return "rotated"

    refreshed, other = race(finish, rotate)
    assert other == "rotated"
    with world.factory() as db:
        credential = db.get(BuiltinToolProvider, world.credential_id)
        assert credential is not None
    row = world.consent(reserved.consent_id)
    # The unconditional native writer always lands; the CAS never overwrites it.
    assert credential.encrypted_credentials == rotated
    if refreshed == "refresh_conflict":
        assert (row.state, row.derived_credential_revision, credential.expires_at) == ("unknown", None, 1_900_000_000)
    else:
        assert row.derived_credential_revision == refreshed
    assert row.refresh_count == 1


def test_postgres_concurrent_client_change_never_admits_a_stale_business_claim(world: World) -> None:
    reserved, binding = world.claimed()

    def spend() -> str:
        world.service().claim_phase(binding=binding, phase="business", final_parameters=APPROVED)
        return "spent"

    def change_client() -> str:
        with world.factory.begin() as db:
            client = db.get(ToolOAuthTenantClient, world.client_id)
            assert client is not None
            client.encrypted_oauth_params = '{"client_id":"ci-replaced-client"}'
        return "changed"

    spent, changed = race(spend, change_client)
    assert changed == "changed"
    row = world.consent(reserved.consent_id)
    if spent == "spent":
        assert (row.state, row.business_count) == ("claimed", 1)
    else:
        assert spent == "consent_scope_changed"
        assert (row.state, row.business_count) == ("failed", 0)


def test_race_tables_are_built_by_the_actual_migrations(world: World) -> None:
    """The very tables every race above locks carry the actual migrations' constraints and marker."""
    base: Engine = world.factory.kw["bind"]
    with base.connect() as connection:
        for table, marker in MIGRATED_TABLES.items():
            comment = connection.execute(
                text("SELECT obj_description(CAST(:table AS regclass), 'pg_class')"), {"table": table}
            ).scalar()
            assert comment == marker
        inspector = inspect(connection)
        consent = "dify_builder_real_call_consents"
        assert {unique["name"] for unique in inspector.get_unique_constraints(consent)} == {
            "dify_builder_real_call_consent_prepare_key",
            "dify_builder_real_call_consent_request_key",
            "dify_builder_real_call_consent_command_key",
        }
        assert {check["name"] for check in inspector.get_check_constraints(consent)} == {
            "builder_real_call_consent_state",
            "builder_real_call_consent_decision",
            "builder_real_call_consent_outcome",
            "builder_real_call_consent_refresh_once",
            "builder_real_call_consent_business_once",
            "builder_real_call_consent_phase_after_claim",
        }
        # PostgreSQL also reports the indexes backing the unique constraints above.
        assert "dify_builder_real_call_consent_session_idx" in {
            index["name"] for index in inspector.get_indexes(consent)
        }
        request = "dify_builder_execution_requests"
        assert {check["name"] for check in inspector.get_check_constraints(request)} == {
            "builder_execution_request_state"
        }
        assert {index["name"] for index in inspector.get_indexes(request)} == {
            "dify_builder_execution_request_session_idx",
            "dify_builder_execution_request_app_idx",
        }
        assert "http_fixtures" in {column["name"] for column in inspector.get_columns("dify_builder_test_inputs")}
        # The migration-built table is what the ORM writes: every mapped column exists.
        assert {column["name"] for column in inspector.get_columns(consent)} == {
            column.name for column in DifyBuilderRealCallConsent.__table__.columns
        }
        assert {column["name"] for column in inspector.get_columns(request)} == {
            column.name for column in DifyBuilderExecutionRequest.__table__.columns
        }


def test_real_postgres_consent_migration_upgrade_downgrade(flask_app_with_containers: Flask) -> None:
    """The actual migration in an isolated schema: constraints, index, downgrade and re-upgrade."""
    from extensions.ext_database import db

    path = Path(__file__).parents[4] / MIGRATION
    spec = importlib.util.spec_from_file_location("builder_real_call_consent_migration", path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert (migration.revision, migration.down_revision) == ("d82f9a6c31e0", "c84e6a217b90")
    schema = "builder_consent_migration_" + uuid4().hex
    table = "dify_builder_real_call_consents"
    with flask_app_with_containers.app_context(), db.engine.begin() as connection:
        assert connection.dialect.name == "postgresql"
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            inspector = inspect(connection)
            columns = {column["name"] for column in inspector.get_columns(table, schema=schema)}
            assert columns == {column.name for column in DifyBuilderRealCallConsent.__table__.columns}
            uniques = {unique["name"] for unique in inspector.get_unique_constraints(table, schema=schema)}
            assert uniques == {
                "dify_builder_real_call_consent_prepare_key",
                "dify_builder_real_call_consent_request_key",
                "dify_builder_real_call_consent_command_key",
            }
            checks = {check["name"] for check in inspector.get_check_constraints(table, schema=schema)}
            assert {
                "builder_real_call_consent_state",
                "builder_real_call_consent_refresh_once",
                "builder_real_call_consent_business_once",
                "builder_real_call_consent_phase_after_claim",
            } <= checks
            indexes = {index["name"] for index in inspector.get_indexes(table, schema=schema)}
            assert "dify_builder_real_call_consent_session_idx" in indexes
            identity = {name: str(uuid4()) for name in ("id", "tenant", "app", "workflow", "actor", "session")}
            insert = text(
                f"INSERT INTO {table} (id, tenant_id, app_id, workflow_id, actor_id, session_id, prepared_commit_id, "
                "test_input_id, prepared_version, binding, scope_digest, disclosure, disclosure_digest, expires_at, "
                "state, prepare_key, prepare_body_digest, prepare_receipt, initial_credential_revision, "
                "oauth_client_revision, refresh_count) VALUES (:id, :tenant, :app, :workflow, :actor, :session, "
                ":session, :session, 1, '{}', :digest, '{}', :digest, now(), 'prepared', 'key', :digest, '{}', "
                ":digest, :digest, :refresh)"
            )
            nested = connection.begin_nested()
            with pytest.raises(IntegrityError):
                connection.execute(insert, {**identity, "digest": "0" * 64, "refresh": 1})
            nested.rollback()
            connection.execute(insert, {**identity, "digest": "0" * 64, "refresh": 0})
            migration.downgrade()
            assert table not in inspect(connection).get_table_names(schema=schema)
            migration.upgrade()
            assert table in inspect(connection).get_table_names(schema=schema)
        connection.execute(text("SET LOCAL search_path TO public"))
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
