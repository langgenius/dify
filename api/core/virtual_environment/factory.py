"""
Sandbox factory for creating VirtualEnvironment instances.

Example:
    sandbox = SandboxFactory.create(
        tenant_id="tenant-uuid",
        sandbox_type=SandboxType.DOCKER,
        options={"docker_image": "python:3.11-slim"},
        environments={"PATH": "/usr/local/bin"},
    )
"""

from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


class SandboxType(StrEnum):
    """Supported sandbox types."""

    DOCKER = "docker"
    E2B = "e2b"
    LOCAL = "local"


class SandboxFactory:
    """
    Factory for creating VirtualEnvironment (sandbox) instances.

    Uses lazy imports to avoid loading unused providers.
    """

    @classmethod
    def create(
        cls,
        tenant_id: str,
        sandbox_type: SandboxType,
        options: Mapping[str, Any] | None = None,
        environments: Mapping[str, str] | None = None,
        user_id: str | None = None,
    ) -> VirtualEnvironment:
        """
        Create a VirtualEnvironment instance based on the specified type.

        Args:
            tenant_id: Tenant ID associated with the sandbox (required)
            sandbox_type: Type of sandbox to create
            options: Sandbox-specific configuration options
            environments: Environment variables to set in the sandbox
            user_id: User ID associated with the sandbox (optional)

        Returns:
            Configured VirtualEnvironment instance

        Raises:
            ValueError: If sandbox type is not supported
        """
        options = options or {}
        environments = environments or {}

        sandbox_class = cls._get_sandbox_class(sandbox_type)
        return sandbox_class(tenant_id=tenant_id, options=options, environments=environments, user_id=user_id)

    @classmethod
    def _get_sandbox_class(cls, sandbox_type: SandboxType) -> type[VirtualEnvironment]:
        """Get the sandbox class for the specified type (lazy import)."""
        match sandbox_type:
            case SandboxType.DOCKER:
                from core.virtual_environment.providers.docker_daemon_sandbox import DockerDaemonEnvironment

                return DockerDaemonEnvironment
            case SandboxType.E2B:
                from core.virtual_environment.providers.e2b_sandbox import E2BEnvironment

                return E2BEnvironment
            case SandboxType.LOCAL:
                from core.virtual_environment.providers.local_without_isolation import LocalVirtualEnvironment

                return LocalVirtualEnvironment
            case _:
                raise ValueError(f"Unsupported sandbox type: {sandbox_type}")

    @classmethod
    def validate(cls, sandbox_type: SandboxType, options: Mapping[str, Any]) -> None:
        sandbox_class = cls._get_sandbox_class(sandbox_type)
        sandbox_class.validate(options)
