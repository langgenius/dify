from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

if TYPE_CHECKING:
    from core.sandbox.initializer import SandboxInitializer


class VMType(StrEnum):
    DOCKER = "docker"
    E2B = "e2b"
    LOCAL = "local"


class VMFactory:
    @classmethod
    def create(
        cls,
        tenant_id: str,
        vm_type: VMType,
        options: Mapping[str, Any] | None = None,
        environments: Mapping[str, str] | None = None,
        user_id: str | None = None,
        initializers: Sequence["SandboxInitializer"] | None = None,
    ) -> VirtualEnvironment:
        options = options or {}
        environments = environments or {}

        vm_class = cls._get_vm_class(vm_type)
        vm = vm_class(tenant_id=tenant_id, options=options, environments=environments, user_id=user_id)

        if initializers:
            for initializer in initializers:
                initializer.initialize(vm)

        return vm

    @classmethod
    def _get_vm_class(cls, vm_type: VMType) -> type[VirtualEnvironment]:
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
