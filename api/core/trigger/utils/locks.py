def build_trigger_refresh_lock_key(tenant_id: str, subscription_id: str) -> str:
    """Build the Redis lock key for trigger subscription refresh in-flight protection."""
    return f"trigger_provider_refresh_lock:{tenant_id}_{subscription_id}"
