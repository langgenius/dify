"""Subscription writers share the critical section across provider I/O and SQL commits."""

from collections.abc import Callable, Generator, Mapping
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Event, Lock
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import Subscription, UnsubscribeResult
from models.enums import PermissionEnum
from models.provider_ids import TriggerProviderID
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from services.trigger.subscription_codec import ProviderTriggerSubscriptionCodec
from services.trigger.subscription_query_service import TriggerSubscriptionSchemas
from services.trigger.subscription_service import (
    TriggerSubscriptionLeaseLostError,
    TriggerSubscriptionService,
    TriggerSubscriptionSnapshot,
)


class _Lease:
    def __init__(self) -> None:
        self.lost = Event()

    def ensure_owned(self) -> None:
        if self.lost.is_set():
            raise TriggerSubscriptionLeaseLostError("The lease was lost")


class _Locks:
    """A deterministic stand-in for the distributed lock boundary."""

    def __init__(self) -> None:
        self.lock = Lock()
        self.attempt_lock = Lock()
        self.attempts = 0
        self.second_attempted = Event()
        self.lease = _Lease()

    @contextmanager
    def for_subscription(self, *, tenant_id: str, subscription_id: str) -> Generator[_Lease]:
        assert tenant_id
        assert subscription_id
        with self.attempt_lock:
            self.attempts += 1
            if self.attempts == 2:
                self.second_attempted.set()
        with self.lock:
            yield self.lease

    @contextmanager
    def for_provider(self, *, tenant_id: str, provider_id: TriggerProviderID) -> Generator[None]:
        assert tenant_id
        assert provider_id
        with self.lock:
            yield


class _Provider:
    def __init__(self) -> None:
        self.first_unsubscribe_started = Event()
        self.release_first_unsubscribe = Event()
        self.calls: list[tuple[str, str]] = []
        self.after_unsubscribe: Callable[[], None] | None = None
        self.after_subscribe: Callable[[], None] | None = None

    def get_schemas(
        self, *, tenant_id: str, provider_id: TriggerProviderID, credential_type: CredentialType
    ) -> TriggerSubscriptionSchemas:
        assert tenant_id
        assert provider_id
        return TriggerSubscriptionSchemas(credentials={credential_type: []}, properties=[])

    def validate_credentials(
        self, *, tenant_id: str, provider_id: TriggerProviderID, user_id: str, credentials: Mapping[str, object]
    ) -> None:
        raise AssertionError(f"Unexpected verification for {tenant_id}, {provider_id}, {user_id}: {credentials}")

    def unsubscribe(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        user_id: str,
        subscription: Subscription,
        credentials: Mapping[str, object],
        credential_type: CredentialType,
    ) -> UnsubscribeResult:
        assert tenant_id
        assert provider_id
        assert user_id
        assert credentials
        assert credential_type
        self.calls.append(("unsubscribe", str(subscription.properties["remote"])))
        if len(self.calls) == 1:
            self.first_unsubscribe_started.set()
            if not self.release_first_unsubscribe.wait(timeout=10):
                raise TimeoutError("The test did not release the first provider request")
        if self.after_unsubscribe is not None:
            self.after_unsubscribe()
        return UnsubscribeResult(success=True)

    def subscribe(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        user_id: str,
        endpoint: str,
        parameters: Mapping[str, object],
        credentials: Mapping[str, object],
        credential_type: CredentialType,
    ) -> Subscription:
        assert tenant_id
        assert provider_id
        assert user_id
        assert credentials
        assert credential_type
        value = str(parameters["event"])
        self.calls.append(("subscribe", value))
        if self.after_subscribe is not None:
            self.after_subscribe()
        return Subscription(expires_at=-1, endpoint=endpoint, parameters=parameters, properties={"remote": value})


def _subscription() -> TriggerSubscriptionSnapshot:
    return TriggerSubscriptionSnapshot(
        id=str(uuid4()),
        name="subscription",
        tenant_id=str(uuid4()),
        user_id=str(uuid4()),
        provider_id="langgenius/github/github",
        endpoint_id=str(uuid4()),
        credential_type=CredentialType.API_KEY,
        parameters={"event": "old"},
        properties={"remote": "old"},
        credentials={"token": "secret"},
        credential_expires_at=-1,
        expires_at=-1,
        visibility=PermissionEnum.ALL_TEAM,
    )


@pytest.mark.parametrize("second_operation", ["update", "delete"])
def test_concurrent_mutations_wait_for_provider_and_reload_committed_snapshot(
    sqlite_session_factory: sessionmaker[Session], second_operation: str
) -> None:
    """A competing update or delete cannot modify the provider before the first SQL commit."""
    snapshot = _subscription()
    repository = TriggerSubscriptionRepository(session_factory=sqlite_session_factory)
    repository.create(subscription=snapshot, max_count=10)
    locks, provider = _Locks(), _Provider()
    service = TriggerSubscriptionService(
        subscriptions=repository,
        providers=provider,
        locks=locks,
        codec=ProviderTriggerSubscriptionCodec(),
        invalidate_cache=lambda **_: None,
    )

    def update(event: str) -> None:
        service.update(
            tenant_id=snapshot.tenant_id,
            subscription_id=snapshot.id,
            name=None,
            credentials=None,
            parameters={"event": event},
            properties=None,
        )

    def second() -> None:
        if second_operation == "update":
            update("second")
        else:
            service.delete(tenant_id=snapshot.tenant_id, subscription_id=snapshot.id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(update, "first")
        try:
            assert provider.first_unsubscribe_started.wait(timeout=5)
            other = pool.submit(second)
            assert locks.second_attempted.wait(timeout=5)
            assert provider.calls == [("unsubscribe", "old")]
        finally:
            provider.release_first_unsubscribe.set()
        first.result(timeout=10)
        other.result(timeout=10)

    assert provider.calls[:3] == [("unsubscribe", "old"), ("subscribe", "first"), ("unsubscribe", "first")]
    result = repository.get(tenant_id=snapshot.tenant_id, subscription_id=snapshot.id)
    if second_operation == "update":
        assert provider.calls[3:] == [("subscribe", "second")]
        assert result is not None
        assert result.parameters == {"event": "second"}
        assert result.properties == {"remote": "second"}
    else:
        assert len(provider.calls) == 3
        assert result is None


@pytest.mark.parametrize("operation", ["update-after-unsubscribe", "update-after-subscribe", "delete"])
def test_lost_lease_stops_further_effects_and_preserves_database(
    sqlite_session_factory: sessionmaker[Session], operation: str
) -> None:
    """An owner that loses its lease must not start another provider call or SQL write."""
    snapshot = _subscription()
    repository = TriggerSubscriptionRepository(session_factory=sqlite_session_factory)
    repository.create(subscription=snapshot, max_count=10)
    locks, provider = _Locks(), _Provider()
    provider.release_first_unsubscribe.set()
    if operation == "update-after-subscribe":
        provider.after_subscribe = locks.lease.lost.set
    else:
        provider.after_unsubscribe = locks.lease.lost.set
    service = TriggerSubscriptionService(
        subscriptions=repository,
        providers=provider,
        locks=locks,
        codec=ProviderTriggerSubscriptionCodec(),
        invalidate_cache=lambda **_: None,
    )

    def mutate() -> None:
        if operation == "delete":
            service.delete(tenant_id=snapshot.tenant_id, subscription_id=snapshot.id)
        else:
            service.update(
                tenant_id=snapshot.tenant_id,
                subscription_id=snapshot.id,
                name=None,
                credentials=None,
                parameters={"event": "new"},
                properties=None,
            )

    with pytest.raises(TriggerSubscriptionLeaseLostError):
        mutate()

    assert repository.get(tenant_id=snapshot.tenant_id, subscription_id=snapshot.id) == snapshot
    if operation == "update-after-subscribe":
        assert provider.calls == [("unsubscribe", "old"), ("subscribe", "new")]
    else:
        assert provider.calls == [("unsubscribe", "old")]
