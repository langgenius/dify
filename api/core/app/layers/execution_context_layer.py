from collections.abc import Generator
from contextlib import AbstractContextManager, contextmanager
from typing import override

from context import capture_current_context
from graphon.engine.layer import Layer
from graphon.file.runtime import peek_workflow_file_runtime, use_workflow_file_runtime
from graphon.nodes.base.node import Node


class ExecutionContextLayer(Layer):
    """Restore the host's Flask and contextvars state for each worker activation."""

    def __init__(self) -> None:
        super().__init__()
        self._context = capture_current_context()

    @contextmanager
    def enter_context(self) -> Generator[None, None, None]:
        """Create a fresh manager for a node worker or child-frame construction."""
        file_runtime = peek_workflow_file_runtime()
        # Host context restoration can include an older file binding. Keep the
        # engine's adapter during the body and restore it after host teardown.
        with use_workflow_file_runtime(file_runtime), self._context:
            with use_workflow_file_runtime(file_runtime):
                yield

    @override
    def node_run_context(self, node: Node, *, parent_execution_id: str | None = None) -> AbstractContextManager[None]:
        return self.enter_context()
