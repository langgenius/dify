"""The scheduler closes its read session and bounds duplicate work and dispatch pacing."""

import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from types import TracebackType

import pytest
from celery.exceptions import Retry
from redis import RedisError

from models.account import (
    TenantPluginAutoUpgradeCategory,
    TenantPluginAutoUpgradeMode,
    TenantPluginAutoUpgradeStrategy,
    TenantPluginAutoUpgradeStrategySetting,
)
from schedule import check_upgradable_plugin_task as scheduler
from tasks.plugin_autoupgrade_coordination import CheckReservation

SCHEDULED_AT = datetime(2026, 11, 16, 7, 30, tzinfo=UTC).timestamp()


def test_scheduler_import_does_not_bootstrap_the_flask_application() -> None:
    """Importing task definitions must register them without changing process-wide application state."""
    api_directory = Path(__file__).resolve().parents[3]
    source = f"""
import sys
sys.path.insert(0, {str(api_directory)!r})
# Make an application bootstrap fail before it can install context/logging hooks.
sys.modules['app'] = None
from schedule.check_upgradable_plugin_task import check_upgradable_plugin_task
assert check_upgradable_plugin_task.name == 'schedule.check_upgradable_plugin_task.check_upgradable_plugin_task'
assert check_upgradable_plugin_task.queue == 'plugin'
assert check_upgradable_plugin_task.acks_late is True
assert check_upgradable_plugin_task.reject_on_worker_lost is True
"""
    result = subprocess.run([sys.executable, "-c", source], capture_output=True, text=True, timeout=15, check=False)

    assert result.returncode == 0, result.stdout + result.stderr


@dataclass
class Clock:
    """Given deterministic elapsed time, advance only for declared work or sleep."""

    elapsed: float = 0
    sleeps: list[float] = field(default_factory=list)

    def time(self) -> float:
        """Return the anchored Unix time without advancing the clock."""
        return SCHEDULED_AT + self.elapsed

    def perf_counter(self) -> float:
        """Return monotonic elapsed time without advancing it."""
        return self.elapsed

    def sleep(self, seconds: float) -> None:
        """Accept nonnegative sleeps and advance deterministic elapsed time."""
        assert seconds >= 0
        self.sleeps.append(seconds)
        self.elapsed += seconds


@dataclass
class ScalarResult:
    strategies: Sequence[TenantPluginAutoUpgradeStrategy]

    def all(self) -> Sequence[TenantPluginAutoUpgradeStrategy]:
        """Return the configured rows without accessing a database."""
        return self.strategies


@dataclass
class ReadSession:
    strategies: Sequence[TenantPluginAutoUpgradeStrategy]
    closed: bool = False

    def __enter__(self) -> "ReadSession":
        """Open the fake read scope and return its session."""
        self.closed = False
        return self

    def __exit__(
        self,
        _exc_type: type[BaseException] | None,
        _exc_value: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        """Close the read scope on success and failure."""
        self.closed = True

    def scalars(self, _statement: object) -> ScalarResult:
        """Return the configured strategy rows while the read scope is open."""
        assert not self.closed
        return ScalarResult(self.strategies)


@dataclass
class SessionFactory:
    strategies: Sequence[TenantPluginAutoUpgradeStrategy]
    sessions: list[ReadSession] = field(default_factory=list)

    def __call__(self, _engine: object, **_kwargs: object) -> ReadSession:
        """Create a recorded read session for each scheduler invocation."""
        session = ReadSession(self.strategies)
        self.sessions.append(session)
        return session

    def assert_closed(self) -> None:
        """Require that every materialized read has closed before external work."""
        assert self.sessions
        assert all(session.closed for session in self.sessions)


@dataclass
class Database:
    engine: object = field(default_factory=object)


@dataclass
class Coordinator:
    """Expose reserved identities so tests exercise scheduler behavior across batches."""

    pending: dict[tuple[str, str | None], CheckReservation] = field(default_factory=dict)
    owners: dict[tuple[str, str | None], str | None] = field(default_factory=dict)
    anchors: dict[str, float] = field(default_factory=dict)
    reserve_calls: list[tuple[str, str | None, int, float]] = field(default_factory=list)
    producer_ids: list[str | None] = field(default_factory=list)
    canceled: list[CheckReservation] = field(default_factory=list)
    queued: list[CheckReservation] = field(default_factory=list)
    failure: RedisError | None = None
    lose_reserve_reply: bool = False
    lose_queued_reply: bool = False

    def schedule_anchor(self, producer_id: str, fallback: float) -> float:
        """Keep one scan window per producer even when a redelivery loses retry headers."""
        return self.anchors.setdefault(producer_id, fallback)

    def reserve(
        self,
        tenant_id: str,
        category: str | None,
        upgrade_time_of_day: int,
        scheduled_at: float,
        producer_id: str | None = None,
    ) -> CheckReservation | None:
        """Return a fresh reservation unless that tenant/category is already pending."""
        self.reserve_calls.append((tenant_id, category, upgrade_time_of_day, scheduled_at))
        self.producer_ids.append(producer_id)
        if self.failure is not None:
            raise self.failure
        identity = tenant_id, category
        existing = self.pending.get(identity)
        reservation = None
        if existing is None:
            reservation = CheckReservation(
                tenant_id=tenant_id,
                category=category,
                logical_day="2026-11-16",
                token=f"{len(self.reserve_calls):032x}",
                deadline=scheduled_at + 86400,
            )
            self.pending[identity] = reservation
            self.owners[identity] = producer_id
            if self.lose_reserve_reply:
                self.lose_reserve_reply = False
                raise RedisError("reservation reply lost after write")
        elif self.owners[identity] == producer_id and existing not in self.queued:
            reservation = existing
        return reservation

    def mark_queued(self, reservation: CheckReservation) -> None:
        """Record broker-confirmed publication without releasing pending deduplication."""
        self.queued.append(reservation)
        if self.lose_queued_reply:
            self.lose_queued_reply = False
            raise RedisError("queued reply lost after write")

    def cancel(self, reservation: CheckReservation) -> None:
        """Record publish failure cleanup without removing another owner's work."""
        self.canceled.append(reservation)
        identity = reservation.tenant_id, reservation.category
        if self.pending.get(identity) == reservation:
            self.pending.pop(identity)
            self.owners.pop(identity)


@dataclass
class Dispatcher:
    clock: Clock
    sessions: SessionFactory
    duration: float
    calls: list[tuple[tuple[object, ...], dict[str, object], float]] = field(default_factory=list)
    expirations: list[datetime] = field(default_factory=list)
    failure: Exception | None = None

    def apply_async(
        self,
        *,
        args: tuple[object, ...],
        headers: dict[str, object],
        expires: datetime,
    ) -> None:
        """Record child publication after the read closes, then simulate broker latency."""
        self.sessions.assert_closed()
        self.calls.append((args, headers, self.clock.elapsed))
        self.expirations.append(expires)
        self.clock.elapsed += self.duration
        if self.failure is not None:
            raise self.failure


@dataclass
class ManifestFetcher:
    clock: Clock
    sessions: SessionFactory
    duration: float
    count: int = 1
    calls: int = 0
    failure: Exception | None = None

    def __call__(self, _prefix: str, _ttl: int) -> int:
        """Fetch after closing the read, returning the configured snapshot or failure."""
        self.sessions.assert_closed()
        self.calls += 1
        self.clock.elapsed += self.duration
        if self.failure is not None:
            raise self.failure
        return self.count


@dataclass
class Harness:
    clock: Clock
    coordinator: Coordinator
    dispatcher: Dispatcher
    manifests: ManifestFetcher
    sessions: SessionFactory


def strategy(
    tenant_id: str,
    category: TenantPluginAutoUpgradeCategory = TenantPluginAutoUpgradeCategory.TOOL,
) -> TenantPluginAutoUpgradeStrategy:
    """Given an owner/category, construct a real enabled persistence row without I/O."""
    return TenantPluginAutoUpgradeStrategy(
        tenant_id=tenant_id,
        category=category,
        strategy_setting=TenantPluginAutoUpgradeStrategySetting.LATEST,
        upgrade_mode=TenantPluginAutoUpgradeMode.ALL,
        upgrade_time_of_day=27000,
    )


def setup_scheduler(
    monkeypatch: pytest.MonkeyPatch,
    strategies: Sequence[TenantPluginAutoUpgradeStrategy],
    *,
    dispatch_seconds: float = 0,
    manifest_seconds: float = 0,
) -> Harness:
    """Replace external dependencies with stateful fakes; leave scheduler code real."""
    clock = Clock()
    sessions = SessionFactory(strategies)
    coordinator = Coordinator()
    dispatcher = Dispatcher(clock, sessions, dispatch_seconds)
    manifests = ManifestFetcher(clock, sessions, manifest_seconds)
    monkeypatch.setattr(scheduler, "time", clock)
    monkeypatch.setattr(scheduler, "Session", sessions)
    monkeypatch.setattr(scheduler, "db", Database())
    monkeypatch.setattr(scheduler, "get_upgrade_check_coordinator", lambda: coordinator)
    monkeypatch.setattr(scheduler, "fetch_global_plugin_manifest", manifests)
    monkeypatch.setattr(scheduler.check_task, "process_tenant_plugin_autoupgrade_check_task", dispatcher)
    return Harness(clock, coordinator, dispatcher, manifests, sessions)


def test_no_strategies_skips_manifest_and_child_work(monkeypatch: pytest.MonkeyPatch) -> None:
    """An empty scan closes its session and produces no external work."""
    harness = setup_scheduler(monkeypatch, [])

    scheduler._dispatch_upgrade_checks(SCHEDULED_AT)

    harness.sessions.assert_closed()
    assert harness.manifests.calls == 0
    assert harness.coordinator.reserve_calls == []
    assert harness.dispatcher.calls == []
    assert harness.clock.sleeps == []


def test_later_batch_deduplicates_pending_work_and_preserves_categories(monkeypatch: pytest.MonkeyPatch) -> None:
    """A later batch cannot republish pending work, but distinct categories both survive."""
    harness = setup_scheduler(
        monkeypatch,
        [strategy("tenant-1"), strategy("tenant-1", TenantPluginAutoUpgradeCategory.MODEL)],
    )

    scheduler._dispatch_upgrade_checks(SCHEDULED_AT)
    scheduler._dispatch_upgrade_checks(SCHEDULED_AT + 900)

    assert len(harness.dispatcher.calls) == 2
    assert len(harness.coordinator.reserve_calls) == 4
    assert len(harness.coordinator.queued) == 2
    payloads = [call[1][scheduler.check_task.COORDINATION_HEADER] for call in harness.dispatcher.calls]
    assert {CheckReservation.model_validate_json(str(payload)).category for payload in payloads} == {"model", "tool"}
    assert {reservation.tenant_id for reservation in harness.coordinator.pending.values()} == {"tenant-1"}


def test_broker_failure_cancels_only_the_unpublished_reservation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Failed publication releases pending ownership so a later scan may dispatch it."""
    harness = setup_scheduler(monkeypatch, [strategy("tenant-1")])
    harness.dispatcher.failure = RuntimeError("broker failed")

    with pytest.raises(RuntimeError, match="broker failed"):
        scheduler._dispatch_upgrade_checks(SCHEDULED_AT)

    assert len(harness.coordinator.canceled) == 1
    assert harness.coordinator.pending == {}
    assert harness.coordinator.queued == []
    harness.dispatcher.failure = None
    scheduler._dispatch_upgrade_checks(SCHEDULED_AT)
    assert len(harness.dispatcher.calls) == 2


def test_absolute_pacing_accounts_for_manifest_and_broker_latency(monkeypatch: pytest.MonkeyPatch) -> None:
    """The second group starts at its absolute target, without adding dispatch overhead."""
    harness = setup_scheduler(
        monkeypatch,
        [strategy(f"tenant-{index}") for index in range(40)],
        dispatch_seconds=2,
        manifest_seconds=30,
    )

    scheduler._dispatch_upgrade_checks(SCHEDULED_AT)

    assert len(harness.dispatcher.calls) == 40
    assert harness.dispatcher.calls[0][2] == 30
    assert harness.dispatcher.calls[20][2] == 450
    assert harness.clock.sleeps == [380]
    assert harness.clock.elapsed == 490


def test_slow_dispatch_does_not_add_another_full_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """Work that passes the next absolute target continues without extra pacing delay."""
    harness = setup_scheduler(
        monkeypatch,
        [strategy(f"tenant-{index}") for index in range(40)],
        dispatch_seconds=30,
    )

    scheduler._dispatch_upgrade_checks(SCHEDULED_AT)

    assert harness.dispatcher.calls[20][2] == 600
    assert harness.clock.sleeps == []


def test_manifest_failure_skips_dispatch_without_leaking_reservations(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unavailable marketplace does not reserve or dispatch a doomed child batch."""
    harness = setup_scheduler(monkeypatch, [strategy("tenant-1")])
    harness.manifests.failure = RuntimeError("marketplace unavailable")

    scheduler._dispatch_upgrade_checks(SCHEDULED_AT)

    assert harness.coordinator.pending == {}
    assert harness.dispatcher.calls == []


def test_empty_manifest_snapshot_still_dispatches_fallback_checks(monkeypatch: pytest.MonkeyPatch) -> None:
    """A reachable but empty snapshot preserves the existing per-plugin fallback."""
    harness = setup_scheduler(monkeypatch, [strategy("tenant-1")])
    harness.manifests.count = 0

    scheduler._dispatch_upgrade_checks(SCHEDULED_AT)

    assert len(harness.dispatcher.calls) == 1
    reservation = next(iter(harness.coordinator.pending.values()))
    assert len(harness.dispatcher.calls[0][0]) == 7
    assert harness.dispatcher.calls[0][1][scheduler.check_task.COORDINATION_HEADER] == reservation.model_dump_json()
    assert harness.dispatcher.expirations == [datetime.fromtimestamp(reservation.deadline, UTC)]
    assert harness.coordinator.queued == [reservation]


def test_scheduler_retry_keeps_original_anchor_and_existing_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Redis failure retries the original scan window without shifting it to execution time."""
    harness = setup_scheduler(monkeypatch, [strategy("tenant-1")])
    harness.coordinator.failure = RedisError("redis unavailable")
    captured: list[dict[str, object]] = []

    def retry(**kwargs: object) -> None:
        """Capture retry transport metadata and raise real Celery retry control flow."""
        captured.append(kwargs)
        raise Retry()

    task = scheduler.check_upgradable_plugin_task
    monkeypatch.setattr(task, "retry", retry)
    original_anchor = SCHEDULED_AT - 900
    task.push_request(
        id="producer-1",
        headers={scheduler.SCHEDULE_ANCHOR_HEADER: original_anchor, "traceparent": "parent-trace"},
    )
    try:
        with pytest.raises(Retry):
            task.run()
    finally:
        task.pop_request()

    assert captured[0]["headers"] == {
        scheduler.SCHEDULE_ANCHOR_HEADER: original_anchor,
        "traceparent": "parent-trace",
    }
    assert harness.coordinator.reserve_calls[0][3] == original_anchor
    assert harness.coordinator.producer_ids == ["producer-1"]
    assert harness.dispatcher.calls == []
    assert "args" not in captured[0]
    assert "kwargs" not in captured[0]


def test_new_beat_invocation_captures_wall_time_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """A headerless Beat delivery fixes the current wall timestamp for every reservation."""
    harness = setup_scheduler(monkeypatch, [strategy("tenant-1"), strategy("tenant-2")], dispatch_seconds=2)
    task = scheduler.check_upgradable_plugin_task
    task.push_request(headers=None)
    try:
        task.run()
    finally:
        task.pop_request()

    assert {call[3] for call in harness.coordinator.reserve_calls} == {SCHEDULED_AT}


def test_parent_redelivery_without_headers_keeps_its_persisted_scan_window(monkeypatch: pytest.MonkeyPatch) -> None:
    """A producer redelivered after worker loss cannot shift its query or deduplication window."""
    harness = setup_scheduler(monkeypatch, [strategy("tenant-1")])
    harness.coordinator.failure = RedisError("redis unavailable")
    retries: list[dict[str, object]] = []

    def retry(**kwargs: object) -> None:
        """Record the retry while allowing the test to simulate a headerless redelivery."""
        retries.append(kwargs)
        raise Retry()

    task = scheduler.check_upgradable_plugin_task
    monkeypatch.setattr(task, "retry", retry)
    task.push_request(id="producer-1", headers=None)
    try:
        with pytest.raises(Retry):
            task.run()
    finally:
        task.pop_request()

    harness.coordinator.failure = None
    harness.clock.elapsed = 900
    task.push_request(id="producer-1", headers=None)
    try:
        task.run()
    finally:
        task.pop_request()

    assert retries[0]["headers"] == {scheduler.SCHEDULE_ANCHOR_HEADER: SCHEDULED_AT}
    assert {call[3] for call in harness.coordinator.reserve_calls} == {SCHEDULED_AT}
    assert harness.coordinator.anchors == {"producer-1": SCHEDULED_AT}


@pytest.mark.parametrize("lost_reply", ["reserve", "queued"])
def test_parent_retry_recovers_ambiguous_redis_writes_without_losing_or_duplicating_publication(
    lost_reply: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The same producer resumes a pending claim or skips broker-confirmed work after reply loss."""
    harness = setup_scheduler(monkeypatch, [strategy("tenant-1")])
    harness.coordinator.lose_reserve_reply = lost_reply == "reserve"
    harness.coordinator.lose_queued_reply = lost_reply == "queued"
    task = scheduler.check_upgradable_plugin_task
    retries: list[dict[str, object]] = []

    def retry(**kwargs: object) -> None:
        """Record retry metadata while retaining the original producer identity."""
        retries.append(kwargs)
        raise Retry()

    monkeypatch.setattr(task, "retry", retry)
    headers = {scheduler.SCHEDULE_ANCHOR_HEADER: SCHEDULED_AT}
    task.push_request(id="producer-1", headers=headers)
    try:
        with pytest.raises(Retry):
            task.run()
    finally:
        task.pop_request()

    original_reservation = next(iter(harness.coordinator.pending.values()))
    assert retries[0]["headers"] == headers
    harness.clock.elapsed = 900
    task.push_request(id="producer-1", headers=headers)
    try:
        task.run()
    finally:
        task.pop_request()

    assert len(harness.dispatcher.calls) == 1
    assert harness.coordinator.queued == [original_reservation]
    assert harness.coordinator.producer_ids == ["producer-1", "producer-1"]
