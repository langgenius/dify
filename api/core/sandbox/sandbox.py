from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from libs.attr_map import AttrMap

if TYPE_CHECKING:
    from core.sandbox.storage.sandbox_storage import SandboxStorage
    from core.virtual_environment.__base.virtual_environment import VirtualEnvironment

logger = logging.getLogger(__name__)


class Sandbox:
    def __init__(
        self,
        *,
        vm: VirtualEnvironment,
        storage: SandboxStorage,
        tenant_id: str,
        user_id: str,
        app_id: str,
        assets_id: str,
    ) -> None:
        self._vm = vm
        self._storage = storage
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._app_id = app_id
        self._assets_id = assets_id
        self._attributes = AttrMap()

    @property
    def attrs(self) -> AttrMap:
        return self._attributes

    @property
    def vm(self) -> VirtualEnvironment:
        return self._vm

    @property
    def storage(self) -> SandboxStorage:
        return self._storage

    @property
    def tenant_id(self) -> str:
        return self._tenant_id

    @property
    def user_id(self) -> str:
        return self._user_id

    @property
    def app_id(self) -> str:
        return self._app_id

    @property
    def assets_id(self) -> str:
        return self._assets_id

    def mount(self) -> bool:
        return self._storage.mount(self._vm)

    def unmount(self) -> bool:
        return self._storage.unmount(self._vm)

    def release(self) -> None:
        sandbox_id = self._vm.metadata.id
        try:
            self._storage.unmount(self._vm)
            logger.info("Sandbox storage unmounted: sandbox_id=%s", sandbox_id)
        except Exception:
            logger.exception("Failed to unmount sandbox storage: sandbox_id=%s", sandbox_id)

        try:
            self._vm.release_environment()
            logger.info("Sandbox released: sandbox_id=%s", sandbox_id)
        except Exception:
            logger.exception("Failed to release sandbox: sandbox_id=%s", sandbox_id)
