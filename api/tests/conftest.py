from __future__ import annotations

from collections.abc import Generator
from typing import TYPE_CHECKING, Literal, override

import pytest

from graphon.file.protocols import WorkflowFileRuntimeProtocol
from graphon.file.runtime import peek_workflow_file_runtime, set_workflow_file_runtime

if TYPE_CHECKING:
    from graphon.file import File
    from graphon.http.protocols import HttpResponseProtocol


class _LazyDifyWorkflowFileRuntime(WorkflowFileRuntimeProtocol):
    def __init__(self) -> None:
        self._runtime: WorkflowFileRuntimeProtocol | None = None

    def _load(self) -> WorkflowFileRuntimeProtocol:
        if self._runtime is None:
            from core.app.workflow.file_runtime import bind_dify_workflow_file_runtime

            bind_dify_workflow_file_runtime()
            runtime = peek_workflow_file_runtime()
            assert runtime is not None
            assert runtime is not self
            self._runtime = runtime
        return self._runtime

    @property
    @override
    def multimodal_send_format(self) -> str:
        return self._load().multimodal_send_format

    @override
    def http_get(self, url: str, *, follow_redirects: bool = True) -> HttpResponseProtocol:
        return self._load().http_get(url, follow_redirects=follow_redirects)

    @override
    def storage_load(self, path: str, *, stream: bool = False) -> bytes | Generator:
        return self._load().storage_load(path, stream=stream)

    @override
    def load_file_bytes(self, *, file: File) -> bytes:
        return self._load().load_file_bytes(file=file)

    @override
    def resolve_file_url(self, *, file: File, for_external: bool = True) -> str | None:
        return self._load().resolve_file_url(file=file, for_external=for_external)

    @override
    def resolve_upload_file_url(
        self,
        *,
        upload_file_id: str,
        as_attachment: bool = False,
        for_external: bool = True,
    ) -> str:
        return self._load().resolve_upload_file_url(
            upload_file_id=upload_file_id,
            as_attachment=as_attachment,
            for_external=for_external,
        )

    @override
    def resolve_tool_file_url(
        self,
        *,
        tool_file_id: str,
        extension: str,
        for_external: bool = True,
    ) -> str:
        return self._load().resolve_tool_file_url(
            tool_file_id=tool_file_id,
            extension=extension,
            for_external=for_external,
        )

    @override
    def verify_preview_signature(
        self,
        *,
        preview_kind: Literal["image", "file"],
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
    ) -> bool:
        return self._load().verify_preview_signature(
            preview_kind=preview_kind,
            file_id=file_id,
            timestamp=timestamp,
            nonce=nonce,
            sign=sign,
        )


@pytest.fixture(autouse=True)
def _bind_workflow_file_runtime() -> None:
    set_workflow_file_runtime(_LazyDifyWorkflowFileRuntime())
