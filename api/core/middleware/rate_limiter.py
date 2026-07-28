from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional


@dataclass
class TokenBucket:
    capacity: int
    refill_rate_per_sec: float  # tokens per second
    tokens: float = 0
    last_refill: float = 0

    def __post_init__(self) -> None:
        self.tokens = float(self.capacity)
        self.last_refill = time.monotonic()

    def try_consume(self, n: int = 1) -> bool:
        now = time.monotonic()
        elapsed = now - self.last_refill
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate_per_sec)
        self.last_refill = now
        if self.tokens >= n:
            self.tokens -= n
            return True
        return False


class AsyncRateLimiter:
    def __init__(
        self,
        rpm: Optional[int] = None,
        tpm: Optional[int] = None,
        max_concurrency: Optional[int] = None,
    ) -> None:
        # rpm/tpm map to token buckets with per-second refill
        self._rpm_bucket = (
            TokenBucket(capacity=rpm or 0, refill_rate_per_sec=(rpm or 0) / 60.0)
            if rpm
            else None
        )
        self._tpm_bucket = (
            TokenBucket(capacity=tpm or 0, refill_rate_per_sec=(tpm or 0) / 60.0)
            if tpm
            else None
        )
        self._sema = asyncio.Semaphore(max_concurrency) if max_concurrency else None

    async def _acquire(self, tokens: int = 1) -> None:
        # Concurrency first
        if self._sema:
            await self._sema.acquire()
        try:
            while True:
                ok_rpm = self._rpm_bucket.try_consume(1) if self._rpm_bucket else True
                ok_tpm = self._tpm_bucket.try_consume(tokens) if self._tpm_bucket else True
                if ok_rpm and ok_tpm:
                    return
                await asyncio.sleep(0.05)
        except Exception:
            # On any internal error, fallback to allow to avoid hard deadlocks
            return

    def _release(self) -> None:
        if self._sema:
            try:
                self._sema.release()
            except ValueError:
                pass

    async def run(self, fn: Callable[[], Awaitable], tokens: int = 1):
        await self._acquire(tokens=tokens)
        try:
            return await fn()
        finally:
            self._release()
