"""
VM factory for creating VirtualEnvironment instances.

Example:
    vm = VMFactory.create(
        tenant_id="tenant-uuid",
        vm_type=VMType.DOCKER,
        options={"docker_image": "python:3.11-slim"},
        environments={"PATH": "/usr/local/bin"},
    )
"""

from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


class VMType(StrEnum):
    """Supported VM types."""

    DOCKER = "docker"
    E2B = "e2b"
    LOCAL = "local"


class VMFactory:
    """
    Factory for creating VirtualEnvironment (VM) instances.

    Uses lazy imports to avoid loading unused providers.
    """

    @classmethod
    def create(
        cls,
        tenant_id: str,
        vm_type: VMType,
        options: Mapping[str, Any] | None = None,
        environments: Mapping[str, str] | None = None,
        user_id: str | None = None,
    ) -> VirtualEnvironment:
        """
        Create a VirtualEnvironment instance based on the specified type.

        Args:
            tenant_id: Tenant ID associated with the VM (required)
            vm_type: Type of VM to create
            options: VM-specific configuration options
            environments: Environment variables to set in the VM
            user_id: User ID associated with the VM (optional)

        Returns:
            Configured VirtualEnvironment instance

        Raises:
            ValueError: If VM type is not supported
        """
        options = options or {}
        environments = environments or {}

        vm_class = cls._get_vm_class(vm_type)
        return vm_class(tenant_id=tenant_id, options=options, environments=environments, user_id=user_id)

    @classmethod
    def _get_vm_class(cls, vm_type: VMType) -> type[VirtualEnvironment]:
        """Get the VM class for the specified type (lazy import)."""
        match vm_type:
            case VMType.DOCKER:
                from core.virtual_environment.providers.docker_daemon_sandbox import DockerDaemonEnvironment

                return DockerDaemonEnvironment
            case VMType.E2B:
                from core.virtual_environment.providers.e2b_sandbox import E2BEnvironment

                return E2BEnvironment
            case VMType.LOCAL:
                from core.virtual_environment.providers.local_without_isolation import LocalVirtualEnvironment

                return LocalVirtualEnvironment
            case _:
                raise ValueError(f"Unsupported VM type: {vm_type}")

    @classmethod
    def validate(cls, vm_type: VMType, options: Mapping[str, Any]) -> None:
        vm_class = cls._get_vm_class(vm_type)
        vm_class.validate(options)
