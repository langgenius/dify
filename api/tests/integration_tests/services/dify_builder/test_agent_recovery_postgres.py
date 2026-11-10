"""Contention uses a disposable local PostgreSQL cluster, never configured DBs."""

import shutil
import socket
import subprocess
import tempfile
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import Table, create_engine, select
from sqlalchemy.engine import URL, Engine
from sqlalchemy.orm import sessionmaker

from models.dify_builder_native_tests import NativeTestInvocation
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.native_testing.agent_recovery import claim_recovery_allocation, reserve_recovery_attempt
from services.dify_builder.native_testing.agent_recovery_state import AgentRecoveryRecord
from tests.unit_tests.services.dify_builder.native_testing.test_agent_recovery_state import record_payload


@pytest.fixture
def ephemeral_postgres(tmp_path: Path) -> Generator[Engine]:
    """Own only the new temp data/socket directories and stop the child on exit."""
    initdb, pg_ctl = shutil.which("initdb"), shutil.which("pg_ctl")
    if initdb is None or pg_ctl is None:
        pytest.skip("disposable PostgreSQL binaries unavailable")
    data = tmp_path / "data"
    socket_directory = tempfile.TemporaryDirectory(prefix="recovery-pg-", dir="/tmp")
    sockets = Path(socket_directory.name)
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    engine = None
    try:
        subprocess.run(
            [initdb, "-D", str(data), "-A", "trust", "--no-locale", "-E", "UTF8"],
            check=True,
            capture_output=True,
            timeout=30,
        )
        subprocess.run(
            [
                pg_ctl,
                "-D",
                str(data),
                "-l",
                str(tmp_path / "postgres.log"),
                "-w",
                "start",
                "-o",
                f"-h '' -k {sockets} -p {port}",
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
        engine = create_engine(
            URL.create("postgresql+psycopg2", database="postgres", query={"host": str(sockets), "port": str(port)})
        )
        yield engine
    finally:
        try:
            if engine is not None:
                engine.dispose()
        finally:
            try:
                if data.exists():
                    subprocess.run(
                        [pg_ctl, "-D", str(data), "-m", "fast", "-w", "stop"],
                        check=False,
                        capture_output=True,
                        timeout=30,
                    )
            finally:
                socket_directory.cleanup()


def test_real_postgres_coalesces_two_keys_and_one_reserved_to_creating(ephemeral_postgres: Engine) -> None:
    table = NativeTestInvocation.__table__
    assert isinstance(table, Table)
    table.create(ephemeral_postgres)
    factory = sessionmaker(ephemeral_postgres, expire_on_commit=False)
    tenant_id = str(uuid4())
    ref = NativeTestContextRef(request_id=str(uuid4()), invocation_id="inv", context_digest="a" * 64)
    with factory.begin() as session:
        session.add(
            NativeTestInvocation(
                tenant_id=tenant_id,
                request_id=ref.request_id,
                invocation_id=ref.invocation_id,
                active=True,
                bindings={},
            )
        )
    barrier = Barrier(12)

    def compete(index: int) -> tuple[AgentRecoveryRecord, bool, AgentRecoveryRecord | None]:
        value = record_payload()
        value.update(
            reserved_binding_id=str(uuid4()),
            reserved_workspace_id=str(uuid4()),
            interaction_idempotency_digest=("e" if index % 2 else "f") * 64,
        )
        candidate = AgentRecoveryRecord.model_validate(value)
        barrier.wait(timeout=15)
        with factory.begin() as session:
            reserved, inserted = reserve_recovery_attempt(
                session=session, tenant_id=tenant_id, ref=ref, proposed=candidate
            )
        with factory.begin() as session:
            winner = claim_recovery_allocation(session=session, tenant_id=tenant_id, ref=ref, expected=reserved)
        return reserved, inserted, winner

    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(compete, range(12)))
    assert sum(inserted for _record, inserted, _winner in results) == 1
    assert sum(winner is not None for _record, _inserted, winner in results) == 1
    assert len({record.reserved_binding_id for record, _inserted, _winner in results}) == 1
    assert len({record.reserved_workspace_id for record, _inserted, _winner in results}) == 1
    with factory.begin() as session:
        assert claim_recovery_allocation(session=session, tenant_id=tenant_id, ref=ref, expected=results[0][0]) is None


def test_real_postgres_snapshot_and_reservation_have_one_ordering_owner(ephemeral_postgres: Engine) -> None:
    from threading import Event

    from models.agent import AgentWorkspaceBinding
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef
    from services.dify_builder.native_testing import agent_recovery
    from services.dify_builder.native_testing.agent_recovery_state import RECOVERY_RECORD_KEY
    from tests.unit_tests.services.dify_builder.native_testing.test_agent_recovery import recovery_sql_selection

    factory = sessionmaker(ephemeral_postgres, expire_on_commit=False)
    ref = NativeTestContextRef(request_id=str(uuid4()), invocation_id="inv", context_digest="a" * 64)
    with factory.begin() as session:
        scope, selection = recovery_sql_selection(session, tenant_id=str(uuid4()), ref=ref)
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
        )
        assert invocation is not None
        invocation.bindings = {key: value for key, value in invocation.bindings.items() if key != RECOVERY_RECORD_KEY}
    identity = agent_recovery.ConfirmedSnapshotIdentity(
        AgentParentNodeRef.model_validate(selection.relation.parent_node.model_dump(mode="json")),
        1,
        "child",
        2,
        selection.expected.predecessor,
    )
    proposed = AgentRecoveryRecord.model_validate(
        {**selection.expected.model_dump(), "phase": "reserved", "allocation_receipt_ref": None}
    )
    snapshot_written, allow_commit, reservation_started = Event(), Event(), Event()

    def snapshot_first() -> None:
        with factory.begin() as session:
            agent_recovery.write_confirmed_snapshot(
                session=session,
                tenant_id=scope.tenant_id,
                bindings={},
                identity=identity,
                current=identity,
                serialized_snapshot="before reservation",
            )
            snapshot_written.set()
            assert allow_commit.wait(timeout=15)

    def reserve_second() -> AgentRecoveryRecord:
        assert snapshot_written.wait(timeout=15)
        reservation_started.set()
        with factory.begin() as session:
            reserved, _ = reserve_recovery_attempt(
                session=session, tenant_id=scope.tenant_id, ref=ref, proposed=proposed
            )
            return reserved

    with ThreadPoolExecutor(max_workers=2) as pool:
        writer = pool.submit(snapshot_first)
        reserver = pool.submit(reserve_second)
        assert reservation_started.wait(timeout=15)
        assert not reserver.done()
        allow_commit.set()
        writer.result(timeout=15)
        reserved = reserver.result(timeout=15)
    assert reserved.phase == "reserved"
    with factory.begin() as session:
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_unready"):
            agent_recovery.write_confirmed_snapshot(
                session=session,
                tenant_id=scope.tenant_id,
                bindings={},
                identity=identity,
                current=identity,
                serialized_snapshot="stale after reservation",
            )
        stored = session.get(AgentWorkspaceBinding, identity.binding.binding_id)
        assert stored is not None
        assert stored.session_snapshot == "before reservation"


def test_real_postgres_finalization_rolls_back_and_retries_same_confirmed_allocation(
    ephemeral_postgres: Engine,
) -> None:
    from models.agent import AgentWorkingResourceStatus, AgentWorkspace, AgentWorkspaceBinding
    from models.workflow import WorkflowNodeExecutionModel
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.agent_contracts import AgentParentNodeRef
    from services.dify_builder.native_testing import agent_recovery
    from services.dify_builder.native_testing.agent_recovery_state import RECOVERY_RECORD_KEY
    from tests.unit_tests.services.dify_builder.native_testing.test_agent_recovery import recovery_sql_selection

    factory = sessionmaker(ephemeral_postgres, expire_on_commit=False)
    ref = NativeTestContextRef(request_id=str(uuid4()), invocation_id="inv", context_digest="a" * 64)
    with factory.begin() as session:
        scope, selection = recovery_sql_selection(session, tenant_id=str(uuid4()), ref=ref)

    def fail_after_selection() -> None:
        with factory.begin() as session:
            agent_recovery.finalize_recovery_selection(
                session=session, tenant_id=scope.tenant_id, ref=ref, selection=selection, session_scope=scope
            )
            session.flush()
            raise RuntimeError("post-selection failure")

    with pytest.raises(RuntimeError, match="post-selection failure"):
        fail_after_selection()
    with factory.begin() as session:
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
        )
        assert invocation is not None
        assert invocation.bindings[RECOVERY_RECORD_KEY] == selection.expected.model_dump(mode="json")
        old_workspace = session.get(AgentWorkspace, selection.expected.predecessor.workspace_id)
        assert old_workspace is not None
        assert old_workspace.active_guard == 1
        old_binding = session.get(AgentWorkspaceBinding, selection.expected.predecessor.binding_id)
        assert old_binding is not None
        assert old_binding.status == AgentWorkingResourceStatus.ACTIVE
        assert session.get(AgentWorkspaceBinding, selection.expected.reserved_binding_id) is None
        execution = session.get(WorkflowNodeExecutionModel, scope.node_execution_id)
        assert execution is not None
        assert execution.agent_workspace_binding_id == selection.expected.predecessor.binding_id
    with factory.begin() as session:
        ready = agent_recovery.finalize_recovery_selection(
            session=session, tenant_id=scope.tenant_id, ref=ref, selection=selection, session_scope=scope
        )
        session.flush()
        assert ready.allocation_receipt_ref == selection.expected.allocation_receipt_ref
        old_workspace = session.get(AgentWorkspace, selection.expected.predecessor.workspace_id)
        assert old_workspace is not None
        assert old_workspace.active_guard is None
        active = list(session.scalars(select(AgentWorkspace).where(AgentWorkspace.active_guard == 1)))
        assert [row.id for row in active] == [selection.expected.reserved_workspace_id]
    with factory.begin() as session:
        assert (
            agent_recovery.finalize_recovery_selection(
                session=session, tenant_id=scope.tenant_id, ref=ref, selection=selection, session_scope=scope
            )
            == ready
        )
        stale = agent_recovery.ConfirmedSnapshotIdentity(
            AgentParentNodeRef.model_validate(selection.relation.parent_node.model_dump(mode="json")),
            1,
            "child",
            2,
            selection.expected.predecessor,
        )
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_unready"):
            agent_recovery.write_confirmed_snapshot(
                session=session,
                tenant_id=scope.tenant_id,
                bindings={},
                identity=stale,
                current=stale,
                serialized_snapshot="stale SQL-ready",
            )
        invocation = session.scalar(
            select(NativeTestInvocation).where(NativeTestInvocation.request_id == ref.request_id)
        )
        assert invocation is not None
        acknowledged = AgentRecoveryRecord.model_validate(
            {**ready.model_dump(), "sdk_receipt_ref": "sdk-ack", "successor_wait_ref": "fresh-wait"}
        )
        invocation.bindings = {**invocation.bindings, RECOVERY_RECORD_KEY: acknowledged.model_dump(mode="json")}
        session.flush()
        with pytest.raises(BuilderExecutionPolicyError, match="native_agent_recovery_identity_mismatch"):
            agent_recovery.write_confirmed_snapshot(
                session=session,
                tenant_id=scope.tenant_id,
                bindings={},
                identity=stale,
                current=stale,
                serialized_snapshot="stale after completed handshake pointers",
            )
        assert (
            agent_recovery.finalize_recovery_selection(
                session=session, tenant_id=scope.tenant_id, ref=ref, selection=selection, session_scope=scope
            )
            == acknowledged
        )
