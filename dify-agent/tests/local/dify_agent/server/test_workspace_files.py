from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

import pytest

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import (
    WorkspaceListRequest,
    WorkspaceReadRequest,
    WorkspaceUploadRequest,
    WorkspaceUploadedFile,
)
from dify_agent.runtime_backend import (
    RuntimeLayout,
    RuntimeLease,
    WorkspaceFileContent,
    WorkspaceFileEntry,
    WorkspaceListResult,
    WorkspaceReadResult,
)
from dify_agent.server.workspace_files import WorkspaceFileService


@dataclass(slots=True)
class _Files:
    calls: list[tuple[str, str]] = field(default_factory=list)

    async def list_directory(self, *, path: str, limit: int) -> WorkspaceListResult:
        self.calls.append(("list", path))
        assert limit == 1000
        return WorkspaceListResult(
            path=path,
            entries=(WorkspaceFileEntry(name="note.txt", type="file", size=4, mtime=1),),
            truncated=False,
        )

    async def read_file(self, *, path: str, max_bytes: int) -> WorkspaceReadResult:
        self.calls.append(("read", path))
        return WorkspaceReadResult(path=path, size=4, truncated=False, binary=False, text="note")

    async def read_bytes(self, *, path: str, max_bytes: int) -> WorkspaceFileContent:
        self.calls.append(("bytes", path))
        return WorkspaceFileContent(path=path, size=4, content=b"note")


@dataclass(slots=True)
class _Lease:
    files: _Files = field(default_factory=_Files)
    layout: RuntimeLayout = RuntimeLayout(home_dir="/home/agent", workspace_dir="/workspace")
    commands: object = field(default_factory=object)


@dataclass(slots=True)
class _Backend:
    lease: RuntimeLease
    acquired: list[str] = field(default_factory=list)
    releases: int = 0

    async def acquire(self, binding_ref: str) -> RuntimeLease:
        self.acquired.append(binding_ref)
        return self.lease

    async def release(self, lease: RuntimeLease) -> None:
        assert lease is self.lease
        self.releases += 1


@dataclass(slots=True)
class _Uploader:
    uploads: list[tuple[str, str, bytes]] = field(default_factory=list)

    async def upload(
        self,
        *,
        execution_context: DifyExecutionContextLayerConfig,
        filename: str,
        mimetype: str,
        content: bytes,
    ) -> WorkspaceUploadedFile:
        del execution_context
        self.uploads.append((filename, mimetype, content))
        return WorkspaceUploadedFile(reference="tool-file-1", download_url="https://files/note.txt")


@pytest.mark.anyio
async def test_workspace_service_passes_paths_directly_and_leases_each_operation() -> None:
    lease = _Lease()
    backend = _Backend(lease=cast(RuntimeLease, lease))
    uploader = _Uploader()
    service = WorkspaceFileService(
        execution_bindings=backend,  # pyright: ignore[reportArgumentType]
        upload_max_bytes=1024,
        file_uploader=uploader,
    )

    listing = await service.list_files(WorkspaceListRequest(backend_binding_ref="binding-ref", path="/var/data"))
    preview = await service.read_file(WorkspaceReadRequest(backend_binding_ref="binding-ref", path="~/note.txt"))
    uploaded = await service.upload_file(
        WorkspaceUploadRequest(
            backend_binding_ref="binding-ref",
            path="../outside.txt",
            execution_context=DifyExecutionContextLayerConfig(
                tenant_id="tenant-1",
                user_from="account",
                agent_mode="agent_app",
                invoke_from="debugger",
            ),
        )
    )

    assert listing.path == "/var/data"
    assert preview.path == "~/note.txt"
    assert uploaded.path == "../outside.txt"
    assert lease.files.calls == [
        ("list", "/var/data"),
        ("read", "~/note.txt"),
        ("bytes", "../outside.txt"),
    ]
    assert backend.acquired == ["binding-ref", "binding-ref", "binding-ref"]
    assert backend.releases == 3
    assert uploader.uploads == [("outside.txt", "text/plain", b"note")]
