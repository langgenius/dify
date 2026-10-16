"""CI-only real PostgreSQL atomic claims, crash containment and migrations.

No SQLite substitute: these exercise the service against committed rows and
separate killable OS processes with independent NullPool connections.
"""

import importlib.util
import multiprocessing
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import CheckConstraint, create_engine, func, inspect, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from core.dify_builder.models import Actor
from models.account import Tenant, TenantAccountJoin
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.contracts import (
    ApprovalWait,
    DispatchPermit,
    EffectIntent,
    NativeTestContextRef,
    OperationKey,
    PolicyStop,
    RecordedResult,
    operation_digest,
)
from services.dify_builder.native_testing.repository import native_workflow_revision
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    native_owner as native_owner,  # noqa: PLC0414 - shared pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    no_live as no_live,  # noqa: PLC0414 - zero early capability I/O fixture
)


class MetadataOwner:
    """Test-owned trusted metadata source; no native I/O or credential resolution."""

    credential_version = "credential-v1"

    def resolve_binding(self, *, session, owned, key):
        from services.dify_builder.native_testing.repository import NativeBinding

        assert session.in_transaction()
        raw = owned.bindings[operation_digest(key)]
        return NativeBinding.model_validate(raw).model_copy(update={"credential_version": self.credential_version})

    def resolve_pending(self, *, session, owned, category, reference):
        from services.dify_builder.native_testing.repository import PendingOwner

        assert session.in_transaction()
        if reference not in {"configuration-1", "form-1"}:
            raise BuilderExecutionPolicyError("pending_owner_mismatch")
        return PendingOwner(owner_ref=owned.app_id, version="1", reference=reference, category=category)


@dataclass
class LedgerCase:
    factory: object
    actor: Actor
    ref: NativeTestContextRef
    intent: EffectIntent
    metadata: MetadataOwner

    @property
    def guard(self):
        from services.dify_builder.native_testing.authorization import EffectAuthorizationService
        from services.dify_builder.native_testing.repository import OwnedNativeTestLoader

        return EffectAuthorizationService(OwnedNativeTestLoader(self.factory, actor=self.actor, resolver=self.metadata))

    def confirm(self, max_calls=1, max_dispatches=1, decision="approved"):
        return self.guard.decide(
            ref=self.ref,
            intent=self.intent,
            decision=decision,
            max_calls=max_calls,
            max_dispatches=max_dispatches,
            max_cost_units=20,
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
        )

    def dispatched_attempt_count(self):
        from models.dify_builder_native_tests import NativeEffectAttempt

        with self.factory() as session:
            return session.scalar(
                select(func.count())
                .select_from(NativeEffectAttempt)
                .where(NativeEffectAttempt.request_id == self.ref.request_id)
            )

    def occurrence(self, number):
        from models.dify_builder_native_tests import NativeTestInvocation
        from services.dify_builder.native_testing.repository import NativeBinding

        effect = self.intent.model_copy(
            update={"key": self.intent.key.model_copy(update={"occurrence_path": ("node", str(number))})}
        )
        with self.factory.begin() as session:
            row = session.scalar(
                select(NativeTestInvocation).where(NativeTestInvocation.request_id == self.ref.request_id)
            )
            raw = dict(row.bindings)
            base = NativeBinding.model_validate(raw[operation_digest(self.intent.key)])
            raw[operation_digest(effect.key)] = base.model_copy(
                update={"intent_digest": canonical_digest(effect.model_dump(mode="json"))}
            ).model_dump(mode="json")
            row.bindings = raw
        return effect


def _migration(filename):
    path = Path(__file__).parents[4] / "migrations/versions" / filename
    spec = importlib.util.spec_from_file_location("native_ledger_migration_" + filename, path)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _native_migration():
    return _migration("2026_10_14_1200-c67e12a904bf_add_builder_native_testing.py")


def _request_migration():
    return _migration("2026_10_09_1300-c84e6a217b90_add_builder_execution_requests.py")


def _assert_single_request_state_check(connection, *, native):
    """Check the real physical constraint, including SQLAlchemy PG truncation."""
    checks = inspect(connection).get_check_constraints("dify_builder_execution_requests")
    (model_check,) = (
        constraint
        for constraint in DifyBuilderExecutionRequest.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    )
    physical_name = connection.dialect.identifier_preparer.truncate_and_render_constraint_name(
        model_check.name, _alembic_quote=False
    )
    assert len(checks) == 1, "upgrade/downgrade must replace exactly one state CHECK"
    assert checks[0]["name"] == physical_name
    assert ("waiting" in checks[0]["sqltext"]) is native


def _assert_waiting_policy(connection, *, native):
    """Actual INSERTs catch a surviving legacy CHECK or SQL NULL bypass."""
    request_table = DifyBuilderExecutionRequest.__table__
    for policy, allowed in (("builder-native-test-v1", native), ("builder-execution-v1", False), (None, False)):
        identity = str(uuid4())
        values = dict.fromkeys(
            ("id", "tenant_id", "app_id", "workflow_id", "actor_id", "session_id", "test_input_id"), identity
        )
        statement = request_table.insert().values(
            **values,
            context={} if policy is None else {"policy_version": policy},
            context_digest="a" * 64,
            state="waiting",
            observations=[],
        )
        if allowed:
            connection.execute(statement)
            connection.execute(request_table.delete().where(request_table.c.id == identity))
        else:
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(statement)


@pytest.fixture(scope="module", autouse=True)
def migrated_native_tables(flask_app_with_containers):
    """Rebuild the race schema through both real migrations with deployed metadata."""
    from extensions.ext_database import db

    with flask_app_with_containers.app_context(), db.engine.begin() as connection:
        assert connection.dialect.name == "postgresql"
        # Imported module fixtures rerun after later migrations have installed
        # triggers. Remove their dependent tables before resetting the functions.
        for table in (
            "effect_dispatch_claims",
            "payload_objects",
            "invocation_states",
            "pending_actions",
            "continuations",
            "outcomes",
            "attempts",
            "operations",
            "grants",
            "invocations",
            "scopes",
        ):
            connection.execute(text("DROP TABLE IF EXISTS dify_builder_native_" + table))
        connection.execute(text("DROP FUNCTION IF EXISTS public.builder_native_immutable_ledger()"))
        connection.execute(text("DROP FUNCTION IF EXISTS public.builder_native_immutable_read_owner()"))
        # Consumers and teardown require all original create_all tables. Their
        # owning fixtures still replace these through the real later migrations.
        for table in ("effect_dispatch_claims", "payload_objects", "invocation_states"):
            db.metadata.tables["dify_builder_native_" + table].create(connection)
        # create_all/other test modules may have installed a different generation
        # of the request table. Rebuild it via its real predecessor, including
        # naming convention; never hand-create or conditionally drop the CHECK.
        context = MigrationContext.configure(connection, opts={"target_metadata": db.metadata})
        with Operations.context(context):
            _request_migration().downgrade()
            _request_migration().upgrade()
            _assert_single_request_state_check(connection, native=False)
            _native_migration().upgrade()
            _assert_single_request_state_check(connection, native=True)
            _assert_waiting_policy(connection, native=True)
        connection.execute(text("COMMENT ON TABLE dify_builder_native_attempts IS 'ci-alembic:c67e12a904bf'"))


@pytest.fixture
def ledger_case(native_owner, no_live):
    assert no_live is None
    from models.dify_builder_native_tests import NativeTestInvocation, NativeTestScope
    from services.dify_builder.native_testing.repository import NativeBinding

    factory, actor, app, workflow, sid, tid = native_owner
    rid = str(uuid4())
    context = {"policy_version": "builder-native-test-v1", "execution_revision": native_workflow_revision(workflow)}
    ref = NativeTestContextRef(request_id=rid, invocation_id="inv", context_digest=canonical_digest(context))
    effect = EffectIntent(
        key=OperationKey(invocation_id="inv", occurrence_path=("node", "0"), cursor=0),
        kind="tool",
        resource_ref="mail.read",
        implementation_revision="v1",
        account_ref="account",
        target={"mailbox": "inbox"},
        parameters={"limit": 1},
        input_digest="a" * 64,
        capability_digest="b" * 64,
    )
    binding = NativeBinding(
        intent_digest=canonical_digest(effect.model_dump(mode="json")),
        kind="tool",
        resource_ref="mail.read",
        implementation_revision="v1",
        account_ref="account",
        capability_digest="b" * 64,
        resource_version="resource-v1",
        credential_version="credential-v1",
        isolated=False,
        egress=True,
        new_data=True,
        destructive=False,
        cost_units=2,
        budget={"cpu_ms": 10},
        execution_id="exec",
        invocation_digest="c" * 64,
    )
    with factory.begin() as session:
        assert (
            session.scalar(text("SELECT obj_description('dify_builder_native_attempts'::regclass)"))
            == "ci-alembic:c67e12a904bf"
        )
        session.add(Tenant(name="other tenant", status="normal"))
        session.add(
            DifyBuilderExecutionRequest(
                id=rid,
                tenant_id=actor.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                actor_id=actor.account_id,
                session_id=sid,
                test_input_id=tid,
                context=context,
                context_digest=ref.context_digest,
                state="running",
                observations=[],
            )
        )
        session.add(
            NativeTestScope(
                request_id=rid,
                tenant_id=actor.tenant_id,
                generation=0,
                task_approved=False,
                max_calls=10,
                max_dispatches=10,
                max_cost_units=100,
                spent_calls=0,
                spent_dispatches=0,
                spent_cost_units=0,
                budget_limits={"cpu_ms": 100},
                budget_spent={},
                profile={"cpu_ms": 10},
                expires_at=datetime.now(UTC) + timedelta(minutes=10),
                cancelled=False,
            )
        )
        session.add(
            NativeTestInvocation(
                request_id=rid,
                tenant_id=actor.tenant_id,
                invocation_id="inv",
                active=True,
                bindings={operation_digest(effect.key): binding.model_dump(mode="json")},
            )
        )
    return LedgerCase(factory, actor, ref, effect, MetadataOwner())


def test_duplicate_delivery_does_not_get_second_permit(ledger_case):
    ledger_case.confirm(max_calls=1, max_dispatches=1)
    assert isinstance(ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent), DispatchPermit)
    duplicate = ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent)
    assert duplicate == PolicyStop(reason_code="dispatch_in_progress")
    assert ledger_case.dispatched_attempt_count() == 1


def test_unapproved_and_denied_never_dispatch(ledger_case):
    assert isinstance(ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent), ApprovalWait)
    ledger_case.confirm(decision="denied")
    assert ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent) == PolicyStop(
        reason_code="effect_denied"
    )
    assert ledger_case.dispatched_attempt_count() == 0


@pytest.mark.parametrize(
    "change",
    [
        {"kind": "code"},
        {"resource_ref": "mail.send"},
        {"capability_digest": "d" * 64},
        {"key": OperationKey(invocation_id="other", occurrence_path=("node", "0"), cursor=0)},
    ],
)
def test_forged_binding_never_dispatches(ledger_case, change):
    ledger_case.confirm()
    assert isinstance(
        ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent.model_copy(update=change)),
        PolicyStop,
    )
    assert ledger_case.dispatched_attempt_count() == 0


def test_rotation_and_cross_tenant_reference_fail_closed(ledger_case):
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from services.dify_builder.native_testing.repository import OwnedNativeTestLoader

    ledger_case.confirm()
    ledger_case.metadata.credential_version = "rotated"
    assert ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent) == PolicyStop(
        reason_code="native_binding_drift"
    )
    guard = EffectAuthorizationService(
        OwnedNativeTestLoader(
            ledger_case.factory,
            actor=Actor(account_id=ledger_case.actor.account_id, tenant_id=str(uuid4())),
            resolver=MetadataOwner(),
        )
    )
    assert isinstance(guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent), PolicyStop)
    assert ledger_case.dispatched_attempt_count() == 0


def test_completed_result_replays_and_changed_intent_conflicts(ledger_case):
    ledger_case.confirm()
    guard = ledger_case.guard
    permit = guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent)
    receipt = guard.record_outcome(permit=permit, outcome="completed", result_ref="protected-result")
    assert guard.record_outcome(permit=permit, outcome="completed", result_ref="protected-result") == receipt
    assert guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent) == RecordedResult(
        operation_id=permit.operation_id, result_ref="protected-result"
    )
    with pytest.raises(BuilderExecutionPolicyError, match="outcome_conflict"):
        guard.record_outcome(permit=permit, outcome="failed", result_ref=None)
    changed = ledger_case.intent.model_copy(update={"parameters": {"limit": 2}})
    assert isinstance(guard.before_call(ref=ledger_case.ref, intent=changed), PolicyStop)
    assert ledger_case.dispatched_attempt_count() == 1


def test_iteration_quota_is_shared_and_third_occurrence_waits(ledger_case):
    second, third = ledger_case.occurrence(1), ledger_case.occurrence(2)
    ledger_case.confirm(max_calls=2, max_dispatches=2)
    assert isinstance(ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent), DispatchPermit)
    assert isinstance(ledger_case.guard.before_call(ref=ledger_case.ref, intent=second), DispatchPermit)
    assert isinstance(ledger_case.guard.before_call(ref=ledger_case.ref, intent=third), ApprovalWait)
    assert ledger_case.dispatched_attempt_count() == 2


def test_two_processes_compete_for_one_dispatch(ledger_case):
    ctx = multiprocessing.get_context("fork")
    ledger_case.confirm()
    with ledger_case.factory() as session:
        url = session.get_bind().url
    children = []
    receivers = []
    start = ctx.Event()

    def worker(sender):
        engine = create_engine(url, poolclass=NullPool)
        try:
            child = LedgerCase(
                sessionmaker(engine, expire_on_commit=False),
                ledger_case.actor,
                ledger_case.ref,
                ledger_case.intent,
                MetadataOwner(),
            )
            assert start.wait(15)
            result = child.guard.before_call(ref=child.ref, intent=child.intent)
            sender.send(result.kind if isinstance(result, DispatchPermit) else result.reason_code)
        finally:
            engine.dispose()
            sender.close()

    try:
        for _ in range(2):
            receiver, sender = ctx.Pipe(duplex=False)
            process = ctx.Process(target=worker, args=(sender,))
            process.start()
            sender.close()
            children.append(process)
            receivers.append(receiver)
        start.set()
        assert all(receiver.poll(30) for receiver in receivers), "claim workers timed out"
        assert sorted(receiver.recv() for receiver in receivers) == ["dispatch", "dispatch_in_progress"]
    finally:
        for child in children:
            child.join(5)
            if child.is_alive():
                child.kill()
                child.join(5)
        for receiver in receivers:
            receiver.close()
    assert all(child.exitcode == 0 for child in children)
    assert ledger_case.dispatched_attempt_count() == 1


def test_crash_after_committed_claim_becomes_unknown(ledger_case):
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService

    ledger_case.confirm()
    ctx = multiprocessing.get_context("fork")
    receiver, sender = ctx.Pipe(duplex=False)
    with ledger_case.factory() as session:
        url = session.get_bind().url

    def worker():
        engine = create_engine(url, poolclass=NullPool)
        child = LedgerCase(
            sessionmaker(engine, expire_on_commit=False),
            ledger_case.actor,
            ledger_case.ref,
            ledger_case.intent,
            MetadataOwner(),
        )
        permit = child.guard.before_call(ref=child.ref, intent=child.intent)
        sender.send(permit.model_dump())
        ctx.Event().wait(60)

    process = ctx.Process(target=worker)
    try:
        process.start()
        sender.close()
        assert receiver.poll(30), "claim process timed out"
        permit = DispatchPermit.model_validate(receiver.recv())
    finally:
        if process.is_alive():
            process.kill()
        process.join(5)
        receiver.close()
    expired = datetime.fromisoformat(permit.expires_at) + timedelta(seconds=1)
    guard = EffectAuthorizationService(ledger_case.guard.loader, clock=lambda: expired)
    assert guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent) == PolicyStop(
        reason_code="outcome_unknown"
    )
    assert ledger_case.dispatched_attempt_count() == 1


def test_budget_reference_requires_matching_identity_and_consumes_no_extra_quota(ledger_case):
    ledger_case.confirm()
    guard = ledger_case.guard
    permit = guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent)
    first = guard.resolve_budget_reservation(permit=permit, execution_id="exec", invocation_digest="c" * 64)
    assert first == guard.resolve_budget_reservation(permit=permit, execution_id="exec", invocation_digest="c" * 64)
    with pytest.raises(BuilderExecutionPolicyError):
        guard.resolve_budget_reservation(permit=permit, execution_id="other", invocation_digest="c" * 64)
    assert ledger_case.dispatched_attempt_count() == 1


def test_configuration_and_interaction_are_not_effect_approvals(ledger_case):
    from models.dify_builder_native_tests import NativePendingAction
    from services.dify_builder.native_testing.pending_actions import NativePendingActionService

    service = NativePendingActionService(ledger_case.guard.loader)
    config = service.configuration(ref=ledger_case.ref, requirements_ref="configuration-1", expected_generation=0)
    form = service.interaction(ref=ledger_case.ref, native_form_ref="form-1", expected_generation=0)
    assert config.wait_reason == "configuration"
    assert form.wait_reason == "interaction"
    with ledger_case.factory() as session:
        rows = session.scalars(
            select(NativePendingAction).where(NativePendingAction.request_id == ledger_case.ref.request_id)
        ).all()
        assert {r.category for r in rows} == {"configuration", "interaction"}
        assert all(r.operation_id is None for r in rows)
    assert ledger_case.dispatched_attempt_count() == 0


def test_sql_checks_reject_overspend_and_invalid_outcome(ledger_case):
    from models.dify_builder_native_tests import NativeEffectAttempt, NativeEffectOutcome, NativeTestScope

    with ledger_case.factory() as session:
        row = session.get(NativeTestScope, ledger_case.ref.request_id)
        row.spent_dispatches = row.max_dispatches + 1
        with pytest.raises(IntegrityError):
            session.commit()
    ledger_case.confirm()
    permit = ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent)
    with pytest.raises(IntegrityError), ledger_case.factory.begin() as session:
        session.add(
            NativeEffectOutcome(
                tenant_id=ledger_case.actor.tenant_id,
                request_id=ledger_case.ref.request_id,
                invocation_id=ledger_case.ref.invocation_id,
                operation_id=permit.operation_id,
                attempt_id=permit.attempt_id,
                outcome="illegal",
                result_ref=None,
            )
        )
    with ledger_case.factory() as session:
        row = session.get(NativeEffectAttempt, permit.attempt_id)
        row.cost_units = 0
        with pytest.raises(DBAPIError, match="append-only"):
            session.commit()


@pytest.mark.parametrize("starting_schema", ["predecessor", "model_created"])
def test_native_migration_upgrade_downgrade_reupgrade(flask_app_with_containers, starting_schema):
    from extensions.ext_database import db

    migration = _native_migration()
    predecessor = _request_migration()
    schema = "native_migration_" + uuid4().hex
    with flask_app_with_containers.app_context(), db.engine.begin() as connection:
        assert connection.dialect.name == "postgresql"
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        context = MigrationContext.configure(connection, opts={"target_metadata": db.metadata})
        with Operations.context(context) as operations:
            if starting_schema == "predecessor":
                DifyBuilderTestInput.__table__.create(connection)
                operations.drop_column("dify_builder_test_inputs", "http_fixtures")
                predecessor.upgrade()
                _assert_single_request_state_check(connection, native=False)
                _assert_waiting_policy(connection, native=False)
            else:
                DifyBuilderExecutionRequest.__table__.create(connection)
                _assert_single_request_state_check(connection, native=True)
                # The model already has the new index; remove just that index
                # so upgrade tests replacing its convention-named CHECK.
                operations.drop_index("builder_native_waiting_idx", table_name="dify_builder_execution_requests")
            migration.upgrade()
            _assert_single_request_state_check(connection, native=True)
            _assert_waiting_policy(connection, native=True)
            assert "dify_builder_native_attempts" in inspect(connection).get_table_names(schema=schema)
            migration.downgrade()
            _assert_single_request_state_check(connection, native=False)
            _assert_waiting_policy(connection, native=False)
            assert "dify_builder_native_attempts" not in inspect(connection).get_table_names(schema=schema)
            # Schema-qualified downgrade must not remove the public race trigger.
            assert connection.scalar(text("SELECT to_regprocedure('public.builder_native_immutable_ledger()')"))
            migration.upgrade()
            _assert_single_request_state_check(connection, native=True)
            _assert_waiting_policy(connection, native=True)
            if starting_schema == "predecessor":
                migration.downgrade()
                predecessor.downgrade()
                assert "dify_builder_execution_requests" not in inspect(connection).get_table_names(schema=schema)
                predecessor.upgrade()
                migration.upgrade()
                _assert_single_request_state_check(connection, native=True)
        connection.execute(text("SET LOCAL search_path TO public"))
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def test_permission_revocation_and_serialized_revision_drift_never_dispatch(ledger_case):
    from models.workflow import Workflow

    ledger_case.confirm()
    with ledger_case.factory.begin() as session:
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == ledger_case.actor.tenant_id,
                TenantAccountJoin.account_id == ledger_case.actor.account_id,
            )
        )
        original_role = membership.role
        membership.role = "normal"
    assert isinstance(ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent), PolicyStop)
    with ledger_case.factory.begin() as session:
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == ledger_case.actor.tenant_id,
                TenantAccountJoin.account_id == ledger_case.actor.account_id,
            )
        )
        membership.role = original_role
        request = session.get(DifyBuilderExecutionRequest, ledger_case.ref.request_id)
        workflow = session.get(Workflow, request.workflow_id)
        workflow.graph = workflow.graph + " "
    assert ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent) == PolicyStop(
        reason_code="native_revision_drift"
    )
    assert ledger_case.dispatched_attempt_count() == 0


def test_oauth_requires_its_own_bounded_approval(ledger_case):
    from models.dify_builder_native_tests import NativeTestInvocation
    from services.dify_builder.native_testing.repository import NativeBinding

    ledger_case.confirm()
    oauth = ledger_case.intent.model_copy(
        update={
            "kind": "oauth",
            "resource_ref": "mail.oauth.refresh",
            "key": ledger_case.intent.key.model_copy(update={"cursor": 1}),
        }
    )
    with ledger_case.factory.begin() as session:
        row = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == ledger_case.ref.request_id)
        )
        bindings = dict(row.bindings)
        base = NativeBinding.model_validate(bindings[operation_digest(ledger_case.intent.key)])
        bindings[operation_digest(oauth.key)] = base.model_copy(
            update={
                "kind": "oauth",
                "resource_ref": "mail.oauth.refresh",
                "intent_digest": canonical_digest(oauth.model_dump(mode="json")),
            }
        ).model_dump(mode="json")
        row.bindings = bindings
    guard = ledger_case.guard
    assert isinstance(guard.before_call(ref=ledger_case.ref, intent=oauth), ApprovalWait)
    assert ledger_case.dispatched_attempt_count() == 0
    guard.decide(
        ref=ledger_case.ref,
        intent=oauth,
        decision="approved",
        max_calls=1,
        max_dispatches=1,
        max_cost_units=2,
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    assert isinstance(guard.before_call(ref=ledger_case.ref, intent=oauth), DispatchPermit)
    assert isinstance(guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent), DispatchPermit)
    assert guard.before_call(ref=ledger_case.ref, intent=oauth) == PolicyStop(reason_code="dispatch_in_progress")
    assert ledger_case.dispatched_attempt_count() == 2


def test_permit_returns_only_after_commit_and_releases_request_lock(ledger_case):
    from models.dify_builder_native_tests import NativeTestScope

    ledger_case.confirm()
    permit = ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent)
    assert isinstance(permit, DispatchPermit)
    # Independent connection can immediately acquire the same lock at the
    # adapter's I/O boundary, and observes its committed spend.
    with ledger_case.factory.begin() as session:
        session.scalar(
            select(DifyBuilderExecutionRequest)
            .where(DifyBuilderExecutionRequest.id == ledger_case.ref.request_id)
            .with_for_update(nowait=True)
        )
        scope = session.get(NativeTestScope, ledger_case.ref.request_id)
        assert scope.spent_calls == scope.spent_dispatches == 1
        assert scope.spent_cost_units == 2


def test_child_invocation_shares_root_budget(ledger_case):
    from models.dify_builder_native_tests import NativeTestInvocation, NativeTestScope
    from services.dify_builder.native_testing.repository import NativeBinding

    ledger_case.confirm(max_calls=2, max_dispatches=2)
    child_ref = ledger_case.ref.model_copy(update={"invocation_id": "child"})
    child_intent = ledger_case.intent.model_copy(
        update={"key": ledger_case.intent.key.model_copy(update={"invocation_id": "child"})}
    )
    with ledger_case.factory.begin() as session:
        row = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == ledger_case.ref.request_id)
        )
        base = NativeBinding.model_validate(row.bindings[operation_digest(ledger_case.intent.key)])
        binding = base.model_copy(
            update={
                "intent_digest": canonical_digest(child_intent.model_dump(mode="json")),
                "execution_id": "child-exec",
                "invocation_digest": "d" * 64,
            }
        )
        session.add(
            NativeTestInvocation(
                tenant_id=ledger_case.actor.tenant_id,
                request_id=ledger_case.ref.request_id,
                invocation_id="child",
                active=True,
                bindings={operation_digest(child_intent.key): binding.model_dump(mode="json")},
            )
        )
        scope = session.get(NativeTestScope, ledger_case.ref.request_id)
        scope.budget_limits = {"cpu_ms": 10}
    assert isinstance(ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent), DispatchPermit)
    assert ledger_case.guard.before_call(ref=child_ref, intent=child_intent) == PolicyStop(
        reason_code="native_budget_exhausted"
    )
    assert ledger_case.dispatched_attempt_count() == 1


def test_legacy_request_cannot_enter_native_waiting(ledger_case):
    with ledger_case.factory() as session:
        request = session.get(DifyBuilderExecutionRequest, ledger_case.ref.request_id)
        request.context = {"policy_version": "builder-execution-v1"}
        request.state = "waiting"
        with pytest.raises(IntegrityError):
            session.commit()


def test_spent_permit_can_settle_after_cancel_without_new_dispatch(ledger_case):
    from models.dify_builder_native_tests import NativeTestScope

    ledger_case.confirm()
    guard = ledger_case.guard
    permit = guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent)
    with ledger_case.factory.begin() as session:
        session.get(NativeTestScope, ledger_case.ref.request_id).cancelled = True
        session.get(DifyBuilderExecutionRequest, ledger_case.ref.request_id).state = "sealed"
    receipt = guard.record_outcome(permit=permit, outcome="completed", result_ref="result-after-cancel")
    assert receipt.outcome == "completed"
    assert guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent) == PolicyStop(
        reason_code="native_cancelled"
    )
    assert ledger_case.dispatched_attempt_count() == 1


def test_forged_permit_cannot_record_or_resolve_reservation(ledger_case):
    ledger_case.confirm()
    guard = ledger_case.guard
    permit = guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent)
    forged = permit.model_copy(update={"permit_id": str(uuid4())})
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_dispatch_permit"):
        guard.record_outcome(permit=forged, outcome="completed", result_ref="fake-result")
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_dispatch_permit"):
        guard.resolve_budget_reservation(permit=forged, execution_id="exec", invocation_digest="c" * 64)
    assert guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent) == PolicyStop(
        reason_code="dispatch_in_progress"
    )
