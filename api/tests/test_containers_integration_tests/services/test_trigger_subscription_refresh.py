"""SQLite, real Redis and the actual memory-broker publisher exercise renewal scheduling."""

import json
from collections.abc import Iterator
from contextvars import Context
from dataclasses import replace
from uuid import UUID, uuid4

import pytest
from celery import Celery
from celery.signals import before_task_publish
from kombu.exceptions import EncodeError
from kombu.serialization import register, unregister
from kombu.simple import SimpleQueue
from sqlalchemy import Engine, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import QueuePool

from core.trigger.utils.locks import build_trigger_refresh_lock_key
from extensions.ext_application_services import application_services
from extensions.ext_redis import RedisClientWrapper
from models.base import TypeBase
from models.trigger import TriggerSubscription
from repositories.trigger.subscription_repository import RedisTriggerSubscriptionRefreshReservations
from schedule.trigger_provider_refresh_task import trigger_provider_refresh
from services.trigger.subscription_gateway import enqueue_subscription_refresh
from services.trigger.subscription_refresh_service import TriggerSubscriptionRefreshJob, TriggerSubscriptionRefreshRef
from tasks.trigger_subscription_refresh_tasks import trigger_subscription_refresh
from tests.test_containers_integration_tests.services import test_trigger_subscription_builder
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness
from tests.unit_tests.repositories.trigger.test_subscription_repository import _persist, _snapshot

application_redis = test_trigger_subscription_builder.application_redis
sqlite_engine = test_trigger_subscription_builder.sqlite_engine
sqlite_session_factory = test_trigger_subscription_builder.sqlite_session_factory
harness = test_trigger_oauth_client.harness


@pytest.fixture
def broker() -> Iterator[tuple[Celery, SimpleQueue]]:
    previous_app = trigger_subscription_refresh.app
    app = Celery("trigger-renewal-scan-test", broker="memory://", set_as_current=False)
    app.conf.update(task_always_eager=False, task_serializer="json")
    app.set_current()
    try:
        with app.connection_for_write() as connection:
            with SimpleQueue(connection.channel(), "trigger_refresh_executor") as queue:
                queue.clear()
                try:
                    yield app, queue
                finally:
                    queue.clear()
    finally:
        previous_app.set_current()
        app.close()


def _ref(*, tenant_id: str) -> TriggerSubscriptionRefreshRef:
    return TriggerSubscriptionRefreshRef(tenant_id=tenant_id, subscription_id=str(uuid4()))


def _key(ref: TriggerSubscriptionRefreshRef) -> str:
    return build_trigger_refresh_lock_key(ref.tenant_id, ref.subscription_id)


def _scan(harness: _Harness, *, batch_size: int = 2) -> int:
    with harness.app.app_context():
        return application_services().workspaces.trigger_subscription_refresh.enqueue_due(
            now=100, credential_threshold=10, subscription_threshold=20, batch_size=batch_size
        )


def test_scheduler_releases_sql_before_reservation_and_publish_and_scans_past_renewed_rows(
    harness: _Harness,
    application_redis: RedisClientWrapper,
    sqlite_engine: Engine,
    broker: tuple[Celery, SimpleQueue],
) -> None:
    snapshots = [
        replace(_snapshot(), id=str(UUID(int=index)), tenant_id=harness.tenant_id, name=f"due-{index}")
        for index in range(1, 6)
    ]
    _persist(harness.session_factory, *snapshots)
    reservations = RedisTriggerSubscriptionRefreshReservations(redis=application_redis)
    locked = reservations.reserve(
        subscriptions=[TriggerSubscriptionRefreshRef(tenant_id=harness.tenant_id, subscription_id=snapshots[2].id)],
        ttl=300,
    )
    assert len(locked) == 1
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    publications: list[str] = []

    def on_publish(
        sender: str, body: tuple[object, dict[str, str], object], headers: dict[str, object], **_kwargs: object
    ) -> None:
        assert sender == trigger_subscription_refresh.name
        assert pool.checkedout() == 0
        job = body[1]
        assert set(job) == {"tenant_id", "subscription_id"}
        reservation_token = headers["reservation_token"]
        assert isinstance(reservation_token, str)
        assert (
            application_redis.get(
                _key(TriggerSubscriptionRefreshRef(tenant_id=job["tenant_id"], subscription_id=job["subscription_id"]))
            )
            == reservation_token.encode()
        )
        publications.append(job["subscription_id"])
        # Simulate a fast worker removing already queued rows from the due set.
        with harness.session_factory.begin() as session:
            session.execute(
                update(TriggerSubscription)
                .where(TriggerSubscription.id == job["subscription_id"])
                .values(credential_expires_at=1000)
            )

    before_task_publish.connect(on_publish, weak=False, sender=trigger_subscription_refresh.name)
    try:
        assert _scan(harness) == 4
    finally:
        before_task_publish.disconnect(  # pyrefly: ignore[missing-attribute]
            on_publish, sender=trigger_subscription_refresh.name
        )
    assert publications == [snapshots[index].id for index in (0, 1, 3, 4)]
    assert broker[1].qsize() == 4
    assert _scan(harness) == 0
    for snapshot in snapshots:
        key = build_trigger_refresh_lock_key(snapshot.tenant_id, snapshot.id)
        assert 0 < application_redis.ttl(key) <= 300
        application_redis.delete(key)


def test_failed_serialization_keeps_published_reservation_and_releases_failed_and_unsent_jobs(
    harness: _Harness, application_redis: RedisClientWrapper, broker: tuple[Celery, SimpleQueue]
) -> None:
    snapshots = [
        replace(_snapshot(), id=str(UUID(int=index)), tenant_id=harness.tenant_id, name=f"job-{index}")
        for index in range(1, 4)
    ]
    _persist(harness.session_factory, *snapshots)
    attempts = 0
    reject = True

    def encode(payload: object) -> str:
        nonlocal attempts
        attempts += 1
        if reject and attempts > 1:
            raise ValueError("Serializer failed after publishing the first job")
        return json.dumps(payload)

    serializer = "trigger-refresh-test"
    register(
        serializer, encode, json.loads, content_type="application/x-trigger-refresh-test", content_encoding="utf-8"
    )
    broker[0].conf.task_serializer = serializer
    keys = [build_trigger_refresh_lock_key(snapshot.tenant_id, snapshot.id) for snapshot in snapshots]
    try:
        with pytest.raises(EncodeError, match="Serializer failed"):
            _scan(harness, batch_size=3)
        assert [application_redis.exists(key) for key in keys] == [1, 0, 0]
        assert broker[1].qsize() == 1

        reject = False
        assert _scan(harness, batch_size=3) == 2
        assert broker[1].qsize() == 3
        assert all(application_redis.exists(key) for key in keys)
    finally:
        unregister(serializer)
        for key in keys:
            application_redis.delete(key)


def test_reservation_scope_and_expired_owner_cannot_release_replacement(
    harness: _Harness, application_redis: RedisClientWrapper
) -> None:
    store = RedisTriggerSubscriptionRefreshReservations(redis=application_redis)
    ref = _ref(tenant_id=harness.tenant_id)
    other_tenant = replace(ref, tenant_id=str(uuid4()))
    first = store.reserve(subscriptions=[ref, other_tenant], ttl=300)
    assert len(first) == 2
    assert store.reserve(subscriptions=[ref, other_tenant], ttl=300) == ()
    application_redis.delete(_key(ref))
    (replacement,) = store.reserve(subscriptions=[ref], ttl=300)

    assert not store.owns(first[0])
    store.release(first[0])
    assert store.owns(replacement)
    assert store.owns(first[1])
    store.release(replacement)
    store.release(first[1])


@pytest.mark.parametrize("publisher", ["legacy", "new"])
def test_worker_accepts_legacy_and_new_reservations_and_releases_missing_subscription(
    harness: _Harness,
    application_redis: RedisClientWrapper,
    broker: tuple[Celery, SimpleQueue],
    publisher: str,
) -> None:
    ref = _ref(tenant_id=harness.tenant_id)
    token = "1" if publisher == "legacy" else "new-owner"
    application_redis.setex(_key(ref), 300, token)
    if publisher == "legacy":
        broker[0].send_task(
            trigger_subscription_refresh.name,
            kwargs={"tenant_id": ref.tenant_id, "subscription_id": ref.subscription_id},
            queue="trigger_refresh_executor",
        )
    else:
        enqueue_subscription_refresh(TriggerSubscriptionRefreshJob(subscription=ref, token=token))
    message = broker[1].get(block=False)

    def run() -> None:
        with harness.app.app_context():
            result = trigger_subscription_refresh.apply(
                args=tuple(message.payload[0]), kwargs=message.payload[1], headers=message.headers, throw=True
            )
            assert result.successful()

    Context().run(run)
    message.ack()
    assert application_redis.exists(_key(ref)) == 0


@pytest.mark.usefixtures("broker")
@pytest.mark.parametrize("token", [None, "old-owner"], ids=["legacy-publisher", "new-publisher"])
def test_stale_worker_does_not_use_or_delete_another_reservation(
    harness: _Harness, application_redis: RedisClientWrapper, token: str | None
) -> None:
    ref = _ref(tenant_id=harness.tenant_id)
    application_redis.setex(_key(ref), 300, "replacement-owner")
    with harness.app.app_context():
        result = trigger_subscription_refresh.apply(
            kwargs={"tenant_id": ref.tenant_id, "subscription_id": ref.subscription_id},
            headers=None if token is None else {"reservation_token": token},
            throw=True,
        )
        assert result.successful()
    assert application_redis.get(_key(ref)) == b"replacement-owner"
    application_redis.delete(_key(ref))


def test_worker_releases_owned_reservation_when_repository_read_fails(
    harness: _Harness, application_redis: RedisClientWrapper, sqlite_engine: Engine
) -> None:
    ref = _ref(tenant_id=harness.tenant_id)
    job = TriggerSubscriptionRefreshJob(subscription=ref, token="owned")
    application_redis.setex(_key(ref), 300, job.token)
    TypeBase.metadata.tables["trigger_subscriptions"].drop(sqlite_engine)
    with harness.app.app_context(), pytest.raises(OperationalError):
        application_services().workspaces.trigger_subscription_refresh.execute(job=job, now=100)
    assert application_redis.exists(_key(ref)) == 0


def test_scheduled_task_uses_injected_service_and_configured_thresholds(
    harness: _Harness, application_redis: RedisClientWrapper, broker: tuple[Celery, SimpleQueue]
) -> None:
    snapshot = replace(_snapshot(), tenant_id=harness.tenant_id)
    _persist(harness.session_factory, snapshot)
    with (
        harness.app.app_context(),
        config_overrides_context(
            TRIGGER_PROVIDER_REFRESH_BATCH_SIZE=1,
            TRIGGER_PROVIDER_CREDENTIAL_THRESHOLD_SECONDS=10,
            TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS=400,
        ),
    ):
        trigger_provider_refresh.run()
    assert broker[1].qsize() == 1
    key = build_trigger_refresh_lock_key(snapshot.tenant_id, snapshot.id)
    assert 300 < application_redis.ttl(key) <= 400
    application_redis.delete(key)
