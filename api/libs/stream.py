"""Release optional stream resources without replacing an invocation error."""

import logging
from typing import Protocol, runtime_checkable

logger = logging.getLogger(__name__)


@runtime_checkable
class _Closable(Protocol):
    def close(self) -> None: ...


def close_stream(stream: object) -> None:
    """Close resource-owning streams; plain iterables need no cleanup."""
    if isinstance(stream, _Closable):
        try:
            stream.close()
        except Exception:
            logger.warning("Failed to close stream", exc_info=True)
