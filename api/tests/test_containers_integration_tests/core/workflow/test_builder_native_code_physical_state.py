"""CI ONLY: real PostgreSQL witnesses. Never import or collect this tree locally.

Injected currentness is a trusted explicit test double, not actual host fencing.
Tests exercise SQL rows, transactions and constraints; no process/network work.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from services.dify_builder.native_testing.sandbox.contracts import CodeAcquisitionRef


from typing import TYPE_CHECKING, NotRequired, Unpack

from typing_extensions import TypedDict

if TYPE_CHECKING:
    import services.dify_builder.native_testing.sandbox.repository as _forward_types_0


from typing import TYPE_CHECKING

from sqlalchemy.orm.state import InstanceState

from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import require_instance

if TYPE_CHECKING:
    from collections.abc import Iterator

    from dify_app import DifyApp
    from runtime_contracts.builder.native.contracts import (
        DispatchPermit,
        EffectIntent,
        OperationKey,
    )
    from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
        PhysicalCodeCase,
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


from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from time import monotonic
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from shellctl.shared.schemas import NativeScopeLimits, NativeScopeSpec
from sqlalchemy import func, insert, select, text
from sqlalchemy import inspect as inspect_orm
from sqlalchemy.exc import DBAPIError, IntegrityError

from models.dify_builder_native_code import NativeCodePhysicalOperation
from models.dify_builder_native_tests import (
    NativeDispatch,
    NativeInvocationState,
    NativeTestInvocation,
    NativeTestScope,
)
from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
    canonical_digest,
)
from runtime_contracts.builder.native.contracts import (
    DispatchPermit,
    EffectIntent,
    OperationKey,
    operation_digest,
)
from services.dify_builder.native_testing.repository import NativeBinding
from services.dify_builder.native_testing.sandbox.contracts import (
    CodeAcquisitionRef,
    CodePhysicalRef,
    CodeScopeSpec,
)
from services.dify_builder.native_testing.sandbox.repository import (
    NativeCodePhysicalRepository,
)
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
    CodeDispatchIdentity,
    PhysicalCodeArguments,
    PhysicalCodeCase,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_dispatch_claims import (
    migrated_dispatch_claims as migrated_dispatch_claims,  # noqa: PLC0414 - pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    _migration,
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    ledger_case as ledger_case,  # noqa: PLC0414 - pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414 - pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    native_owner as native_owner,  # noqa: PLC0414 - pytest fixture
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    no_live as no_live,  # noqa: PLC0414 - pytest fixture
)

MIGRATION = "2026_10_16_1800-7d2b9c4e61a8_add_native_code_physical_owners.py"
TABLE = "dify_builder_native_code_physical_operations"


def fixed_transaction_deadline() -> Callable[[bool], float]:
    """Synthetic fixed budget; does not attest a retained host acquisition."""
    deadline = monotonic() + 60
    return lambda _settlement: deadline


@pytest.fixture(scope="module", autouse=True)
def physical_migration(migrated_dispatch_claims: None, flask_app_with_containers: DifyApp) -> Iterator[None]:
    del migrated_dispatch_claims
    from extensions.ext_database import db

    with flask_app_with_containers.app_context(), db.engine.begin() as connection:
        assert connection.dialect.name == "postgresql"
        # create_all may have created metadata-only table; the predecessor reset
        # drops this child first. Neither path counts as migration qualification.
        connection.execute(text(f"DROP TABLE IF EXISTS {TABLE}"))
        connection.execute(text("DROP FUNCTION IF EXISTS builder_code_physical_monotone()"))
        with Operations.context(MigrationContext.configure(connection)):
            migration = _migration(MIGRATION)
            assert migration.down_revision == "e59b7d32a6c1"
            config = Config()
            config.set_main_option("script_location", str(Path(__file__).parents[4] / "migrations"))
            scripts = ScriptDirectory.from_config(config)
            assert scripts.get_heads() == ["d41e6b8c2a75"]
            merge = scripts.get_revision("d41e6b8c2a75")
            assert merge is not None
            assert merge.down_revision == ("c6f4a90d8b31", "7d2b9c4e61a8")
            for current in ("base", "c6f4a90d8b31", "7d2b9c4e61a8"):
                planned = scripts._upgrade_revs("head", current)
                assert planned[-1].revision.revision == "d41e6b8c2a75"
            steps = list(scripts.iterate_revisions("7d2b9c4e61a8", "e59b7d32a6c1"))
            assert [step.revision for step in steps] == ["7d2b9c4e61a8"]
            for step in reversed(steps):
                step.module.upgrade()
            migration.downgrade()  # Empty-evidence rollback only.
            migration.upgrade()
    yield
    # Test-owned fixture teardown. Product downgrade itself never deletes evidence.
    with flask_app_with_containers.app_context(), db.engine.begin() as connection:
        connection.execute(text(f"DROP TABLE {TABLE}"))
        connection.execute(text("DROP FUNCTION builder_code_physical_monotone()"))


class CurrentAcquisition:
    def __init__(self, expected: CodeAcquisitionRef) -> None:
        self.expected = expected
        self.current = True

    def check_current(self, acquisition: CodeAcquisitionRef) -> None:
        if not self.current or acquisition != self.expected:
            raise BuilderExecutionPolicyError("stale_code_acquisition")


@pytest.fixture
def code_case(ledger_case: _fixture_types_0.LedgerCase, physical_migration: None) -> PhysicalCodeCase:
    del physical_migration
    case = ledger_case
    now = datetime.now(UTC)
    execution_id, dispatch_id = str(uuid4()), str(uuid4())
    spec = CodeScopeSpec(
        native=NativeScopeSpec(
            scope_id="code_" + uuid4().hex,
            generation=1,
            binding_ref="code_" + uuid4().hex,
            base_snapshot_ref="qualified_empty",
            capability_digest="b" * 64,
            deadline=now + timedelta(seconds=20),
            limits=NativeScopeLimits(
                cpu_quota=1000,
                memory_bytes=64 << 20,
                pids=8,
                fds=32,
                wall_seconds=20,
                input_bytes=1,
                output_bytes=4096,
                disk_bytes=1 << 20,
            ),
        ),
        environment_digest="e" * 64,
        base_snapshot_digest="f" * 64,
    )
    target = {
        "code_physical": {
            "scope_spec_digest": canonical_digest(spec.native.model_dump(mode="json")),
            "environment_digest": spec.environment_digest,
            "base_snapshot_ref": spec.native.base_snapshot_ref,
            "base_snapshot_digest": spec.base_snapshot_digest,
            "payload_digest": "c" * 64,
            "profile_digest": "d" * 64,
        }
    }
    effect = EffectIntent(
        key=OperationKey(
            invocation_id=case.ref.invocation_id,
            occurrence_path=(execution_id,),
            cursor=0,
        ),
        kind="code",
        resource_ref="code",
        implementation_revision="v1",
        account_ref=None,
        target=target,
        parameters={},
        input_digest="a" * 64,
        capability_digest="b" * 64,
    )
    binding = NativeBinding(
        intent_digest=canonical_digest(effect.model_dump(mode="json")),
        kind="code",
        resource_ref="code",
        implementation_revision="v1",
        account_ref=None,
        capability_digest="b" * 64,
        resource_version="resource-v1",
        credential_version="credential-v1",
        isolated=True,
        egress=False,
        new_data=False,
        destructive=False,
        cost_units=2,
        budget={"cpu_ms": 10},
        execution_id=execution_id,
        invocation_digest="c" * 64,
    )
    with case.factory.begin() as session:
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == case.ref.request_id)
        )
        require_instance(invocation, NativeTestInvocation).bindings = {
            operation_digest(effect.key): binding.model_dump(mode="json")
        }
        session.add(
            NativeDispatch(
                id=dispatch_id,
                tenant_id=case.actor.tenant_id,
                request_id=case.ref.request_id,
                invocation_id=case.ref.invocation_id,
                generation=0,
                idempotency_digest=uuid4().hex + uuid4().hex,
                state="claimed",
                checkpoint_id=None,
                claim_expires_at=now + timedelta(minutes=1),
            )
        )
    case.intent = effect
    case.confirm()
    permit = case.guard.before_call(ref=case.ref, intent=effect)
    assert isinstance(permit, DispatchPermit)
    case.guard.claim_dispatch(ref=case.ref, intent=effect, permit=permit)
    acquisition = CodeAcquisitionRef(
        ref=case.ref,
        root_dispatch_id=dispatch_id,
        generation=0,
        acquisition_id=str(uuid4()),
    )
    current = CurrentAcquisition(acquisition)
    repo = NativeCodePhysicalRepository(
        case.guard.loader, acquisition_owner=current, transaction_deadline=fixed_transaction_deadline()
    )
    args: PhysicalCodeArguments = {
        "ref": case.ref,
        "key": effect.key,
        "intent": effect,
        "permit": permit,
        "acquisition": acquisition,
        "spec": spec,
        "payload_digest": "c" * 64,
        "profile_digest": "d" * 64,
        "physical_deadline": now + timedelta(seconds=15),
    }
    return PhysicalCodeCase(case=case, repo=repo, current=current, args=args)


def count_rows(t: PhysicalCodeCase) -> int | None:
    with t.case.factory() as session:
        return session.scalar(
            select(func.count())
            .select_from(NativeCodePhysicalOperation)
            .where(NativeCodePhysicalOperation.request_id == t.case.ref.request_id)
        )


def test_two_sessions_compete_for_one_scope_reservation(code_case: PhysicalCodeCase) -> None:
    t = code_case
    barrier = Barrier(2)

    def reserve() -> CodePhysicalRef | None:
        repository = NativeCodePhysicalRepository(
            t.case.guard.loader, acquisition_owner=t.current, transaction_deadline=fixed_transaction_deadline()
        )
        barrier.wait(timeout=10)
        try:
            return repository.reserve_scope(**t.args)
        except BuilderExecutionPolicyError:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: reserve(), range(2)))
    assert sum(result is not None for result in results) == 1
    assert count_rows(t) == 1


def test_job_association_and_input_fence_are_visible_before_return(code_case: PhysicalCodeCase) -> None:
    t = code_case
    p = t.repo.reserve_scope(**t.args)
    t.repo.ack_scope(physical=p, scope_id=p.scope_id, generation=1)
    bound = t.repo.bind(physical=p, intent=t.args["intent"], permit=t.args["permit"])
    identity = CodeDispatchIdentity(operation_ref=p.operation_id, scope_id=p.scope_id, generation=1)
    bound.reserve_dispatch(identity, payload_digest=p.payload_digest, profile_digest=p.profile_digest)
    bound.associate_job(identity, "job_1")
    with t.case.factory() as session:
        row = session.get(NativeCodePhysicalOperation, p.id)
        assert require_instance(row, NativeCodePhysicalOperation).job_reserved
        assert require_instance(row, NativeCodePhysicalOperation).job_id == "job_1"
        assert require_instance(row, NativeCodePhysicalOperation).input_may_have_been_sent
    with pytest.raises(BuilderExecutionPolicyError):
        bound.associate_job(identity, "job_1")
    with pytest.raises(BuilderExecutionPolicyError):
        bound.reserve_dispatch(identity, payload_digest=p.payload_digest, profile_digest=p.profile_digest)


@pytest.mark.parametrize(
    "field",
    [
        "tenant_id",
        "actor_id",
        "operation_id",
        "attempt_id",
        "effect_claim_id",
        "native_execution_id",
    ],
)
def test_foreign_owner_refs_cannot_acknowledge_scope(code_case: PhysicalCodeCase, field: str) -> None:
    t = code_case
    p = t.repo.reserve_scope(**t.args)
    forged = p.model_copy(update={field: str(uuid4())})
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.ack_scope(physical=forged, scope_id=p.scope_id, generation=1)
    with t.case.factory() as session:
        assert not require_instance(
            session.get(NativeCodePhysicalOperation, p.id), NativeCodePhysicalOperation
        ).scope_create_acked


@pytest.mark.parametrize(
    ("field", "value"),
    [("root_dispatch_id", None), ("acquisition_id", None), ("generation", 1)],
)
def test_foreign_root_acquisition_refuses_before_creation(
    code_case: PhysicalCodeCase, field: str, value: None | int
) -> None:
    t = code_case
    args = t.args.copy()
    args["acquisition"] = args["acquisition"].model_copy(update={field: str(uuid4()) if value is None else value})
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**args)
    assert count_rows(t) == 0


def test_cancelled_expired_scope_accepts_only_retained_settlement(code_case: PhysicalCodeCase) -> None:
    t = code_case
    p = t.repo.reserve_scope(**t.args)
    with t.case.factory.begin() as session:
        scope = session.get(NativeTestScope, t.case.ref.request_id)
        require_instance(scope, NativeTestScope).cancelled = True
        require_instance(scope, NativeTestScope).expires_at = datetime.now(UTC) - timedelta(seconds=1)
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == t.case.ref.request_id)
        )
        require_instance(invocation, NativeTestInvocation).active = False
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == t.case.ref.request_id)
        )
        require_instance(state, NativeInvocationState).state = "cancelled"
    t.repo.mark_unknown(physical=p)
    t.repo.ack_destroyed(physical=p)
    result = t.repo.load_for_settlement(ref=p.ref, operation_id=p.operation_id, acquisition=p.acquisition)
    assert result.ambiguous
    assert result.destroyed_at is not None
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.ack_scope(physical=p, scope_id=p.scope_id, generation=1)
    with t.case.factory() as session:
        state = session.scalar(
            select(NativeInvocationState).where(NativeInvocationState.request_id == t.case.ref.request_id)
        )
        assert not require_instance(state, NativeInvocationState).cleanup_complete


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM {table} WHERE id=:id",
        "UPDATE {table} SET payload_digest=repeat('9',64) WHERE id=:id",
        "UPDATE {table} SET observed_output_offset=0 WHERE id=:id",
        "UPDATE {table} SET job_id='replacement' WHERE id=:id",
        "UPDATE {table} SET ambiguous=false WHERE id=:id",
        "UPDATE {table} SET destroyed_at=NULL WHERE id=:id",
    ],
)
def test_sql_retention_blocks_identity_job_offset_and_evidence_regression(
    code_case: PhysicalCodeCase, sql: str
) -> None:
    t = code_case
    p = t.repo.reserve_scope(**t.args)
    t.repo.ack_scope(physical=p, scope_id=p.scope_id, generation=1)
    t.repo.reserve_dispatch(
        physical=p,
        intent=t.args["intent"],
        permit=t.args["permit"],
        payload_digest=p.payload_digest,
        profile_digest=p.profile_digest,
    )
    t.repo.associate_job(physical=p, intent=t.args["intent"], permit=t.args["permit"], job_id="job1")
    t.repo.observe_output(physical=p, job_id="job1", expected_offset=0, next_offset=5)
    t.repo.mark_unknown(physical=p)
    t.repo.ack_destroyed(physical=p)
    with pytest.raises(DBAPIError), t.case.factory.begin() as session:
        session.execute(text(sql.format(table=TABLE)), {"id": p.id})


def test_downgrade_refuses_nonempty_evidence(code_case: PhysicalCodeCase) -> None:
    t = code_case
    t.repo.reserve_scope(**t.args)
    with (
        pytest.raises(RuntimeError, match="must be retained"),
        t.case.factory.begin() as session,
        Operations.context(MigrationContext.configure(session.connection())),
    ):
        _migration(MIGRATION).downgrade()
    assert count_rows(t) == 1


def test_commit_response_loss_leaves_one_reservation_and_no_second_permission(
    code_case: PhysicalCodeCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    t = code_case
    original = t.repo._transaction

    @contextmanager
    def lost(
        **kwargs: Unpack[_ForwardArguments454],
    ) -> _forward_types_0.Generator[
        tuple[_forward_types_0.Session, _forward_types_0.OwnedNativeTest, _forward_types_0.NativeTestScope]
    ]:
        with original(**kwargs) as state:
            yield state
        raise ConnectionError("commit acknowledgement lost")

    monkeypatch.setattr(t.repo, "_transaction", lost)
    with pytest.raises(ConnectionError):
        t.repo.reserve_scope(**t.args)
    assert count_rows(t) == 1
    monkeypatch.setattr(t.repo, "_transaction", original)
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**t.args)


def test_rollback_never_returns_a_physical_ref_or_permits_io(
    code_case: PhysicalCodeCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    t = code_case
    original = t.repo._transaction
    io = []

    @contextmanager
    def rollback(
        **kwargs: Unpack[_ForwardArguments476],
    ) -> _forward_types_0.Generator[
        tuple[_forward_types_0.Session, _forward_types_0.OwnedNativeTest, _forward_types_0.NativeTestScope]
    ]:
        with original(**kwargs) as state:
            yield state
            raise ConnectionError("transaction aborted before commit")

    monkeypatch.setattr(t.repo, "_transaction", rollback)

    def reserve_scope_then_create() -> None:
        t.repo.reserve_scope(**t.args)
        io.append("scope-create")

    with pytest.raises(ConnectionError):
        reserve_scope_then_create()
    assert io == []
    assert count_rows(t) == 0
    monkeypatch.setattr(t.repo, "_transaction", original)
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.reserve_scope(**t.args)
    assert count_rows(t) == 0


def test_foreign_pk_is_enforced_by_postgresql(code_case: PhysicalCodeCase) -> None:
    t = code_case
    p = t.repo.reserve_scope(**t.args)
    # Immutable UPDATE must fail even before FK evaluation; a raw INSERT with a
    # fresh scope and all unique owner references exercises the actual FK.
    with t.case.factory() as session:
        row = session.get(NativeCodePhysicalOperation, p.id)
        values = {
            column.name: require_instance(inspect_orm(row), InstanceState).attrs[column.name].value
            for column in require_instance(row, NativeCodePhysicalOperation).__table__.columns
        }
    for name in (
        "id",
        "operation_id",
        "attempt_id",
        "effect_claim_id",
        "host_dispatch_id",
    ):
        values[name] = str(uuid4())
    values["scope_id"] = "code_" + uuid4().hex
    with pytest.raises(IntegrityError), t.case.factory.begin() as session:
        session.execute(insert(NativeCodePhysicalOperation).values(**values))


def test_upgrade_installs_explicit_foreign_keys_and_retention_trigger(code_case: PhysicalCodeCase) -> None:
    from sqlalchemy import inspect

    t = code_case
    with t.case.factory() as session:
        foreign_keys = inspect(session.connection()).get_foreign_keys(TABLE)
        assert {tuple(item["constrained_columns"]) for item in foreign_keys} == {
            ("operation_id",),
            ("attempt_id",),
            ("effect_claim_id",),
            ("host_dispatch_id",),
            ("tenant_id", "request_id", "invocation_id"),
        }
        assert (
            session.scalar(
                text(
                    "SELECT count(*) FROM pg_trigger WHERE tgrelid=CAST(:table AS regclass) "
                    "AND tgname='code_physical_monotone'"
                ),
                {"table": TABLE},
            )
            == 1
        )


def test_individually_valid_foreign_keys_do_not_prove_same_owner_chain(code_case: PhysicalCodeCase) -> None:
    from models.dify_builder_native_tests import (
        NativeEffectAttempt,
        NativeEffectDispatchClaim,
        NativeEffectOperation,
    )

    t = code_case
    p = t.repo.reserve_scope(**t.args)
    with t.case.factory.begin() as session:
        original = session.get(NativeCodePhysicalOperation, p.id)
        physical_values = {
            c.name: require_instance(inspect_orm(original), InstanceState).attrs[c.name].value
            for c in require_instance(original, NativeCodePhysicalOperation).__table__.columns
        }
        alternatives = []
        for _ in range(2):
            operation_id, attempt_id, claim_id = (str(uuid4()) for _ in range(3))
            operation_digest_value = uuid4().hex + uuid4().hex
            for model, source_id, changes in (
                (
                    NativeEffectOperation,
                    p.operation_id,
                    {"id": operation_id, "operation_digest": operation_digest_value},
                ),
                (
                    NativeEffectAttempt,
                    p.attempt_id,
                    {
                        "id": attempt_id,
                        "operation_id": operation_id,
                        "permit_digest": uuid4().hex + uuid4().hex,
                        "budget_reservation_ref": str(uuid4()),
                    },
                ),
                (
                    NativeEffectDispatchClaim,
                    p.effect_claim_id,
                    {
                        "id": claim_id,
                        "operation_id": operation_id,
                        "attempt_id": attempt_id,
                    },
                ),
            ):
                original_owner = session.get(model, source_id)
                values = {
                    c.name: require_instance(inspect_orm(original_owner), InstanceState).attrs[c.name].value
                    for c in require_instance(original_owner, model).__table__.columns
                }
                session.execute(insert(model).values(**(values | changes)))
            alternatives.append((operation_id, attempt_id, claim_id, operation_digest_value))
        second, third = alternatives
        # Every referenced PK exists and is individually foreign-key-valid.
        physical_values.update(
            id=str(uuid4()),
            operation_id=second[0],
            attempt_id=third[1],
            effect_claim_id=second[2],
            operation_digest=second[3],
            scope_id="code_" + uuid4().hex,
        )
        session.execute(insert(NativeCodePhysicalOperation).values(**physical_values))
    with pytest.raises(BuilderExecutionPolicyError):
        t.repo.load_for_settlement(ref=p.ref, operation_id=second[0], acquisition=p.acquisition)


class _ForwardArguments454(TypedDict, closed=True):
    ref: _forward_types_0.NativeTestContextRef
    acquisition: _forward_types_0.CodeAcquisitionRef
    settlement: bool
    deadline: NotRequired[_forward_types_0.datetime | None]


class _ForwardArguments476(TypedDict, closed=True):
    ref: _forward_types_0.NativeTestContextRef
    acquisition: _forward_types_0.CodeAcquisitionRef
    settlement: bool
    deadline: NotRequired[_forward_types_0.datetime | None]
