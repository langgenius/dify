"""PostgreSQL conditional-write races; CI only."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from models.account import Account, AccountStatus
from models.end_user_connection import EndUserConnection
from models.enums import EndUserType
from models.model import EndUser
from services.end_user_connections.errors import ConnectionConflictError
from services.end_user_connections.management import ConnectionChanges
from services.end_user_connections.policy import connection_mutation_guard
from tests.helpers.end_user_api_key import make_harness


def test_concurrent_credential_replacements_have_one_winner(db_session_with_containers: Session) -> None:
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


@pytest.mark.parametrize("same_account", [False, True])
def test_concurrent_guest_claims_transfer_connections_once(
    db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch, same_account: bool
) -> None:
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    harness = make_harness(sessions)
    target_id = harness.context.end_user_id
    with sessions.begin() as session:
        guest = EndUser(
            tenant_id=harness.context.tenant_id,
            app_id=harness.context.app_id,
            type=EndUserType.BROWSER,
            account_id=None,
            session_id=str(uuid4()),
        )
        session.add(guest)
        session.flush()
        guest_id = guest.id
        if same_account:
            other_target_id = target_id
        else:
            account = Account(name="Claimant", email=f"{uuid4()}@example.com", status=AccountStatus.ACTIVE)
            session.add(account)
            session.flush()
            other_target = EndUser(
                tenant_id=harness.context.tenant_id,
                app_id=harness.context.app_id,
                type=EndUserType.BROWSER,
                account_id=account.id,
                session_id=str(uuid4()),
            )
            session.add(other_target)
            session.flush()
            other_target_id = other_target.id
    guest_context = replace(harness.context, account_id=None, end_user_id=guest_id)
    monkeypatch.setattr(dify_config, "END_USER_AUTH_ALLOW_ANONYMOUS", True)
    selected = harness.service.create_api_key(guest_context, harness.command())
    barrier = Barrier(2)

    def claim(account_end_user_id: str) -> int:
        barrier.wait(timeout=10)
        return harness.repository.claim_connections(guest_context, account_end_user_id=account_end_user_id)

    with ThreadPoolExecutor(max_workers=2) as executor:
        targets = (target_id, other_target_id)
        futures = [executor.submit(claim, target) for target in targets]
        results = [future.result(timeout=20) for future in futures]
    assert sorted(results) == [0, 1]
    with sessions() as session:
        winner = session.get(EndUser, targets[results.index(1)])
        assert winner is not None
        connection = session.get(EndUserConnection, selected.id)
        assert connection is not None
        assert connection.account_id == winner.account_id
        assert connection.end_user_id is None
        assert connection.revision == 2
