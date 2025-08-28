"""
Factory for creating worker instances.
"""

import contextvars
import queue
from collections.abc import Callable
from typing import final

from flask import Flask

from core.workflow.graph import Graph

from ..worker import Worker


@final
class WorkerFactory:
    """
    Factory for creating worker instances with proper context.

    This encapsulates worker creation logic and ensures all workers
    are created with the necessary Flask and context variable setup.
    """

    def __init__(
        self,
        flask_app: Flask | None,
        context_vars: contextvars.Context,
    ) -> None:
        """
        Initialize the worker factory.

        Args:
            flask_app: Flask application context
            context_vars: Context variables to propagate
        """
        self.flask_app = flask_app
        self.context_vars = context_vars
        self._next_worker_id = 0

    def create_worker(
        self,
        ready_queue: queue.Queue[str],
        event_queue: queue.Queue,
        graph: Graph,
        on_idle_callback: Callable[[int], None] | None = None,
        on_active_callback: Callable[[int], None] | None = None,
    ) -> Worker:
        """
        Create a new worker instance.

        Args:
            ready_queue: Queue of nodes ready for execution
            event_queue: Queue for worker events
            graph: The workflow graph
            on_idle_callback: Callback when worker becomes idle
            on_active_callback: Callback when worker becomes active

        Returns:
            Configured worker instance
        """
        worker_id = self._next_worker_id
        self._next_worker_id += 1

        return Worker(
            ready_queue=ready_queue,
            event_queue=event_queue,
            graph=graph,
            worker_id=worker_id,
            flask_app=self.flask_app,
            context_vars=self.context_vars,
            on_idle_callback=on_idle_callback,
            on_active_callback=on_active_callback,
        )
