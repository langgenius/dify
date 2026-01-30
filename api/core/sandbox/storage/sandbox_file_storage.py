"""Sandbox file storage key generation.

Provides SandboxFilePaths facade for generating storage keys for sandbox files.
Storage instances are obtained via SandboxFileService.get_storage().
"""

from __future__ import annotations


class SandboxFilePaths:
    """Facade for generating sandbox file storage keys."""

    @staticmethod
    def export(tenant_id: str, app_id: str, sandbox_id: str, export_id: str, filename: str) -> str:
        """sandbox_files/{tenant}/{app}/{sandbox}/{export_id}/{filename}"""
        return f"sandbox_files/{tenant_id}/{app_id}/{sandbox_id}/{export_id}/{filename}"

    @staticmethod
    def archive(tenant_id: str, app_id: str, sandbox_id: str) -> str:
        """sandbox_archives/{tenant}/{app}/{sandbox}.tar.gz"""
        return f"sandbox_archives/{tenant_id}/{app_id}/{sandbox_id}.tar.gz"
