from __future__ import annotations

from typing import TYPE_CHECKING

from .entities import SandboxDownloadItem, SandboxFile, SandboxUploadItem

if TYPE_CHECKING:
    from .zip_sandbox import ZipSandbox

__all__ = [
    "SandboxDownloadItem",
    "SandboxFile",
    "SandboxUploadItem",
    "ZipSandbox",
]


def __getattr__(name: str):
    if name == "ZipSandbox":
        from .zip_sandbox import ZipSandbox

        return ZipSandbox
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
