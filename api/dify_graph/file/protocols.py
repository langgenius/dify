from __future__ import annotations

from collections.abc import Generator
from typing import TYPE_CHECKING, Literal, Protocol

if TYPE_CHECKING:
    from .models import File


class HttpResponseProtocol(Protocol):
    """Subset of response behavior needed by workflow file helpers."""

    @property
    def content(self) -> bytes: ...

    def raise_for_status(self) -> object: ...


class WorkflowFileRuntimeProtocol(Protocol):
    """Runtime dependencies required by ``dify_graph.file``.

    Implementations are expected to be provided by integration layers (for example,
    ``core.app.workflow.file_runtime``) so the workflow package avoids importing
    application infrastructure modules directly.
    """

    @property
    def multimodal_send_format(self) -> str: ...

    def http_get(self, url: str, *, follow_redirects: bool = True) -> HttpResponseProtocol: ...

    def storage_load(self, path: str, *, stream: bool = False) -> bytes | Generator: ...

    def load_file_bytes(self, *, file: File) -> bytes: ...

    def resolve_file_url(self, *, file: File, for_external: bool = True) -> str | None: ...

    def resolve_upload_file_url(
        self,
        *,
        upload_file_id: str,
        as_attachment: bool = False,
        for_external: bool = True,
    ) -> str: ...

    def resolve_tool_file_url(self, *, tool_file_id: str, extension: str, for_external: bool = True) -> str: ...

    def verify_preview_signature(
        self,
        *,
        preview_kind: Literal["image", "file"],
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
    ) -> bool: ...
