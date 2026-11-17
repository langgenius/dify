"""Reservation payload and scheduled-day contracts independent of Redis."""

from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from redis.exceptions import ConnectionError

from tasks.plugin_autoupgrade_coordination import (
    CheckReservation,
    RedisPluginAutoUpgradeCoordinator,
    _logical_day,
    _reservation_key,
)


def _timestamp(value: str) -> float:
    """Convert a UTC ISO timestamp into the producer's Unix-seconds input."""
    return datetime.fromisoformat(value).replace(tzinfo=UTC).timestamp()


@pytest.mark.parametrize(
    ("scheduled_at", "upgrade_time_of_day", "expected"),
    [
        ("2026-11-16T15:00:00", 15 * 3600 + 60, "2026-11-16"),
        ("2026-11-16T15:00:00", 15 * 3600 - 20, "2026-11-16"),
        ("2026-11-16T00:00:00", 24 * 3600 - 20, "2026-11-15"),
        ("2026-11-16T00:00:00", 60, "2026-11-16"),
        ("2026-11-16T23:59:50", 60, "2026-11-17"),
    ],
)
def test_scheduled_day_tracks_the_strategy_occurrence_across_midnight(
    scheduled_at: str, upgrade_time_of_day: int, expected: str
) -> None:
    """Given a strategy in a due window, assign its own UTC day rather than the worker's day."""
    assert _logical_day(upgrade_time_of_day, _timestamp(scheduled_at)) == expected


@pytest.mark.parametrize("upgrade_time_of_day", [-1, 24 * 3600])
def test_invalid_strategy_time_is_rejected(upgrade_time_of_day: int) -> None:
    """Reject an out-of-day strategy before any Redis operation could reserve it."""
    with pytest.raises(ValueError, match="within one UTC day"):
        _logical_day(upgrade_time_of_day, _timestamp("2026-11-16T00:00:00"))


@pytest.mark.parametrize("scheduled_at", [0.0, -1.0, float("nan"), float("inf")])
def test_invalid_producer_timestamp_is_rejected(scheduled_at: float) -> None:
    """Reject a nonfinite or nonpositive producer timestamp before deriving a day."""
    with pytest.raises(ValueError, match="positive finite"):
        _logical_day(0, scheduled_at)


def test_reservation_survives_json_transport_and_is_immutable() -> None:
    """A valid frozen reservation round-trips through the JSON form Celery transports."""
    reservation = CheckReservation(
        tenant_id="tenant-one",
        category="tool",
        logical_day="2026-11-16",
        token="producer-token",
        deadline=_timestamp("2026-11-17T15:00:00"),
    )

    assert CheckReservation.model_validate_json(reservation.model_dump_json()) == reservation
    assert CheckReservation.model_validate(reservation.model_dump(mode="json")) == reservation
    with pytest.raises(ValidationError, match="frozen"):
        # Deliberately violate the static contract to verify runtime payload immutability.
        reservation.token = "different-owner"  # type: ignore[read-only]


def test_deduplication_identity_separates_tenants_categories_and_days() -> None:
    """Only the same tenant/category/day shares an identity, independent of delivery token."""
    reservation = CheckReservation(
        tenant_id="tenant-one",
        category=None,
        logical_day="2026-11-16",
        token="producer-token",
        deadline=_timestamp("2026-11-17T15:00:00"),
    )

    identity = _reservation_key(reservation)
    assert _reservation_key(reservation.model_copy(update={"token": "other-delivery"})) == identity
    assert _reservation_key(reservation.model_copy(update={"tenant_id": "tenant-two"})) != identity
    assert _reservation_key(reservation.model_copy(update={"category": "None"})) != identity
    assert _reservation_key(reservation.model_copy(update={"logical_day": "2026-11-17"})) != identity


class _UnavailableRedis:
    """A concrete failed Redis boundary; no command can authorize background work."""

    def register_script(self, script: str) -> Callable[..., object]:
        """Provide a script invocation that reports a disconnected Redis dependency."""
        if not script:
            raise ValueError("A script must be provided")

        def unavailable(**_arguments: object) -> object:
            """Always propagate the dependency failure instead of inventing an admission result."""
            raise ConnectionError("Redis is unavailable")

        return unavailable


def test_redis_failure_cannot_create_an_uncoordinated_reservation() -> None:
    """A failed coordinator propagates its dependency error before publication can proceed."""
    coordinator = RedisPluginAutoUpgradeCoordinator(_UnavailableRedis())

    with pytest.raises(ConnectionError, match="Redis is unavailable"):
        coordinator.reserve("tenant", "tool", 0, _timestamp("2026-11-16T00:00:00"))


def test_redis_failure_cannot_admit_an_uncoordinated_execution() -> None:
    """A worker cannot interpret an unavailable limiter as permission to perform plugin I/O."""
    coordinator = RedisPluginAutoUpgradeCoordinator(_UnavailableRedis())
    reservation = CheckReservation(
        tenant_id="tenant",
        category="tool",
        logical_day="2026-11-16",
        token="producer",
        deadline=_timestamp("2026-11-17T00:00:00"),
    )

    with pytest.raises(ConnectionError, match="Redis is unavailable"):
        coordinator.acquire(reservation, "execution")
