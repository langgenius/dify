"""Unit tests for the knowledge request rate limiter's sorted-set bookkeeping.

The limiter counts requests in a per-tenant sorted set whose members used to be
raw millisecond timestamps. Two requests sharing one millisecond collided on
the same member, so ZCARD undercounted bursts and let them exceed the limit.
Members must therefore be unique per request while the score stays the
millisecond timestamp that drives the 60s window cleanup.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace

import pytest

import services.knowledge_rate_limit_service as svc


@dataclass
class _KnowledgeRateLimit:
    """Minimal stand-in for FeatureService.get_knowledge_rate_limit result."""

    enabled: bool
    limit: int
    subscription_plan: str


class _InMemoryZSetRedis:
    """Sorted set with Redis member semantics: unique members, score overwrite."""

    def __init__(self) -> None:
        self.entries: dict[str, dict[str, float]] = {}

    def zadd(self, key: str, mapping: dict[str, float]) -> int:
        zset = self.entries.setdefault(key, {})
        for member, score in mapping.items():
            zset[member] = score
        return len(mapping)

    def zremrangebyscore(self, key: str, lo: float, hi: float) -> int:
        zset = self.entries.get(key, {})
        expired = [member for member, score in zset.items() if lo <= score <= hi]
        for member in expired:
            del zset[member]
        return len(expired)

    def zcard(self, key: str) -> int:
        return len(self.entries.get(key, {}))


class _FakeClock:
    """Stands in for the stdlib time module the service imports."""

    def __init__(self) -> None:
        self.current_ms = 1_750_000_000_000

    def time(self) -> float:
        return self.current_ms / 1000.0


class _RecordingSession:
    """Context manager collecting RateLimitLog rows the limiter persists."""

    def __init__(self, recorded: list[svc.RateLimitLog]) -> None:
        self._recorded = recorded

    def add(self, obj: svc.RateLimitLog) -> None:
        self._recorded.append(obj)

    def __enter__(self) -> _RecordingSession:
        return self

    def __exit__(self, *args: object) -> bool:
        return False


class _SessionFactory:
    def __init__(self, recorded: list[svc.RateLimitLog]) -> None:
        self._recorded = recorded

    def begin(self) -> _RecordingSession:
        return _RecordingSession(self._recorded)


LimiterEnv = tuple[_InMemoryZSetRedis, _FakeClock, list[svc.RateLimitLog]]


@pytest.fixture
def limiter_env(monkeypatch: pytest.MonkeyPatch) -> LimiterEnv:
    """Swap the service's collaborators for in-memory fakes and return them."""
    redis_stub = _InMemoryZSetRedis()
    clock = _FakeClock()
    recorded_logs: list[svc.RateLimitLog] = []
    monkeypatch.setattr(svc, "redis_client", redis_stub)
    monkeypatch.setattr(svc, "time", clock)
    monkeypatch.setattr(svc, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(svc, "sessionmaker", lambda **_kwargs: _SessionFactory(recorded_logs))
    monkeypatch.setattr(
        svc,
        "FeatureService",
        type(
            "_FeatureServiceStub",
            (),
            {
                "get_knowledge_rate_limit": staticmethod(
                    lambda _tenant_id: _KnowledgeRateLimit(enabled=True, limit=1, subscription_plan="sandbox")
                )
            },
        ),
    )
    return redis_stub, clock, recorded_logs


def test_same_millisecond_requests_are_counted_separately(limiter_env: LimiterEnv) -> None:
    """Two calls pinned to one millisecond must both land in the zset."""
    redis_stub, clock, _ = limiter_env
    svc.enforce_knowledge_rate_limit("tenant-1")
    with pytest.raises(svc.KnowledgeRateLimitExceededError):
        svc.enforce_knowledge_rate_limit("tenant-1")
    assert redis_stub.zcard("rate_limit_tenant-1") == 2


def test_members_keep_timestamp_score_for_window_cleanup(
    limiter_env: LimiterEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scores stay millisecond timestamps so the 60s purge logic is untouched."""
    redis_stub, clock, _ = limiter_env
    monkeypatch.setattr(
        svc,
        "FeatureService",
        type(
            "_FeatureServiceLimitTwo",
            (),
            {
                "get_knowledge_rate_limit": staticmethod(
                    lambda _tenant_id: _KnowledgeRateLimit(enabled=True, limit=2, subscription_plan="pro")
                )
            },
        ),
    )
    svc.enforce_knowledge_rate_limit("tenant-1")
    clock.current_ms += 5
    svc.enforce_knowledge_rate_limit("tenant-1")
    scores = sorted(score for score in redis_stub.entries["rate_limit_tenant-1"].values())
    assert scores == [clock.current_ms - 5, clock.current_ms]


def test_burst_over_limit_is_rejected_and_logged(limiter_env: LimiterEnv, monkeypatch: pytest.MonkeyPatch) -> None:
    """A third request beyond limit=2 in the same window raises and is audited."""
    redis_stub, clock, recorded_logs = limiter_env
    monkeypatch.setattr(
        svc,
        "FeatureService",
        type(
            "_FeatureServiceLimitTwo",
            (),
            {
                "get_knowledge_rate_limit": staticmethod(
                    lambda _tenant_id: _KnowledgeRateLimit(enabled=True, limit=2, subscription_plan="pro")
                )
            },
        ),
    )
    svc.enforce_knowledge_rate_limit("tenant-1")
    clock.current_ms += 1
    svc.enforce_knowledge_rate_limit("tenant-1")
    clock.current_ms += 1
    with pytest.raises(svc.KnowledgeRateLimitExceededError):
        svc.enforce_knowledge_rate_limit("tenant-1")
    assert redis_stub.zcard("rate_limit_tenant-1") == 3
    assert len(recorded_logs) == 1
    assert recorded_logs[0].tenant_id == "tenant-1"
    assert recorded_logs[0].operation == "knowledge"


def test_window_cleanup_removes_expired_entries(limiter_env: LimiterEnv) -> None:
    """Entries older than 60s are purged, so the next request is allowed again."""
    redis_stub, clock, _ = limiter_env
    svc.enforce_knowledge_rate_limit("tenant-1")
    clock.current_ms += 70_000
    svc.enforce_knowledge_rate_limit("tenant-1")
    assert redis_stub.zcard("rate_limit_tenant-1") == 1
