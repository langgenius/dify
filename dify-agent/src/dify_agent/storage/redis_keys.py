"""Redis key helpers for run records and per-run event streams."""


def run_record_key(prefix: str, run_id: str) -> str:
    """Return the Redis string key holding one serialized run record."""
    return f"{prefix}:runs:{run_id}:record"


def run_events_key(prefix: str, run_id: str) -> str:
    """Return the Redis stream key holding one run's event log."""
    return f"{prefix}:runs:{run_id}:events"


def run_idempotency_key(prefix: str, key_digest: str) -> str:
    """Return the Redis key claiming one create-run idempotency key digest."""
    return f"{prefix}:idempotency:{key_digest}"


def run_idempotency_index_key(prefix: str, run_id: str) -> str:
    """Return the per-run index used to refresh its idempotency claim TTL."""
    return f"{prefix}:runs:{run_id}:idempotency"


def run_cancel_intent_key(prefix: str, run_id: str) -> str:
    """Return the private Redis stream key holding one cancellation intent."""
    return f"{prefix}:runs:{run_id}:cancel-intent"


__all__ = [
    "run_cancel_intent_key",
    "run_events_key",
    "run_idempotency_index_key",
    "run_idempotency_key",
    "run_record_key",
]
