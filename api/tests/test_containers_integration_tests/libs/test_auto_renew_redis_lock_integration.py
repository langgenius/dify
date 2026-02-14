"""
Integration tests for AutoRenewRedisLock using real Redis via TestContainers.
"""

import time
import uuid

import pytest

from extensions.ext_redis import redis_client
from libs.auto_renew_redis_lock import AutoRenewRedisLock


@pytest.mark.usefixtures("flask_app_with_containers")
def test_auto_renew_redis_lock_renews_ttl_and_releases():
    lock_name = f"test:auto_renew_lock:{uuid.uuid4().hex}"

    # Keep base TTL very small, and renew frequently so the test is stable even on slower CI.
    lock = AutoRenewRedisLock(
        redis_client=redis_client,
        name=lock_name,
        ttl_seconds=1.0,
        renew_interval_seconds=0.2,
        log_context="test_auto_renew_redis_lock",
    )

    acquired = lock.acquire(blocking=True, blocking_timeout=5)
    assert acquired is True

    # Wait beyond the base TTL; key should still exist due to renewal.
    time.sleep(1.5)
    ttl = redis_client.ttl(lock_name)
    assert ttl > 0

    lock.release_safely(status="successful")

    # After release, the key should not exist.
    assert redis_client.exists(lock_name) == 0

