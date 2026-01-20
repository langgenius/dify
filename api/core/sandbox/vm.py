"""
Facade module for virtual machine providers.

Provides unified interfaces to access different VM provider implementations
(E2B, Docker, Local) through VMType, VMBuilder, and VMConfig.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any

from configs import dify_config
from core.entities.provider_entities import BasicProviderConfig
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

from .initializer import SandboxInitializer


class SandboxType(StrEnum):
    """
    Sandbox types.
    """

    DOCKER = "docker"
    E2B = "e2b"
    LOCAL = "local"

    @classmethod
    def get_all(cls) -> list[str]:
        """
        Get all available sandbox types.
        """
        if dify_config.EDITION == "SELF_HOSTED":
            return [p.value for p in cls]
        else:
            return [p.value for p in cls if p != SandboxType.LOCAL]


def _get_sandbox_class(sandbox_type: SandboxType) -> type[VirtualEnvironment]:
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


class SandboxBuilder:
    def __init__(self, tenant_id: str, sandbox_type: SandboxType) -> None:
        self._tenant_id = tenant_id
        self._sandbox_type = sandbox_type
        self._user_id: str | None = None
        self._options: dict[str, Any] = {}
        self._environments: dict[str, str] = {}
        self._initializers: list[SandboxInitializer] = []

    def user(self, user_id: str) -> SandboxBuilder:
        self._user_id = user_id
        return self

    def options(self, options: Mapping[str, Any]) -> SandboxBuilder:
        self._options = dict(options)
        return self

    def environments(self, environments: Mapping[str, str]) -> SandboxBuilder:
        self._environments = dict(environments)
        return self

    def initializer(self, initializer: SandboxInitializer) -> SandboxBuilder:
        self._initializers.append(initializer)
        return self

    def initializers(self, initializers: Sequence[SandboxInitializer]) -> SandboxBuilder:
        self._initializers.extend(initializers)
        return self

    def build(self) -> VirtualEnvironment:
        vm_class = _get_sandbox_class(self._sandbox_type)
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
    def validate(vm_type: SandboxType, options: Mapping[str, Any]) -> None:
        vm_class = _get_sandbox_class(vm_type)
        vm_class.validate(options)

    @classmethod
    def draft_id(cls, user_id: str) -> str:
        return f"sandbox_draft_{user_id}"


class VMConfig:
    @staticmethod
    def get_schema(vm_type: SandboxType) -> list[BasicProviderConfig]:
        return _get_sandbox_class(vm_type).get_config_schema()
