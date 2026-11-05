"""Exercise OAuth client conflicts and row locking against real PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.provider_ids import TriggerProviderID
from repositories.trigger.oauth_client_repository import TriggerOAuthClientRepository
from services.trigger.oauth_client_service import TriggerOAuthClientChangedError


@pytest.mark.parametrize("existing", [False, True])
def test_concurrent_saves_preserve_one_winner(db_session_with_containers: Session, existing: bool) -> None:
    repository = TriggerOAuthClientRepository(
        session_factory=sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    )
    tenant_id = str(uuid4())
    provider_id = TriggerProviderID("langgenius/github/github")
    if existing:
        repository.save(
            tenant_id=tenant_id,
            provider_id=provider_id,
            expected=None,
            encrypted_oauth_params='{"client_secret":"original-ciphertext"}',
            enabled=True,
        )
    expected = repository.get(tenant_id=tenant_id, provider_id=provider_id).custom
    barrier = Barrier(2)

    def save(ciphertext: str) -> bool:
        barrier.wait(timeout=10)
        try:
            repository.save(
                tenant_id=tenant_id,
                provider_id=provider_id,
                expected=expected,
                encrypted_oauth_params=ciphertext,
                enabled=False,
            )
        except TriggerOAuthClientChangedError:
            return False
        return True

    values = ('{"client_secret":"first-ciphertext"}', '{"client_secret":"second-ciphertext"}')
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(save, values))

    assert sorted(results) == [False, True]
    current = repository.get(tenant_id=tenant_id, provider_id=provider_id).custom
    assert current is not None
    assert current.encrypted_oauth_params == values[results.index(True)]
    assert current.enabled is False
