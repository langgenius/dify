from __future__ import annotations

import logging
import threading
from typing import Final

from core.sandbox.builder import SandboxBuilder
from core.sandbox.entities import AppAssets, SandboxType
from core.sandbox.entities.providers import SandboxProviderEntity
from core.sandbox.initializer.app_assets_initializer import AppAssetsInitializer
from core.sandbox.initializer.dify_cli_initializer import DifyCliInitializer
from core.sandbox.initializer.skill_initializer import SkillInitializer
from core.sandbox.sandbox import Sandbox
from core.sandbox.storage.archive_storage import ArchiveSandboxStorage
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from services.app_asset_service import AppAssetService

logger = logging.getLogger(__name__)


class SandboxManager:
    _NUM_SHARDS: Final[int] = 1024
    _SHARD_MASK: Final[int] = _NUM_SHARDS - 1

    _shard_locks: Final[tuple[threading.Lock, ...]] = tuple(threading.Lock() for _ in range(_NUM_SHARDS))
    _shards: list[dict[str, VirtualEnvironment]] = [{} for _ in range(_NUM_SHARDS)]

    @classmethod
    def _shard_index(cls, workflow_execution_id: str) -> int:
        return hash(workflow_execution_id) & cls._SHARD_MASK

    @classmethod
    def register(cls, workflow_execution_id: str, sandbox: VirtualEnvironment) -> None:
        if not workflow_execution_id:
            raise ValueError("workflow_execution_id cannot be empty")

        shard_index = cls._shard_index(workflow_execution_id)
        with cls._shard_locks[shard_index]:
            shard = cls._shards[shard_index]
            if workflow_execution_id in shard:
                raise RuntimeError(
                    f"Sandbox already registered for workflow_execution_id={workflow_execution_id}. "
                    "Call unregister() first if you need to replace it."
                )

            new_shard = dict(shard)
            new_shard[workflow_execution_id] = sandbox
            cls._shards[shard_index] = new_shard

        logger.debug(
            "Registered sandbox for workflow_execution_id=%s, sandbox_id=%s",
            workflow_execution_id,
            sandbox.metadata.id,
        )

    @classmethod
    def get(cls, workflow_execution_id: str) -> VirtualEnvironment | None:
        shard_index = cls._shard_index(workflow_execution_id)
        return cls._shards[shard_index].get(workflow_execution_id)

    @classmethod
    def unregister(cls, workflow_execution_id: str) -> VirtualEnvironment | None:
        shard_index = cls._shard_index(workflow_execution_id)
        with cls._shard_locks[shard_index]:
            shard = cls._shards[shard_index]
            sandbox = shard.get(workflow_execution_id)
            if sandbox is None:
                return None

            new_shard = dict(shard)
            new_shard.pop(workflow_execution_id, None)
            cls._shards[shard_index] = new_shard

        logger.debug(
            "Unregistered sandbox for workflow_execution_id=%s, sandbox_id=%s",
            workflow_execution_id,
            sandbox.metadata.id,
        )
        return sandbox

    @classmethod
    def has(cls, workflow_execution_id: str) -> bool:
        shard_index = cls._shard_index(workflow_execution_id)
        return workflow_execution_id in cls._shards[shard_index]

    @classmethod
    def is_sandbox_runtime(cls, workflow_execution_id: str) -> bool:
        return cls.has(workflow_execution_id)

    @classmethod
    def clear(cls) -> None:
        for lock in cls._shard_locks:
            lock.acquire()
        try:
            for i in range(cls._NUM_SHARDS):
                cls._shards[i] = {}
            logger.debug("Cleared all registered sandboxes")
        finally:
            for lock in reversed(cls._shard_locks):
                lock.release()

    @classmethod
    def count(cls) -> int:
        return sum(len(shard) for shard in cls._shards)

    @classmethod
    def create(
        cls,
        tenant_id: str,
        app_id: str,
        user_id: str,
        workflow_execution_id: str,
        sandbox_provider: SandboxProviderEntity,
    ) -> Sandbox:
        assets = AppAssetService.get_assets(tenant_id, app_id, user_id, is_draft=False)
        if not assets:
            raise ValueError(f"No assets found for tid={tenant_id}, app_id={app_id}")

        storage = ArchiveSandboxStorage(tenant_id, workflow_execution_id)
        sandbox = (
            SandboxBuilder(tenant_id, SandboxType(sandbox_provider.provider_type))
            .options(sandbox_provider.config)
            .user(user_id)
            .app(app_id)
            .initializer(AppAssetsInitializer(tenant_id, app_id, assets.id))
            .initializer(DifyCliInitializer(tenant_id, user_id, app_id, assets.id))
            .initializer(SkillInitializer(tenant_id, user_id, app_id, assets.id))
            .storage(storage, assets.id)
            .build()
        )

        logger.info("Sandbox created: id=%s, assets=%s", sandbox.vm.metadata.id, sandbox.assets_id)
        return sandbox

    @classmethod
    def delete_storage(cls, tenant_id: str, user_id: str) -> None:
        storage = ArchiveSandboxStorage(tenant_id, SandboxBuilder.draft_id(user_id))
        storage.delete()

    @classmethod
    def create_draft(
        cls,
        tenant_id: str,
        app_id: str,
        user_id: str,
        sandbox_provider: SandboxProviderEntity,
    ) -> Sandbox:
        assets = AppAssetService.get_assets(tenant_id, app_id, user_id, is_draft=True)
        if not assets:
            raise ValueError(f"No assets found for tid={tenant_id}, app_id={app_id}")

        AppAssetService.build_assets(tenant_id, app_id, assets)
        sandbox_id = SandboxBuilder.draft_id(user_id)
        storage = ArchiveSandboxStorage(tenant_id, sandbox_id, exclude_patterns=[AppAssets.PATH])

        sandbox = (
            SandboxBuilder(tenant_id, SandboxType(sandbox_provider.provider_type))
            .options(sandbox_provider.config)
            .user(user_id)
            .app(app_id)
            .initializer(AppAssetsInitializer(tenant_id, app_id, assets.id))
            .initializer(DifyCliInitializer(tenant_id, user_id, app_id, assets.id))
            .initializer(SkillInitializer(tenant_id, user_id, app_id, assets.id))
            .storage(storage, assets.id)
            .build()
        )

        logger.info("Draft sandbox created: id=%s, assets=%s", sandbox.vm.metadata.id, sandbox.assets_id)
        return sandbox

    @classmethod
    def create_for_single_step(
        cls,
        tenant_id: str,
        app_id: str,
        user_id: str,
        sandbox_provider: SandboxProviderEntity,
    ) -> Sandbox:
        assets = AppAssetService.get_assets(tenant_id, app_id, user_id, is_draft=True)
        if not assets:
            raise ValueError(f"No assets found for tid={tenant_id}, app_id={app_id}")

        AppAssetService.build_assets(tenant_id, app_id, assets)
        sandbox_id = SandboxBuilder.draft_id(user_id)
        storage = ArchiveSandboxStorage(tenant_id, sandbox_id, exclude_patterns=[AppAssets.PATH])

        sandbox = (
            SandboxBuilder(tenant_id, SandboxType(sandbox_provider.provider_type))
            .options(sandbox_provider.config)
            .user(user_id)
            .app(app_id)
            .initializer(AppAssetsInitializer(tenant_id, app_id, assets.id))
            .initializer(DifyCliInitializer(tenant_id, user_id, app_id, assets.id))
            .initializer(SkillInitializer(tenant_id, user_id, app_id, assets.id))
            .storage(storage, assets.id)
            .build()
        )

        logger.info("Single-step sandbox created: id=%s, assets=%s", sandbox.vm.metadata.id, sandbox.assets_id)
        return sandbox
