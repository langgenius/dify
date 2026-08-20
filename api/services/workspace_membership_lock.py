"""Cross-worker serialization for account/workspace membership mutations."""

import logging
from collections.abc import Generator, Iterable
from contextlib import ExitStack, contextmanager
from uuid import UUID

from redis.exceptions import LockNotOwnedError, RedisError
from werkzeug.exceptions import Conflict

from configs import dify_config
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


@contextmanager
def _membership_mutation_lock(key: str) -> Generator[None]:
    # ponytail: fixed lease; add lock renewal if membership mutations can outlive it.
    timeout = 6 * dify_config.ENTERPRISE_RBAC_REQUEST_TIMEOUT + dify_config.ENTERPRISE_REQUEST_TIMEOUT + 60
    lock = redis_client.lock(key, timeout=timeout)
    if not lock.acquire(blocking=False):
        raise Conflict("Another membership change is in progress.")
    try:
        yield
    finally:
        try:
            lock.release()
        except (LockNotOwnedError, RedisError):
            logger.warning("Failed to release membership lock %s", key)


@contextmanager
def account_membership_mutation_lock(account_id: str) -> Generator[None]:
    account_id = str(UUID(str(account_id)))
    with _membership_mutation_lock(f"rbac:account-membership:{account_id}"):
        yield


@contextmanager
def workspace_membership_mutation_lock(tenant_id: str) -> Generator[None]:
    tenant_id = str(UUID(str(tenant_id)))
    with _membership_mutation_lock(f"rbac:tenant-membership:{tenant_id}"):
        yield


@contextmanager
def account_membership_mutation_locks(account_ids: Iterable[str]) -> Generator[None]:
    with ExitStack() as stack:
        for account_id in sorted({str(UUID(str(account_id))) for account_id in account_ids}):
            stack.enter_context(account_membership_mutation_lock(account_id))
        yield


@contextmanager
def workspace_membership_mutation_locks(tenant_ids: Iterable[str]) -> Generator[None]:
    with ExitStack() as stack:
        for tenant_id in sorted({str(UUID(str(tenant_id))) for tenant_id in tenant_ids}):
            stack.enter_context(workspace_membership_mutation_lock(tenant_id))
        yield


@contextmanager
def account_workspace_membership_mutation_locks(
    account_ids: Iterable[str], tenant_ids: Iterable[str]
) -> Generator[None]:
    """Lock accounts before workspaces, each in deterministic order."""
    with account_membership_mutation_locks(account_ids), workspace_membership_mutation_locks(tenant_ids):
        yield


@contextmanager
def account_workspace_membership_mutation_lock(account_id: str, *tenant_ids: str) -> Generator[None]:
    with account_workspace_membership_mutation_locks([account_id], tenant_ids):
        yield
