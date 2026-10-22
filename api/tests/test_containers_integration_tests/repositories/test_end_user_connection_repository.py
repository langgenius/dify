"""PostgreSQL conditional-write races; CI only."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from sqlalchemy.orm import Session, sessionmaker

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
