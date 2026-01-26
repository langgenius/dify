from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SandboxFileNode:
    path: str
    is_dir: bool
    size: int | None
    mtime: int | None


@dataclass(frozen=True)
class SandboxFileDownloadTicket:
    download_url: str
    expires_in: int
    export_id: str
