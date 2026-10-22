"""Execute subscription snapshot locking against real PostgreSQL in CI."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin_daemon import CredentialType
from models.enums import PermissionEnum
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from services.trigger.subscription_service import TriggerSubscriptionChangedError, TriggerSubscriptionSnapshot


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
