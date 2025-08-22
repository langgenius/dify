"""
Day-based rate limiter for workflow executions.

Implements timezone-aware daily quotas that reset at midnight in the tenant owner's timezone.
"""

from datetime import datetime, time, timedelta
from typing import Optional, Union

import pytz
from redis import Redis
from sqlalchemy import select

from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from models.account import Account, TenantAccountJoin, TenantAccountRole


class TenantDailyRateLimiter:
    """
    Day-based rate limiter that resets at midnight in tenant owner's timezone

    This class provides Redis-based rate limiting with the following features:
    - Daily quotas that reset at midnight in tenant owner's timezone
    - Atomic check-and-consume operations
    - Automatic cleanup of stale counters
    - Support for timezone changes without duplicate limits
    """

    def __init__(self, redis_client: Union[Redis, RedisClientWrapper]):
        self.redis = redis_client

    def _get_tenant_owner_timezone(self, tenant_id: str) -> str:
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

    def _get_day_key(self, tenant_id: str, timezone_str: str) -> str:
        """
        Get Redis key for current day in tenant's timezone

        Args:
            tenant_id: The tenant identifier
            timezone_str: Timezone string

        Returns:
            Redis key for the current day
        """
        tz = pytz.timezone(timezone_str)
        now = datetime.now(tz)
        date_str = now.strftime("%Y-%m-%d")
        return f"workflow:daily_limit:{tenant_id}:{date_str}:{timezone_str}"

    def _get_ttl_seconds(self, timezone_str: str) -> int:
        """
        Calculate seconds until midnight in given timezone

        Args:
            timezone_str: Timezone string

        Returns:
            Number of seconds until midnight
        """
        tz = pytz.timezone(timezone_str)
        now = datetime.now(tz)

        # Get next midnight in the timezone
        midnight = tz.localize(datetime.combine(now.date() + timedelta(days=1), time.min))

        return int((midnight - now).total_seconds())

    def check_and_consume(self, tenant_id: str, max_daily_limit: int, timezone_str: Optional[str] = None) -> bool:
        """
        Check if quota available and consume one execution

        Args:
            tenant_id: The tenant identifier
            max_daily_limit: Maximum daily limit
            timezone_str: Optional timezone string (will be fetched if not provided)

        Returns:
            True if quota consumed successfully, False if limit reached
        """
        if not timezone_str:
            timezone_str = self._get_tenant_owner_timezone(tenant_id)

        key = self._get_day_key(tenant_id, timezone_str)
        ttl = self._get_ttl_seconds(timezone_str)

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
            # Update TTL in case timezone changed
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

    def get_remaining_quota(self, tenant_id: str, max_daily_limit: int, timezone_str: Optional[str] = None) -> int:
        """
        Get remaining quota for the day

        Args:
            tenant_id: The tenant identifier
            max_daily_limit: Maximum daily limit
            timezone_str: Optional timezone string (will be fetched if not provided)

        Returns:
            Number of remaining executions for the day
        """
        if not timezone_str:
            timezone_str = self._get_tenant_owner_timezone(tenant_id)

        key = self._get_day_key(tenant_id, timezone_str)
        used = int(self.redis.get(key) or 0)
        return max(0, max_daily_limit - used)

    def get_current_usage(self, tenant_id: str, timezone_str: Optional[str] = None) -> int:
        """
        Get current usage for the day

        Args:
            tenant_id: The tenant identifier
            timezone_str: Optional timezone string (will be fetched if not provided)

        Returns:
            Number of executions used today
        """
        if not timezone_str:
            timezone_str = self._get_tenant_owner_timezone(tenant_id)

        key = self._get_day_key(tenant_id, timezone_str)
        return int(self.redis.get(key) or 0)

    def reset_quota(self, tenant_id: str, timezone_str: Optional[str] = None) -> bool:
        """
        Reset quota for testing purposes

        Args:
            tenant_id: The tenant identifier
            timezone_str: Optional timezone string (will be fetched if not provided)

        Returns:
            True if key was deleted, False if key didn't exist
        """
        if not timezone_str:
            timezone_str = self._get_tenant_owner_timezone(tenant_id)

        key = self._get_day_key(tenant_id, timezone_str)
        return bool(self.redis.delete(key))

    def get_quota_reset_time(self, tenant_id: str, timezone_str: Optional[str] = None) -> datetime:
        """
        Get the time when quota will reset (midnight in tenant's timezone)

        Args:
            tenant_id: The tenant identifier
            timezone_str: Optional timezone string (will be fetched if not provided)

        Returns:
            Datetime when quota resets
        """
        if not timezone_str:
            timezone_str = self._get_tenant_owner_timezone(tenant_id)

        tz = pytz.timezone(timezone_str)
        now = datetime.now(tz)

        # Get next midnight in the timezone
        midnight = tz.localize(datetime.combine(now.date() + timedelta(days=1), time.min))

        return midnight
