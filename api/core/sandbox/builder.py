from __future__ import annotations

import logging
import threading
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from core.entities.provider_entities import BasicProviderConfig
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

from .entities.sandbox_type import SandboxType
from .initializer import SandboxInitializer
from .sandbox import Sandbox

if TYPE_CHECKING:
    from .storage.sandbox_storage import SandboxStorage

logger = logging.getLogger(__name__)


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
    _tenant_id: str
    _sandbox_type: SandboxType
    _user_id: str | None
    _app_id: str | None
    _options: dict[str, Any]
    _environments: dict[str, str]
    _initializers: list[SandboxInitializer]
    _storage: SandboxStorage | None
    _assets_id: str | None

    def __init__(self, tenant_id: str, sandbox_type: SandboxType) -> None:
        self._tenant_id = tenant_id
        self._sandbox_type = sandbox_type
        self._user_id = None
        self._app_id = None
        self._options = {}
        self._environments = {}
        self._initializers = []
        self._storage = None
        self._assets_id = None

    def user(self, user_id: str) -> SandboxBuilder:
        self._user_id = user_id
        return self

    def app(self, app_id: str) -> SandboxBuilder:
        self._app_id = app_id
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

    def storage(self, storage: SandboxStorage, assets_id: str) -> SandboxBuilder:
        self._storage = storage
        self._assets_id = assets_id
        return self

    def build(self) -> Sandbox:
        if self._storage is None:
            raise ValueError("storage is required, call .storage() before .build()")
        if self._assets_id is None:
            raise ValueError("assets_id is required, call .storage() before .build()")
        if self._user_id is None:
            raise ValueError("user_id is required, call .user() before .build()")
        if self._app_id is None:
            raise ValueError("app_id is required, call .app() before .build()")

        vm_class = _get_sandbox_class(self._sandbox_type)
        vm = vm_class(
            tenant_id=self._tenant_id,
            options=self._options,
            environments=self._environments,
            user_id=self._user_id,
        )
        sandbox = Sandbox(
            vm=vm,
            storage=self._storage,
            tenant_id=self._tenant_id,
            user_id=self._user_id,
            app_id=self._app_id,
            assets_id=self._assets_id,
        )

        # Run sandbox setup asynchronously so workflow execution can proceed.
        def initialize() -> None:
            try:
                for init in self._initializers:
                    if sandbox.is_cancelled():
                        return
                    init.initialize(sandbox)
                if sandbox.is_cancelled():
                    return
                sandbox.mount()
                sandbox.mark_ready()
            except Exception as exc:
                logger.exception("Failed to initialize sandbox: tenant_id=%s, app_id=%s", self._tenant_id, self._app_id)
                sandbox.mark_failed(exc)

        # Background init completes or signals failure via sandbox state.
        threading.Thread(target=initialize, daemon=True).start()
        return sandbox

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
