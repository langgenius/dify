"""Redis key helpers for run records and per-run event streams."""


def run_record_key(prefix: str, run_id: str) -> str:
    """Return the Redis string key holding one serialized run record."""
    return f"{prefix}:runs:{run_id}:record"


def run_events_key(prefix: str, run_id: str) -> str:
    """Return the Redis stream key holding one run's event log."""
    return f"{prefix}:runs:{run_id}:events"


__all__ = ["run_events_key", "run_record_key"]
