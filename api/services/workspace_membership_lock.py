"""Cross-worker serialization for workspace membership mutations."""

import logging
from collections.abc import Generator
from contextlib import contextmanager
from uuid import UUID

from redis.exceptions import LockNotOwnedError, RedisError
from werkzeug.exceptions import Conflict

from configs import dify_config
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


@contextmanager
def workspace_membership_mutation_lock(tenant_id: str) -> Generator[None]:
    # ponytail: fixed lease; add lock renewal if membership mutations can outlive it.
    timeout = 6 * dify_config.ENTERPRISE_RBAC_REQUEST_TIMEOUT + dify_config.ENTERPRISE_REQUEST_TIMEOUT + 60
    tenant_id = str(UUID(str(tenant_id)))
    lock = redis_client.lock(f"rbac:tenant-membership:{tenant_id}", timeout=timeout)
    if not lock.acquire(blocking=False):
        raise Conflict("Another workspace membership change is in progress.")
    try:
        yield
    finally:
        try:
            lock.release()
        except (LockNotOwnedError, RedisError):
            logger.warning("Failed to release workspace membership lock for tenant %s", tenant_id)
