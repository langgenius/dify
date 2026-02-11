from __future__ import annotations

from collections.abc import Generator
from typing import Protocol


class HttpResponseProtocol(Protocol):
    """Subset of response behavior needed by workflow file helpers."""

    @property
    def content(self) -> bytes: ...

    def raise_for_status(self) -> object: ...


class WorkflowFileRuntimeProtocol(Protocol):
    """Runtime dependencies required by ``core.workflow.file``.

    Implementations are expected to be provided by integration layers (for example,
    ``core.app.workflow.file_runtime``) so the workflow package avoids importing
    application infrastructure modules directly.
    """

    @property
    def files_url(self) -> str: ...

    @property
    def internal_files_url(self) -> str | None: ...

    @property
    def secret_key(self) -> str: ...

    @property
    def files_access_timeout(self) -> int: ...

    @property
    def multimodal_send_format(self) -> str: ...

    def http_get(self, url: str, *, follow_redirects: bool = True) -> HttpResponseProtocol: ...

    def storage_load(self, path: str, *, stream: bool = False) -> bytes | Generator: ...

    def sign_tool_file(self, *, tool_file_id: str, extension: str, for_external: bool = True) -> str: ...
