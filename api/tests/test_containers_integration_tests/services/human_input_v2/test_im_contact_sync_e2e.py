"""PostgreSQL and Redis end-to-end coverage independent of legacy Contacts."""

import pytest

from core.human_input_v2.shared import TenantId
from extensions.ext_redis import redis_client
from services.human_input_v2.im_contact_sync.locking import (
    OrganizationIMWriteLock,
    OrganizationIMWriteLockUnavailableError,
    OrganizationIMWriteScope,
)


def test_real_redis_lock_has_bounded_acquisition_and_explicit_ttl_extension(
    flask_app_with_containers: object,
) -> None:
    del flask_app_with_containers
    lock_scope = OrganizationIMWriteScope.for_workspace(TenantId("lock-contract-workspace"))
    write_lock = OrganizationIMWriteLock(
        redis_client,
        lock_scope,
        acquisition_timeout_seconds=1,
        lease_seconds=2,
    )

    with write_lock:
        redis_client.pexpire(lock_scope.redis_key, 200)
        assert 0 < redis_client.pttl(lock_scope.redis_key) <= 200
        write_lock.extend()
        assert redis_client.pttl(lock_scope.redis_key) > 1_500

        contending_lock = OrganizationIMWriteLock(
            redis_client,
            lock_scope,
            acquisition_timeout_seconds=0.05,
            lease_seconds=2,
        )
        with pytest.raises(OrganizationIMWriteLockUnavailableError):
            with contending_lock:
                raise AssertionError("contending lock unexpectedly acquired")

    assert redis_client.exists(lock_scope.redis_key) == 0
