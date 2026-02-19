from __future__ import annotations

from collections.abc import Generator
from typing import NoReturn

from .protocols import HttpResponseProtocol, WorkflowFileRuntimeProtocol


class WorkflowFileRuntimeNotConfiguredError(RuntimeError):
    """Raised when workflow file runtime dependencies were not configured."""


class _UnconfiguredWorkflowFileRuntime(WorkflowFileRuntimeProtocol):
    def _raise(self) -> NoReturn:
        raise WorkflowFileRuntimeNotConfiguredError(
            "workflow file runtime is not configured, call set_workflow_file_runtime(...) first"
        )

    @property
    def files_url(self) -> str:
        self._raise()

    @property
    def internal_files_url(self) -> str | None:
        self._raise()

    @property
    def secret_key(self) -> str:
        self._raise()

    @property
    def files_access_timeout(self) -> int:
        self._raise()

    @property
    def multimodal_send_format(self) -> str:
        self._raise()

    def http_get(self, url: str, *, follow_redirects: bool = True) -> HttpResponseProtocol:
        self._raise()

    def storage_load(self, path: str, *, stream: bool = False) -> bytes | Generator:
        self._raise()

    def sign_tool_file(self, *, tool_file_id: str, extension: str, for_external: bool = True) -> str:
        self._raise()


_runtime: WorkflowFileRuntimeProtocol = _UnconfiguredWorkflowFileRuntime()


def set_workflow_file_runtime(runtime: WorkflowFileRuntimeProtocol) -> None:
    global _runtime
    _runtime = runtime


def get_workflow_file_runtime() -> WorkflowFileRuntimeProtocol:
    return _runtime
