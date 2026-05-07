"""Lightweight run-event projector service.

The MVP writes status directly from the runner/store, so this projector currently
acts as an async-compatible extension point for future derived views. Keeping the
module explicit documents that Redis Streams, not Celery, are the service
boundary for background processing.
"""

import asyncio


class RunProjector:
    """No-op projector placeholder with a cancellable service loop."""

    async def run_forever(self) -> None:
        """Stay alive until cancelled; future projections can be added here."""
        while True:
            await asyncio.sleep(3600)


__all__ = ["RunProjector"]
