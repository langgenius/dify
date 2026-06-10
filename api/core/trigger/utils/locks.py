from collections.abc import Sequence
from itertools import starmap


def build_trigger_refresh_lock_key(tenant_id: str, subscription_id: str) -> str:
    """Build the Redis lock key for trigger subscription refresh in-flight protection."""
    return f"trigger_provider_refresh_lock:{tenant_id}_{subscription_id}"


def build_trigger_refresh_lock_keys(pairs: Sequence[tuple[str, str]]) -> list[str]:
    """Build Redis lock keys for a sequence of (tenant_id, subscription_id) pairs."""
    return list(starmap(build_trigger_refresh_lock_key, pairs))
