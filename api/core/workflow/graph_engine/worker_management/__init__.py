"""
Worker management subsystem for graph engine.

This package manages the worker pool, including creation,
scaling, and activity tracking.
"""

from .worker_pool import WorkerPool

__all__ = [
    "WorkerPool",
]
