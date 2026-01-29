"""Sandbox file storage key generation.

Provides SandboxFilePaths facade for generating storage keys for sandbox file exports.
Storage instances are obtained via SandboxFileService.get_storage().
"""

from __future__ import annotations

_BASE = "sandbox_files"


class SandboxFilePaths:
    """Facade for generating sandbox file export storage keys."""

    @staticmethod
    def export(tenant_id: str, sandbox_id: str, export_id: str, filename: str) -> str:
        """sandbox_files/{tenant}/{sandbox}/{export_id}/{filename}"""
        return f"{_BASE}/{tenant_id}/{sandbox_id}/{export_id}/{filename}"
