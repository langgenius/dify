"""
Day-based rate limiter for workflow executions.

Implements UTC-based daily quotas that reset at midnight UTC for consistent rate limiting.
"""

from datetime import UTC, datetime, time, timedelta
from typing import Union

import pytz
from redis import Redis
from sqlalchemy import select

from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from models.account import Account, TenantAccountJoin, TenantAccountRole


class TenantDailyRateLimiter:
    """
    Day-based rate limiter that resets at midnight UTC

    This class provides Redis-based rate limiting with the following features:
    - Daily quotas that reset at midnight UTC for consistency
    - Atomic check-and-consume operations
    - Automatic cleanup of stale counters
    - Timezone-aware error messages for better UX
    """

    def __init__(self, redis_client: Union[Redis, RedisClientWrapper]):
        self.redis = redis_client

    def get_tenant_owner_timezone(self, tenant_id: str) -> str:
        """
        Get timezone of tenant owner

        Args:
            tenant_id: The tenant identifier

        Returns:
            Timezone string (e.g., 'America/New_York', 'UTC')
        """
        # Query to get tenant owner's timezone using scalar and select
        owner = db.session.scalar(
            select(Account)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == TenantAccountRole.OWNER)
        )

        if not owner:
            return "UTC"

        return owner.timezone or "UTC"

    def _get_day_key(self, tenant_id: str) -> str:
        """
        Get Redis key for current UTC day

        Args:
            tenant_id: The tenant identifier

        Returns:
            Redis key for the current UTC day
        """
        utc_now = datetime.now(UTC)
        date_str = utc_now.strftime("%Y-%m-%d")
        return f"workflow:daily_limit:{tenant_id}:{date_str}"

    def _get_ttl_seconds(self) -> int:
        """
        Calculate seconds until UTC midnight

        Returns:
            Number of seconds until UTC midnight
        """
        utc_now = datetime.now(UTC)

        # Get next midnight in UTC
        next_midnight = datetime.combine(utc_now.date() + timedelta(days=1), time.min)
        next_midnight = next_midnight.replace(tzinfo=UTC)

        return int((next_midnight - utc_now).total_seconds())

    def check_and_consume(self, tenant_id: str, max_daily_limit: int) -> bool:
        """
        Check if quota available and consume one execution

        Args:
            tenant_id: The tenant identifier
            max_daily_limit: Maximum daily limit

        Returns:
            True if quota consumed successfully, False if limit reached
        """
        key = self._get_day_key(tenant_id)
        ttl = self._get_ttl_seconds()

        # Check current usage
        current = self.redis.get(key)

        if current is None:
            # First execution of the day - set to 1
            self.redis.setex(key, ttl, 1)
            return True

        current_count = int(current)
        if current_count < max_daily_limit:
            # Within limit, increment
            new_count = self.redis.incr(key)
            # Update TTL
            self.redis.expire(key, ttl)

            # Double-check in case of race condition
            if new_count <= max_daily_limit:
                return True
            else:
                # Race condition occurred, decrement back
                self.redis.decr(key)
                return False
        else:
            # Limit exceeded
            return False

    def get_remaining_quota(self, tenant_id: str, max_daily_limit: int) -> int:
        """
        Get remaining quota for the day

        Args:
            tenant_id: The tenant identifier
            max_daily_limit: Maximum daily limit

        Returns:
            Number of remaining executions for the day
        """
        key = self._get_day_key(tenant_id)
        used = int(self.redis.get(key) or 0)
        return max(0, max_daily_limit - used)

    def get_current_usage(self, tenant_id: str) -> int:
        """
        Get current usage for the day

        Args:
            tenant_id: The tenant identifier

        Returns:
            Number of executions used today
        """
        key = self._get_day_key(tenant_id)
        return int(self.redis.get(key) or 0)

    def reset_quota(self, tenant_id: str) -> bool:
        """
        Reset quota for testing purposes

        Args:
            tenant_id: The tenant identifier

        Returns:
            True if key was deleted, False if key didn't exist
        """
        key = self._get_day_key(tenant_id)
        return bool(self.redis.delete(key))

    def get_quota_reset_time(self, tenant_id: str, timezone_str: str) -> datetime:
        """
        Get the time when quota will reset (next UTC midnight in tenant's timezone)

        Args:
            tenant_id: The tenant identifier
            timezone_str: Tenant's timezone for display purposes

        Returns:
            Datetime when quota resets (next UTC midnight in tenant's timezone)
        """
        tz = pytz.timezone(timezone_str)
        utc_now = datetime.now(UTC)

        # Get next midnight in UTC, then convert to tenant's timezone
        next_utc_midnight = datetime.combine(utc_now.date() + timedelta(days=1), time.min)
        next_utc_midnight = pytz.UTC.localize(next_utc_midnight)

        return next_utc_midnight.astimezone(tz)
