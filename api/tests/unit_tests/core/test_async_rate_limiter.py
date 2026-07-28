import asyncio
import time
import pytest

from core.middleware.rate_limiter import AsyncRateLimiter


@pytest.mark.asyncio
async def test_concurrency_limit_serializes_tasks():
    limiter = AsyncRateLimiter(max_concurrency=1)

    order: list[str] = []

    async def work(name: str):
        order.append("start:" + name)
        await asyncio.sleep(0.1)
        order.append("end:" + name)

    await asyncio.gather(
        limiter.run(lambda: work("a")),
        limiter.run(lambda: work("b")),
    )

    assert order == ["start:a", "end:a", "start:b", "end:b"]


@pytest.mark.asyncio
async def test_rpm_rate_limits_calls():
    limiter = AsyncRateLimiter(rpm=2)

    async def noop():
        return 1

    await limiter.run(noop)
    await limiter.run(noop)

    t0 = time.monotonic()
    await limiter.run(noop)
    elapsed = time.monotonic() - t0

    assert elapsed >= 0.4
