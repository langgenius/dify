"""Cross-worker serialization for knowledge-graph merges."""

import logging
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from configs import dify_config
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


class GraphIndexLockError(RuntimeError):
    """Raised when the per-dataset merge lease cannot be taken or held."""


@contextmanager
def graph_index_lock(dataset_id: str) -> Iterator[Callable[[], None]]:
    """Hold the merge lease for one dataset, yielding a callable that renews it.

    Documents of the same dataset are indexed by several workers in parallel, so
    the read-modify-write merge has to be serialized: without it two workers
    insert the same entity and trip the unique constraint, or interleave and
    leave a half-written subgraph.

    The lease is deliberately finite so a crashed worker cannot block indexing
    forever, which means a long merge has to renew it. Callers renew between
    phases; if the lease has already expired and been taken by someone else the
    renewal raises rather than letting two writers proceed at once.
    """
    timeout = dify_config.KNOWLEDGE_GRAPH_INDEX_LOCK_TIMEOUT
    lock = redis_client.lock(
        name=f"graph_indexing_lock_{dataset_id}",
        timeout=timeout,
        blocking_timeout=dify_config.KNOWLEDGE_GRAPH_INDEX_LOCK_WAIT,
    )
    if not lock.acquire():
        raise GraphIndexLockError(
            f"Timed out after {dify_config.KNOWLEDGE_GRAPH_INDEX_LOCK_WAIT}s waiting for the knowledge-graph "
            f"merge lease of dataset {dataset_id}; another worker is still indexing it."
        )

    def renew() -> None:
        try:
            lock.extend(timeout, replace_ttl=True)
        except Exception as e:
            raise GraphIndexLockError(
                f"Lost the knowledge-graph merge lease of dataset {dataset_id} mid-write after {timeout}s; "
                "raise KNOWLEDGE_GRAPH_INDEX_LOCK_TIMEOUT or index in smaller batches."
            ) from e

    try:
        yield renew
    finally:
        try:
            lock.release()
        except Exception:
            # An expired lease is already gone; releasing it is best-effort.
            logger.warning("Failed to release the knowledge-graph merge lease of dataset %s", dataset_id)
