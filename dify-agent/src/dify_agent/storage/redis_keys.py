"""Redis key helpers for the run server.

Keys are centralized so workers, projectors, and HTTP routes can share the same
stream/hash layout without duplicating string formats.
"""


def run_record_key(prefix: str, run_id: str) -> str:
    """Return the Redis string key holding one serialized run record."""
    return f"{prefix}:runs:{run_id}:record"


def run_events_key(prefix: str, run_id: str) -> str:
    """Return the Redis stream key holding one run's event log."""
    return f"{prefix}:runs:{run_id}:events"


def run_jobs_key(prefix: str) -> str:
    """Return the Redis stream key holding queued run jobs."""
    return f"{prefix}:runs:jobs"


__all__ = ["run_events_key", "run_jobs_key", "run_record_key"]
