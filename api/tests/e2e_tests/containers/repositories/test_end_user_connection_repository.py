"""PostgreSQL conditional-write races; CI only."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Lock, get_ident

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from models.end_user_connection import EndUserConnectionRevisionAcceptance
from services.end_user_connections.errors import ConnectionConflictError
from services.end_user_connections.management import ConnectionChanges
from services.end_user_connections.policy import connection_mutation_guard
from services.end_user_connections.revision import ConnectionRevisionAcceptance
from tests.helpers.end_user_api_key import make_harness


@pytest.mark.parametrize("coordinated", [False, True])
def test_concurrent_credential_replacements_have_one_winner(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
    coordinated: bool,
) -> None:
    monkeypatch.setattr(dify_config, "WEBAPP_ACCOUNT_PASSPORT_ENABLED", coordinated)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    harness = make_harness(sessions)
    connection = harness.service.create_api_key(harness.context, harness.command())
    record = harness.repository.find(harness.context, connection.id)
    assert record is not None
    guard = connection_mutation_guard(harness.context, record.access)
    barrier = Barrier(2)

    def replace(ciphertext: str) -> bool:
        barrier.wait(timeout=10)
        try:
            harness.repository.update(
                harness.context,
                guard,
                ConnectionChanges(
                    name=None,
                    encrypted_credentials=ciphertext,
                    credential_status=None,
                    touch_activity=True,
                ),
            )
        except ConnectionConflictError:
            return False
        return True

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(replace, value) for value in ("cipher-a", "cipher-b")]
        outcomes = [future.result(timeout=20) for future in futures]
    assert sorted(outcomes) == [False, True]
    stored = harness.repository.find(harness.context, connection.id)
    assert stored is not None
    assert stored.access.revision == guard.revision + 1
    assert stored.encrypted_credentials in {"cipher-a", "cipher-b"}


@pytest.mark.timeout(30)
def test_parallel_revision_acceptance_keeps_one_original_receipt(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dify_config, "WEBAPP_ACCOUNT_PASSPORT_ENABLED", True)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    harness = make_harness(sessions)
    acceptance = ConnectionRevisionAcceptance(revision_id=harness.connection_revision, source_revision_id=None)
    barrier = Barrier(2)
    seen: set[int] = set()
    seen_lock = Lock()

    def synchronize(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if not statement.startswith("SELECT end_user_connection_revision_acceptances.id"):
            return
        identity = get_ident()
        with seen_lock:
            first_lookup = identity not in seen
            seen.add(identity)
        if first_lookup:
            barrier.wait(timeout=10)

    engine = db_session_with_containers.get_bind()
    event.listen(engine, "after_cursor_execute", synchronize)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(harness.repository.record_revision_acceptance, harness.context, acceptance)
                for _ in range(2)
            ]
            for future in futures:
                future.result(timeout=20)
    finally:
        event.remove(engine, "after_cursor_execute", synchronize)
    with sessions() as session:
        assert (
            session.scalar(
                select(func.count())
                .select_from(EndUserConnectionRevisionAcceptance)
                .where(
                    EndUserConnectionRevisionAcceptance.tenant_id == harness.context.tenant_id,
                    EndUserConnectionRevisionAcceptance.app_id == harness.context.app_id,
                    EndUserConnectionRevisionAcceptance.end_user_id == harness.context.end_user_id,
                    EndUserConnectionRevisionAcceptance.revision_id == acceptance.revision_id,
                )
            )
            == 1
        )


@pytest.mark.timeout(15)
def test_execution_preparation_fails_fast_without_holding_an_app_lock_during_migration(
    db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from context.connection_execution import ConnectionExecutionContext
    from models.model import App
    from repositories.end_user_execution_lock import lock_end_user

    monkeypatch.setattr(dify_config, "WEBAPP_ACCOUNT_PASSPORT_ENABLED", True)
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    harness = make_harness(sessions)
    execution = ConnectionExecutionContext(
        tenant_id=harness.context.tenant_id,
        app_id=harness.context.app_id,
        end_user_id=harness.context.end_user_id,
        account_id=harness.context.account_id,
        workflow_id=harness.workflow_id,
        connection_revision=harness.connection_revision,
        selections=(),
    )
    with sessions.begin() as migration:
        assert (
            lock_end_user(
                migration,
                tenant_id=harness.context.tenant_id,
                app_id=harness.context.app_id,
                end_user_id=harness.context.end_user_id,
                exclusive=True,
            )
            is not None
        )
        with pytest.raises(ConnectionConflictError):
            harness.repository.save_run_selections(
                execution, "00000000-0000-0000-0000-000000000001", None, update_conversation=False
            )
        with sessions.begin() as peer:
            assert (
                peer.scalar(select(App.id).where(App.id == harness.context.app_id).with_for_update(nowait=True))
                is not None
            )
