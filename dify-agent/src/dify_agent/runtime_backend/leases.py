"""Operation-scoped RuntimeLease acquisition and release."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
import logging
from uuid import uuid4

from dify_agent.runtime_backend.protocols import ExecutionBindingBackend, RuntimeLease
from dify_agent.runtime_backend.usage import runtime_usage_context

logger = logging.getLogger(__name__)


@asynccontextmanager
async def open_runtime_lease(
    backend: ExecutionBindingBackend,
    binding_ref: str,
    *,
    purpose: str | None = None,
) -> AsyncGenerator[RuntimeLease, None]:
    """Acquire one Binding and deterministically release its lease."""

    with runtime_usage_context(purpose=purpose, lease_id=str(uuid4())):
        lease = await backend.acquire(binding_ref)
        primary_error: BaseException | None = None
        try:
            yield lease
        except BaseException as exc:
            primary_error = exc
            raise
        finally:
            try:
                await backend.release(lease)
            except BaseException:
                if primary_error is None:
                    raise
                logger.warning("failed to release RuntimeLease after operation failed", exc_info=True)


__all__ = ["open_runtime_lease"]
