"""One bounded budget for a full-text search, including connection setup and cleanup."""

import time
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass

from gevent import Timeout


class TextSearchTimeoutError(RuntimeError):
    """The search must stop without returning a successful empty result."""


@dataclass(frozen=True)
class TextSearchDeadline:
    expires_at: float

    @classmethod
    def from_epoch_ms(cls, deadline_ms: int | None) -> "TextSearchDeadline":
        # Old KFS callers have no header. They still must finish before the 60s bridge/client.
        seconds = 50.0 if deadline_ms is None else min(50.0, deadline_ms / 1000 - time.time())
        deadline = cls(time.monotonic() + seconds)
        deadline.remaining()
        return deadline

    def remaining(self) -> float:
        seconds = self.expires_at - time.monotonic()
        if seconds <= 0:
            raise TextSearchTimeoutError("KnowledgeFS full-text search deadline exceeded")
        return seconds

    @contextmanager
    def enforce(self) -> Generator[None]:
        # Dify's gevent workers can interrupt cooperative I/O, including endpoint discovery.
        # Socket timeouts and SQL execution hints additionally bound TiDB-side work.
        with Timeout(self.remaining(), TextSearchTimeoutError("KnowledgeFS full-text search deadline exceeded")):
            yield
            self.remaining()
