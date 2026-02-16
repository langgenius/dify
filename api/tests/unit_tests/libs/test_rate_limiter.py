from unittest.mock import MagicMock

from libs import helper as helper_module


class _FakeRedis:
    def __init__(self) -> None:
        self._zsets: dict[str, dict[str, float]] = {}
        self._expiry: dict[str, int] = {}

    def zadd(self, key: str, mapping: dict[str, float]) -> int:
        zset = self._zsets.setdefault(key, {})
        for member, score in mapping.items():
            zset[str(member)] = float(score)
        return len(mapping)

    def zremrangebyscore(self, key: str, min_score: str | float, max_score: str | float) -> int:
        zset = self._zsets.get(key, {})
        min_value = float("-inf") if min_score == "-inf" else float(min_score)
        max_value = float("inf") if max_score == "+inf" else float(max_score)
        to_delete = [member for member, score in zset.items() if min_value <= score <= max_value]
        for member in to_delete:
            del zset[member]
        return len(to_delete)

    def zcard(self, key: str) -> int:
        return len(self._zsets.get(key, {}))

    def expire(self, key: str, ttl: int) -> bool:
        self._expiry[key] = ttl
        return True


def test_rate_limiter_counts_attempts_within_same_second(monkeypatch):
    fake_redis = _FakeRedis()
    monkeypatch.setattr(helper_module.time, "time", lambda: 1000)

    limiter = helper_module.RateLimiter(
        prefix="test_rate_limit",
        max_attempts=2,
        time_window=60,
        redis_client=fake_redis,
    )

    limiter.increment_rate_limit("203.0.113.10")
    limiter.increment_rate_limit("203.0.113.10")

    assert limiter.is_rate_limited("203.0.113.10") is True


def test_rate_limiter_uses_injected_redis(monkeypatch):
    redis_client = MagicMock()
    redis_client.zcard.return_value = 1
    monkeypatch.setattr(helper_module.time, "time", lambda: 1000)

    limiter = helper_module.RateLimiter(
        prefix="test_rate_limit",
        max_attempts=1,
        time_window=60,
        redis_client=redis_client,
    )

    limiter.increment_rate_limit("203.0.113.10")
    limiter.is_rate_limited("203.0.113.10")

    assert redis_client.zadd.called is True
    assert redis_client.zremrangebyscore.called is True
    assert redis_client.zcard.called is True
