"""Execute subscription snapshot locking and name conflicts against real PostgreSQL in CI."""

from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier
from uuid import uuid4

from psycopg2.errors import UniqueViolation
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, UOWTransaction, sessionmaker

from core.plugin.entities.plugin_daemon import CredentialType
from models.enums import PermissionEnum
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from services.trigger.subscription_service import (
    TriggerSubscriptionChangedError,
    TriggerSubscriptionNameConflictError,
    TriggerSubscriptionSnapshot,
)


def test_concurrent_updates_preserve_one_complete_subscription_snapshot(db_session_with_containers: Session) -> None:
    repository = TriggerSubscriptionRepository(
        session_factory=sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    )
    original = TriggerSubscriptionSnapshot(
        id=str(uuid4()),
        name="Concurrent subscription",
        tenant_id=str(uuid4()),
        user_id=str(uuid4()),
        provider_id="langgenius/github/github",
        endpoint_id=str(uuid4()),
        credential_type=CredentialType.API_KEY,
        parameters={"events": ["push"]},
        properties={"remote_id": "original"},
        credentials={"token": "original-ciphertext"},
        credential_expires_at=-1,
        expires_at=-1,
        visibility=PermissionEnum.ALL_TEAM,
    )
    repository.create(subscription=original, max_count=10)
    barrier = Barrier(2)
    replacements = (
        replace(original, parameters={"events": ["issues"]}, credentials={"token": "first-ciphertext"}),
        replace(original, parameters={"events": ["release"]}, credentials={"token": "second-ciphertext"}),
    )

    def update(replacement: TriggerSubscriptionSnapshot) -> bool:
        barrier.wait(timeout=10)
        try:
            repository.update(expected=original, replacement=replacement)
        except TriggerSubscriptionChangedError:
            return False
        return True

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(update, replacements))

    assert sorted(results) == [False, True]
    assert (
        repository.get(tenant_id=original.tenant_id, subscription_id=original.id) == replacements[results.index(True)]
    )


def test_concurrent_renames_translate_postgres_unique_violation(db_session_with_containers: Session) -> None:
    session_factory = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    repository = TriggerSubscriptionRepository(session_factory=session_factory)
    first = TriggerSubscriptionSnapshot(
        id=str(uuid4()),
        name="First subscription",
        tenant_id=str(uuid4()),
        user_id=str(uuid4()),
        provider_id="langgenius/github/github",
        endpoint_id=str(uuid4()),
        credential_type=CredentialType.API_KEY,
        parameters={"events": ["push"]},
        properties={"remote_id": "original"},
        credentials={"token": "original-ciphertext"},
        credential_expires_at=-1,
        expires_at=-1,
        visibility=PermissionEnum.ALL_TEAM,
    )
    originals = (first, replace(first, id=str(uuid4()), name="Second subscription", endpoint_id=str(uuid4())))
    for original in originals:
        repository.create(subscription=original, max_count=10)
    replacements = tuple(
        replace(original, name="Shared name", credentials={"token": f"replacement-{index}"})
        for index, original in enumerate(originals)
    )
    barrier = Barrier(2)

    def wait_before_flush(
        _session: Session, _flush_context: UOWTransaction, _instances: Sequence[object] | None
    ) -> None:
        # Both real name prechecks must finish before either UPDATE reaches PostgreSQL.
        barrier.wait(timeout=10)

    def rename(index: int) -> TriggerSubscriptionNameConflictError | None:
        try:
            repository.update(expected=originals[index], replacement=replacements[index])
        except TriggerSubscriptionNameConflictError as error:
            return error
        return None

    event.listen(session_factory, "before_flush", wait_before_flush)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(rename, range(2)))
    finally:
        event.remove(session_factory, "before_flush", wait_before_flush)

    assert sum(error is None for error in results) == 1
    for index, error in enumerate(results):
        current = repository.get(tenant_id=originals[index].tenant_id, subscription_id=originals[index].id)
        if error is None:
            assert current == replacements[index]
        else:
            assert current == originals[index]
            assert "Shared name" in str(error)
            # Prove this exercised the database constraint, not the prequery rejection.
            assert isinstance(error.__cause__, IntegrityError)
            assert isinstance(error.__cause__.orig, UniqueViolation)
            assert error.__cause__.orig.diag.constraint_name == "unique_trigger_provider"
