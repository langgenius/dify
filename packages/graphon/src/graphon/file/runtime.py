from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Final

from .protocols import WorkflowFileRuntimeProtocol


class WorkflowFileRuntimeNotConfiguredError(RuntimeError):
    """Raised when workflow file runtime dependencies were not configured."""


_FILE_RUNTIME: Final[ContextVar[WorkflowFileRuntimeProtocol | None]] = ContextVar(
    "workflow_file_runtime", default=None
)


@contextmanager
def use_workflow_file_runtime(
    runtime: WorkflowFileRuntimeProtocol | None,
) -> Iterator[None]:
    """Bind file helpers in this context; None explicitly disables resolution.

    Hosts can use this when constructing an engine or rendering its file values.
    The previous binding is restored on exit, including when an operation fails.
    """
    token = _FILE_RUNTIME.set(runtime)
    try:
        yield
    finally:
        _FILE_RUNTIME.reset(token)


def get_workflow_file_runtime() -> WorkflowFileRuntimeProtocol:
    runtime = peek_workflow_file_runtime()
    if runtime is None:
        msg = (
            "workflow file runtime is not configured; enter "
            "use_workflow_file_runtime(...) before resolving files"
        )
        raise WorkflowFileRuntimeNotConfiguredError(msg)
    return runtime


def peek_workflow_file_runtime() -> WorkflowFileRuntimeProtocol | None:
    return _FILE_RUNTIME.get()
