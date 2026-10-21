"""CI-only PostgreSQL consumption fence at the domain/physical-owner seam.

The callback is a local observable IO stand-in, not a qualified HTTP endpoint.
Missing protocol is feature-availability RED, not an existing-network-duplicate
claim. Every race uses independent connections in killable OS processes.
"""

from __future__ import annotations

from collections.abc import Callable, Generator
from multiprocessing.connection import Connection as ProcessConnection
from multiprocessing.process import BaseProcess
from multiprocessing.synchronize import Event as ProcessEvent
from typing import TYPE_CHECKING, Literal, override

from pydantic import JsonValue
from sqlalchemy import Engine, Table
from sqlalchemy.orm import Session

from runtime_contracts.builder.native.contracts import EffectIntent
from services.dify_builder.native_testing.repository import OwnedNativeTest
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import require_instance

if TYPE_CHECKING:
    from runtime_contracts.builder.native.contracts import NativeTestContextRef


from typing import TYPE_CHECKING

from sqlalchemy.orm.state import InstanceState

from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import LedgerCase

if TYPE_CHECKING:
    from sqlalchemy.orm import sessionmaker

    from core.dify_builder.models import Actor
    from runtime_contracts.builder.native.contracts import (
        DispatchPermit,
        NativeTestContextRef,
    )

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import (
        test_builder_native_effect_ledger as _fixture_types_0,
    )

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import (
        test_builder_native_effect_ledger as _fixture_types_0,
    )


import multiprocessing
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from psycopg2 import Error as PostgresError
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy import inspect as inspect_orm
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from sqlalchemy.sql.elements import ColumnElement

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import (
    NativeEffectAttempt,
    NativeEffectGrant,
    NativeInvocationState,
    NativeTestInvocation,
    NativeTestScope,
)
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import DispatchPermit, PolicyStop, RecordedResult
from services.dify_builder.native_testing.authorization import EffectAuthorizationService
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    MetadataOwner,
    _create_real_child,
    _migration,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    ledger_case as ledger_case,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    native_owner as native_owner,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    no_live as no_live,  # noqa: PLC0414 - shared pytest fixture
)

MIGRATION = "2026_10_15_1200-e59b7d32a6c1_add_native_effect_dispatch_claims.py"


@pytest.fixture(scope="module", autouse=True)
def migrated_dispatch_claims(migrated_native_tables: None, flask_app_with_containers: ColumnElement[bool]) -> None:
    assert migrated_native_tables is None
    assert callable(EffectAuthorizationService.claim_dispatch), (
        "durable physical dispatch claim protocol is unavailable"
    )
    from extensions.ext_database import db

    with flask_app_with_containers.app_context(), db.engine.begin() as connection:
        assert connection.dialect.name == "postgresql"
        connection.execute(text("DROP TABLE IF EXISTS dify_builder_native_effect_dispatch_claims"))
        context = MigrationContext.configure(connection, opts={"target_metadata": db.metadata})
        with Operations.context(context):
            _migration(MIGRATION).upgrade()
            _migration(MIGRATION).downgrade()
            _migration(MIGRATION).upgrade()


@pytest.fixture
def claim_case(ledger_case: _fixture_types_0.LedgerCase) -> tuple[LedgerCase, DispatchPermit]:
    case = ledger_case
    with case.factory() as session:
        state = session.scalar(
            select(NativeInvocationState).where(
                NativeInvocationState.request_id == case.ref.request_id,
                NativeInvocationState.invocation_id == case.ref.invocation_id,
            )
        )
        request = session.get(DifyBuilderExecutionRequest, case.ref.request_id)
        assert require_instance(state, NativeInvocationState).context_object_id
        assert (
            require_instance(state, NativeInvocationState).app_id,
            require_instance(state, NativeInvocationState).workflow_id,
        ) == (
            require_instance(request, DifyBuilderExecutionRequest).app_id,
            require_instance(request, DifyBuilderExecutionRequest).workflow_id,
        )
        assert (
            require_instance(state, NativeInvocationState).state,
            require_instance(state, NativeInvocationState).generation,
            require_instance(state, NativeInvocationState).pending_ids,
        ) == ("running", 0, [])
    case.confirm(max_calls=2, max_dispatches=2)
    permit = case.guard.before_call(ref=case.ref, intent=case.intent)
    assert isinstance(permit, DispatchPermit)
    return case, permit


def _claim(
    case: LedgerCase,
    permit: DispatchPermit,
    *,
    io: Callable[[], object],
    ref: NativeTestContextRef | None = None,
    intent: EffectIntent | None = None,
    guard: EffectAuthorizationService | None = None,
) -> None:
    (guard or case.guard).claim_dispatch(ref=ref or case.ref, intent=intent or case.intent, permit=permit)
    io()


def _count(case: LedgerCase) -> int | None:
    from models.dify_builder_native_tests import NativeEffectDispatchClaim

    with case.factory() as session:
        return session.scalar(
            select(func.count())
            .select_from(NativeEffectDispatchClaim)
            .where(NativeEffectDispatchClaim.request_id == case.ref.request_id)
        )


def _assert_one_spend(case: LedgerCase, permit: DispatchPermit) -> None:
    with case.factory() as session:
        attempts = session.scalars(
            select(NativeEffectAttempt).where(NativeEffectAttempt.request_id == case.ref.request_id)
        ).all()
        assert [attempt.id for attempt in attempts] == [permit.attempt_id]
        scope = session.get(NativeTestScope, case.ref.request_id)
        grant = session.get(NativeEffectGrant, attempts[0].grant_id)
        assert scope is not None
        assert grant is not None
        for quota in (scope, grant):
            assert (quota.spent_calls, quota.spent_dispatches, quota.spent_cost_units) == (1, 1, 2)
        assert require_instance(scope, NativeTestScope).budget_spent == {"cpu_ms": 10}


def test_inert_validation_does_not_consume_and_owner_claim_commits_before_io(
    claim_case: tuple[LedgerCase, DispatchPermit],
) -> None:
    case, permit = claim_case
    case.guard.validate_dispatch(ref=case.ref, intent=case.intent, permit=permit)
    case.guard.validate_dispatch(ref=case.ref, intent=case.intent, permit=permit)
    assert _count(case) == 0
    observed = []

    def io() -> None:
        # A separate session can acquire the SAME lock and see the committed
        # claim. A claim returned inside its writer transaction times out here.
        with case.factory.begin() as session:
            session.execute(text("SET LOCAL lock_timeout = '1s'"))
            session.scalar(
                select(DifyBuilderExecutionRequest)
                .where(DifyBuilderExecutionRequest.id == case.ref.request_id)
                .with_for_update()
            )
            assert _count(case) == 1
        observed.append("io")

    _claim(case, permit, io=io)
    with pytest.raises(BuilderExecutionPolicyError, match="dispatch_already_consumed"):
        _claim(case, permit, io=io)
    assert observed == ["io"]
    _assert_one_spend(case, permit)


def _process_claim(case: LedgerCase, permit: DispatchPermit, *, start: ProcessEvent, sender: ProcessConnection) -> None:
    with case.factory() as session:
        url = require_instance(session.get_bind(), Engine).url
    engine = create_engine(url, poolclass=NullPool)
    child = LedgerCase(sessionmaker(engine, expire_on_commit=False), case.actor, case.ref, case.intent, MetadataOwner())
    try:
        assert start.wait(15)
        _claim(child, permit, io=lambda: sender.send("io"))
    except BuilderExecutionPolicyError as error:
        sender.send(error.reason_code)
    finally:
        engine.dispose()
        sender.close()


def _run_processes(case: LedgerCase, permit: DispatchPermit, count: int) -> list[str]:
    ctx = multiprocessing.get_context("fork")
    start = ctx.Event()
    processes: list[BaseProcess] = []
    receivers: list[ProcessConnection] = []
    try:
        for _ in range(count):
            receiver, sender = ctx.Pipe(duplex=False)
            process = ctx.Process(target=_process_claim, args=(case, permit), kwargs={"start": start, "sender": sender})
            process.start()
            sender.close()
            processes.append(process)
            receivers.append(receiver)
        start.set()
        outcomes = []
        for receiver in receivers:
            assert receiver.poll(20), "claim worker did not finish"
            outcomes.append(require_instance(receiver.recv(), str))
        for process in processes:
            process.join(20)
            assert process.exitcode == 0
        return outcomes
    finally:
        for process in processes:
            if process.is_alive():
                process.kill()
            process.join(5)
        for receiver in receivers:
            receiver.close()


def test_two_processes_consume_one_owned_permit_once(claim_case: tuple[LedgerCase, DispatchPermit]) -> None:
    case, permit = claim_case
    assert sorted(_run_processes(case, permit, 2)) == ["dispatch_already_consumed", "io"]
    assert _count(case) == 1
    _assert_one_spend(case, permit)


def test_lost_claim_response_and_restarted_process_cannot_dispatch(
    claim_case: tuple[LedgerCase, DispatchPermit],
) -> None:
    case, permit = claim_case
    # First caller loses the acknowledgement before IO. Persistent consumption
    # is deliberately conservative: another process must not replay it.
    case.guard.claim_dispatch(ref=case.ref, intent=case.intent, permit=permit)
    assert _run_processes(case, permit, 1) == ["dispatch_already_consumed"]
    assert _count(case) == 1
    _assert_one_spend(case, permit)


def test_rollback_before_claim_commit_invokes_no_io(claim_case: tuple[LedgerCase, DispatchPermit]) -> None:
    case, permit = claim_case

    class RollbackLoader(OwnedNativeTestLoader):
        @override
        @contextmanager
        def locked(
            self, *, ref: NativeTestContextRef, settlement: bool = False
        ) -> Generator[tuple[Session, OwnedNativeTest, NativeTestScope]]:
            with super().locked(ref=ref, settlement=settlement) as value:
                yield value
                raise RuntimeError("injected before commit")

    guard = EffectAuthorizationService(RollbackLoader(case.factory, actor=case.actor, resolver=case.metadata))
    observed = []
    with pytest.raises(RuntimeError, match="injected before commit"):
        _claim(case, permit, io=lambda: observed.append("io"), guard=guard)
    assert observed == []
    assert _count(case) == 0
    _assert_one_spend(case, permit)
    _claim(case, permit, io=lambda: observed.append("io"))
    assert observed == ["io"]


@pytest.mark.parametrize("identity", ["tenant", "actor", "request", "invocation", "context"])
def test_owner_mismatch_leaves_no_claim_or_io(claim_case: tuple[LedgerCase, DispatchPermit], identity: str) -> None:
    case, permit = claim_case
    guard, ref = case.guard, case.ref
    if identity in {"tenant", "actor"}:
        actor = Actor(
            account_id=str(uuid4()) if identity == "actor" else case.actor.account_id,
            tenant_id=str(uuid4()) if identity == "tenant" else case.actor.tenant_id,
        )
        guard = EffectAuthorizationService(OwnedNativeTestLoader(case.factory, actor=actor, resolver=case.metadata))
    else:
        field = {"request": "request_id", "invocation": "invocation_id", "context": "context_digest"}[identity]
        ref = ref.model_copy(update={field: "d" * 64 if identity == "context" else str(uuid4())})
    observed = []
    with pytest.raises(BuilderExecutionPolicyError):
        _claim(case, permit, ref=ref, guard=guard, io=lambda: observed.append("io"))
    assert observed == []
    assert _count(case) == 0


@pytest.mark.parametrize(
    "change",
    [
        {"resource_ref": "mail.send"},
        {"target": {"mailbox": "other"}},
        {"parameters": {"limit": True}},
        {"kind": "oauth"},
        {"implementation_revision": "v2"},
        {"account_ref": "other"},
        {"input_digest": "d" * 64},
        {"capability_digest": "d" * 64},
    ],
    ids=["resource", "target", "typed-args", "phase", "revision", "account", "input", "capability"],
)
def test_intent_mismatch_leaves_no_claim_or_io(
    claim_case: tuple[LedgerCase, DispatchPermit], change: dict[str, JsonValue]
) -> None:
    case, permit = claim_case
    observed = []
    with pytest.raises(BuilderExecutionPolicyError):
        _claim(case, permit, intent=case.intent.model_copy(update=change), io=lambda: observed.append("io"))
    assert observed == []
    assert _count(case) == 0


@pytest.mark.parametrize("field", ["permit_id", "attempt_id", "operation_id", "expires_at"])
def test_permit_mismatch_leaves_no_claim_or_io(claim_case: tuple[LedgerCase, DispatchPermit], field: str) -> None:
    case, permit = claim_case
    replacement = (datetime.now(UTC) + timedelta(minutes=1)).isoformat() if field == "expires_at" else str(uuid4())
    observed = []
    with pytest.raises(BuilderExecutionPolicyError):
        _claim(case, permit.model_copy(update={field: replacement}), io=lambda: observed.append("io"))
    assert observed == []
    assert _count(case) == 0


@pytest.mark.parametrize(
    "blocked", ["revoked", "scope-expired", "permit-expired", "cancelled", "inactive", "terminal", "unknown"]
)
def test_current_authority_failure_leaves_no_claim_or_io(
    claim_case: tuple[LedgerCase, DispatchPermit], blocked: str
) -> None:
    from models.account import TenantAccountJoin

    case, permit = claim_case
    guard = case.guard
    with case.factory.begin() as session:
        if blocked == "revoked":
            membership = session.scalar(
                select(TenantAccountJoin).where(TenantAccountJoin.account_id == case.actor.account_id)
            )
            session.delete(membership)
        elif blocked == "scope-expired":
            require_instance(session.get(NativeTestScope, case.ref.request_id), NativeTestScope).expires_at = (
                datetime.now(UTC) - timedelta(seconds=1)
            )
        elif blocked == "permit-expired":
            guard = EffectAuthorizationService(
                case.guard.loader, clock=lambda: datetime.fromisoformat(permit.expires_at)
            )
        elif blocked == "cancelled":
            require_instance(session.get(NativeTestScope, case.ref.request_id), NativeTestScope).cancelled = True
        elif blocked == "inactive":
            require_instance(
                session.scalar(
                    select(NativeTestInvocation).where(NativeTestInvocation.request_id == case.ref.request_id)
                ),
                NativeTestInvocation,
            ).active = False
        elif blocked == "terminal":
            require_instance(
                session.get(DifyBuilderExecutionRequest, case.ref.request_id), DifyBuilderExecutionRequest
            ).state = "sealed"
        else:
            require_instance(
                session.scalar(
                    select(NativeInvocationState).where(NativeInvocationState.request_id == case.ref.request_id)
                ),
                NativeInvocationState,
            ).state = "unknown"
    observed = []
    with pytest.raises(BuilderExecutionPolicyError):
        _claim(case, permit, guard=guard, io=lambda: observed.append("io"))
    assert observed == []
    assert _count(case) == 0
    _assert_one_spend(case, permit)


@pytest.mark.parametrize("state", ["unknown", "cancelled", "completed"])
def test_blocked_ancestor_prevents_child_claim(claim_case: tuple[LedgerCase, DispatchPermit], state: str) -> None:
    case, permit = claim_case
    child_ref = _create_real_child(case)
    child_intent = case.intent.model_copy(
        update={"key": case.intent.key.model_copy(update={"invocation_id": child_ref.invocation_id})}
    )
    from runtime_contracts.builder.execution import canonical_digest
    from runtime_contracts.builder.native.contracts import operation_digest

    with case.factory.begin() as session:
        binding = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.request_id == case.ref.request_id,
                NativeTestInvocation.invocation_id == case.ref.invocation_id,
            )
        )
        raw = dict(next(iter(require_instance(binding, NativeTestInvocation).bindings.values())))
        raw["intent_digest"] = canonical_digest(child_intent.model_dump(mode="json"))
        child_row = session.scalar(
            select(NativeTestInvocation).where(
                NativeTestInvocation.request_id == child_ref.request_id,
                NativeTestInvocation.invocation_id == child_ref.invocation_id,
            )
        )
        require_instance(child_row, NativeTestInvocation).bindings = {operation_digest(child_intent.key): raw}
    child = LedgerCase(case.factory, case.actor, child_ref, child_intent, case.metadata)
    # The approved scope permits two identical occurrences but each invocation
    # still needs its own permit. No IO occurs in before_call.
    child_permit = child.guard.before_call(ref=child.ref, intent=child.intent)
    assert isinstance(child_permit, DispatchPermit)
    # The real child reserves while its parent is still running. Close the
    # ancestor only after reservation, at the physical-consumption boundary.
    with case.factory.begin() as session:
        root = session.scalar(
            select(NativeInvocationState).where(
                NativeInvocationState.request_id == case.ref.request_id,
                NativeInvocationState.invocation_id == case.ref.invocation_id,
            )
        )
        require_instance(root, NativeInvocationState).state = state
    observed = []
    with pytest.raises(BuilderExecutionPolicyError, match="native_ancestor_quarantined"):
        _claim(child, child_permit, io=lambda: observed.append("io"))
    assert observed == []
    assert _count(case) == 0


@pytest.mark.parametrize("outcome", ["completed", "failed", "unknown", "not_dispatched"])
def test_settlement_cannot_replay_physical_io(
    claim_case: tuple[LedgerCase, DispatchPermit], outcome: Literal["completed", "failed", "unknown", "not_dispatched"]
) -> None:
    case, permit = claim_case
    observed = []
    _claim(case, permit, io=lambda: observed.append("io"))
    case.guard.record_outcome(permit=permit, outcome=outcome, result_ref="stored" if outcome == "completed" else None)
    with pytest.raises(BuilderExecutionPolicyError):
        _claim(case, permit, io=lambda: observed.append("io"))
    decision = case.guard.before_call(ref=case.ref, intent=case.intent)
    if outcome == "completed":
        assert decision == RecordedResult(operation_id=permit.operation_id, result_ref="stored")
    else:
        assert isinstance(decision, PolicyStop)
    assert observed == ["io"]
    assert _count(case) == 1
    _assert_one_spend(case, permit)


def test_claim_rows_are_unique_append_only_and_block_destructive_downgrade(
    claim_case: tuple[LedgerCase, DispatchPermit],
) -> None:
    from models.dify_builder_native_tests import NativeEffectDispatchClaim

    case, permit = claim_case
    case.guard.claim_dispatch(ref=case.ref, intent=case.intent, permit=permit)
    with case.factory() as session:
        claim = session.scalar(
            select(NativeEffectDispatchClaim).where(NativeEffectDispatchClaim.attempt_id == permit.attempt_id)
        )
        values = {
            column.name: require_instance(inspect_orm(claim), InstanceState).attrs[column.name].value
            for column in NativeEffectDispatchClaim.__table__.columns
        }
    for changed in ({"id": str(uuid4())}, {"id": str(uuid4()), "attempt_id": str(uuid4())}):
        with pytest.raises(IntegrityError), case.factory.begin() as session:
            session.execute(
                require_instance(NativeEffectDispatchClaim.__table__, Table).insert().values({**values, **changed})
            )
    for sql in (
        "UPDATE dify_builder_native_effect_dispatch_claims SET invocation_id = 'forged' WHERE attempt_id = :attempt",
        "DELETE FROM dify_builder_native_effect_dispatch_claims WHERE attempt_id = :attempt",
    ):
        with pytest.raises(DBAPIError, match="append-only"), case.factory.begin() as session:
            session.execute(text(sql), {"attempt": permit.attempt_id})
    with case.factory() as session:
        engine = require_instance(session.get_bind(), Engine)
    with pytest.raises(RuntimeError, match="dispatch claim evidence must be retained"), engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            _migration(MIGRATION).downgrade()
    assert _count(case) == 1


def test_concurrent_downgrade_cannot_erase_a_successfully_committed_claim(
    claim_case: tuple[LedgerCase, DispatchPermit],
) -> None:
    """Real migration DDL must serialize its empty check with physical claims."""
    case, permit = claim_case
    with case.factory() as session:
        url = require_instance(session.get_bind(), Engine).url
    schema = "dispatch_race_" + uuid4().hex
    table = "dify_builder_native_effect_dispatch_claims"
    setup_engine = create_engine(url, poolclass=NullPool)
    ctx = multiprocessing.get_context("fork")
    checked_empty, release_downgrade = ctx.Event(), ctx.Event()
    io_count = ctx.Value("i", 0)
    processes: list[BaseProcess] = []
    receivers: list[ProcessConnection] = []

    def engine_for_schema() -> Engine:
        return create_engine(
            url,
            poolclass=NullPool,
            connect_args={"options": f"-csearch_path={schema},public -clock_timeout=2000 -cstatement_timeout=10000"},
        )

    def downgrade_worker(sender: ProcessConnection) -> None:
        engine = engine_for_schema()

        def after_empty_check(
            _connection: object, _cursor: object, statement: str, _parameters, _context, _executemany
        ) -> None:
            # Pause only after PostgreSQL has executed the real migration read.
            # Its table locks remain held; neither SQL nor results are replaced.
            if statement.strip().lower() == f"select 1 from {table} limit 1":
                checked_empty.set()
                assert release_downgrade.wait(15), "downgrade barrier timed out"

        event.listen(engine, "after_cursor_execute", after_empty_check)
        try:
            with engine.begin() as connection:
                with Operations.context(MigrationContext.configure(connection)):
                    _migration(MIGRATION).downgrade()
            sender.send("dropped")
        except RuntimeError as error:
            if "dispatch claim evidence must be retained" not in str(error):
                raise
            sender.send("refused")
        finally:
            engine.dispose()
            sender.close()

    def claimant_worker(sender: ProcessConnection) -> None:
        engine = engine_for_schema()
        child = LedgerCase(
            sessionmaker(engine, expire_on_commit=False), case.actor, case.ref, case.intent, MetadataOwner()
        )

        def io() -> None:
            with io_count.get_lock():
                io_count.value += 1

        try:
            _claim(child, permit, io=io)
            sender.send(("claimed", None))
        except DBAPIError as error:
            sender.send(("blocked", error.orig.pgcode if isinstance(error.orig, PostgresError) else None))
        finally:
            engine.dispose()
            sender.close()

    def start_worker(target: Callable[[ProcessConnection], None]) -> ProcessConnection:
        receiver, sender = ctx.Pipe(duplex=False)
        process = ctx.Process(target=target, args=(sender,))
        process.start()
        sender.close()
        processes.append(process)
        receivers.append(receiver)
        return receiver

    try:
        with setup_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            # Reuse the deployed immutable function body in the isolated schema.
            # Owner/attempt tables stay real and are resolved through public.
            definition = connection.scalar(
                text("SELECT pg_get_functiondef('public.builder_native_immutable_ledger()'::regprocedure)")
            )
            connection.execute(
                text(
                    definition.replace(
                        "public.builder_native_immutable_ledger", f'"{schema}".builder_native_immutable_ledger', 1
                    )
                )
            )
            connection.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
            with Operations.context(MigrationContext.configure(connection)):
                _migration(MIGRATION).upgrade()
            assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == 0
        downgrade_receiver = start_worker(downgrade_worker)
        assert checked_empty.wait(10), "downgrade never reached the real empty-table check"
        claimant_receiver = start_worker(claimant_worker)
        assert claimant_receiver.poll(12), "claimant did not finish or time out on the real DDL lock"
        claim_result, sqlstate = claimant_receiver.recv()
        release_downgrade.set()
        assert downgrade_receiver.poll(12), "downgrade did not finish after release"
        downgrade_result = downgrade_receiver.recv()
        for process in processes:
            process.join(10)
            assert process.exitcode == 0
        with setup_engine.connect() as connection:
            exists = connection.scalar(text("SELECT to_regclass(:table)"), {"table": f"{schema}.{table}"}) is not None
            retained = (
                connection.scalar(
                    text(f'SELECT count(*) FROM "{schema}".{table} WHERE attempt_id = :attempt'),
                    {"attempt": permit.attempt_id},
                )
                if exists
                else 0
            )
        if claim_result == "claimed":
            assert io_count.value == 1
            assert retained == 1, "downgrade erased a successfully committed physical dispatch claim"
            assert downgrade_result == "refused"
        else:
            assert (claim_result, sqlstate, io_count.value) == ("blocked", "55P03", 0)
            assert downgrade_result == "dropped"
            assert not exists
        _assert_one_spend(case, permit)
    finally:
        release_downgrade.set()
        for process in processes:
            if process.is_alive():
                process.kill()
            process.join(5)
        for receiver in receivers:
            receiver.close()
        # Only the test-owned isolated schema is removed, never production rows.
        with setup_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        setup_engine.dispose()
