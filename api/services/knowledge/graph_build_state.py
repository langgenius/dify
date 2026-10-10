"""Tracks queued and running knowledge-graph rebuilds so the console can show progress."""

from extensions.ext_redis import redis_client

# Long enough for a slow batch, short enough that a crashed worker does not
# leave the graph page spinning; the task refreshes it on every batch.
_TTL_SECONDS = 15 * 60


def _key(dataset_id: str) -> str:
    return f"knowledge_graph_build:{dataset_id}"


def mark_graph_build_active(dataset_id: str) -> None:
    redis_client.setex(_key(dataset_id), _TTL_SECONDS, 1)


def clear_graph_build(dataset_id: str) -> None:
    redis_client.delete(_key(dataset_id))


def is_graph_build_active(dataset_id: str) -> bool:
    return bool(redis_client.exists(_key(dataset_id)))
