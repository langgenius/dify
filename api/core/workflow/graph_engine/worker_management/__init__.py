"""
Worker management subsystem for graph engine.

This package manages the worker pool, including creation,
scaling, and activity tracking.
"""

from .simple_worker_pool import SimpleWorkerPool

__all__ = [
    "SimpleWorkerPool",
]
