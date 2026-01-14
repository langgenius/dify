from __future__ import annotations

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


def _get_vm_class(vm_type: VMType) -> type[VirtualEnvironment]:
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


class VMBuilder:
    def __init__(self, tenant_id: str, vm_type: VMType) -> None:
        self._tenant_id = tenant_id
        self._vm_type = vm_type
        self._user_id: str | None = None
        self._options: dict[str, Any] = {}
        self._environments: dict[str, str] = {}
        self._initializers: list[SandboxInitializer] = []

    def user(self, user_id: str) -> VMBuilder:
        self._user_id = user_id
        return self

    def options(self, options: Mapping[str, Any]) -> VMBuilder:
        self._options = dict(options)
        return self

    def environments(self, environments: Mapping[str, str]) -> VMBuilder:
        self._environments = dict(environments)
        return self

    def initializer(self, initializer: SandboxInitializer) -> VMBuilder:
        self._initializers.append(initializer)
        return self

    def initializers(self, initializers: Sequence[SandboxInitializer]) -> VMBuilder:
        self._initializers.extend(initializers)
        return self

    def build(self) -> VirtualEnvironment:
        vm_class = _get_vm_class(self._vm_type)
        vm = vm_class(
            tenant_id=self._tenant_id,
            options=self._options,
            environments=self._environments,
            user_id=self._user_id,
        )
        for init in self._initializers:
            init.initialize(vm)
        return vm

    @staticmethod
    def validate(vm_type: VMType, options: Mapping[str, Any]) -> None:
        vm_class = _get_vm_class(vm_type)
        vm_class.validate(options)
