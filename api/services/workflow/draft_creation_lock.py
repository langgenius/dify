"""Bounded Redis serialization of first-draft creation for one Workflow App."""

import logging
from collections.abc import Generator
from contextlib import contextmanager

from redis.exceptions import RedisError
from redis.lock import Lock
from sqlalchemy.orm import Session

from extensions.ext_redis import redis_client
from services.errors.workflow_service import WorkflowDraftInitializationBusyError

logger = logging.getLogger(__name__)

_DRAFT_CREATION_LEASE_SECONDS = 60
_DRAFT_CREATION_WAIT_SECONDS = 60


@contextmanager
def lock_draft_creation(*, tenant_id: str, app_id: str, session: Session, acquire: bool = True) -> Generator[None]:
    """Serialize a missing draft using a short Redis lease for its admitted App.

    The outer caller owns commit or rollback within this scope. A nested save
    using the same session reuses that lease. With acquire=False the caller
    must already hold the lease. Contention or Redis failure aborts the save.
    """
    key = f"workflow:draft-create:{tenant_id}:{app_id}"
    if key in session.info:
        yield
        return
    if not acquire:
        raise RuntimeError("Draft initialization requires a lease through the caller's commit.")

    try:
        lock: Lock = redis_client.lock(
            key,
            timeout=_DRAFT_CREATION_LEASE_SECONDS,
            blocking_timeout=_DRAFT_CREATION_WAIT_SECONDS,
        )
        if not lock.acquire():
            raise WorkflowDraftInitializationBusyError()
    except RedisError as exc:
        raise WorkflowDraftInitializationBusyError() from exc

    session.info[key] = True
    try:
        yield
    except BaseException:
        session.rollback()
        raise
    finally:
        del session.info[key]
        try:
            lock.release()
        except RedisError:
            logger.warning("Failed to release workflow draft creation lease: %s", key, exc_info=True)
