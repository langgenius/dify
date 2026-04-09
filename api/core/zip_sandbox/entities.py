"""Data classes for ZipSandbox file operations.

Separated from ``zip_sandbox.py`` so that lightweight consumers (tests,
shell-script builders) can import the types without pulling in the full
sandbox provider chain.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SandboxDownloadItem:
    """Unified download/inline item for sandbox file operations.

    For remote files, *url* is set and the item is fetched via ``curl``.
    For inline content, *content* is set and the bytes are written directly
    into the VM via ``upload_file`` — no network round-trip.
    """

    path: str
    url: str = ""
    content: bytes | None = field(default=None, repr=False)


@dataclass(frozen=True)
class SandboxUploadItem:
    """Item for uploading: sandbox path -> URL."""

    path: str
    url: str


@dataclass(frozen=True)
class SandboxFile:
    """A handle to a file in the sandbox."""

    path: str
