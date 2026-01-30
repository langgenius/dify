import logging

from core.sandbox.builder import SandboxBuilder
from core.sandbox.entities import AppAssets, SandboxType
from core.sandbox.entities.providers import SandboxProviderEntity
from core.sandbox.initializer.app_asset_attrs_initializer import AppAssetAttrsInitializer
from core.sandbox.initializer.app_assets_initializer import AppAssetsInitializer
from core.sandbox.initializer.dify_cli_initializer import DifyCliInitializer
from core.sandbox.initializer.draft_app_assets_initializer import DraftAppAssetsInitializer
from core.sandbox.initializer.skill_initializer import SkillInitializer
from core.sandbox.sandbox import Sandbox
from core.sandbox.storage.archive_storage import ArchiveSandboxStorage
from extensions.ext_storage import storage
from services.app_asset_package_service import AppAssetPackageService
from services.app_asset_service import AppAssetService

logger = logging.getLogger(__name__)


class SandboxService:
    @classmethod
    def create(
        cls,
        tenant_id: str,
        app_id: str,
        user_id: str,
        sandbox_id: str,
        sandbox_provider: SandboxProviderEntity,
    ) -> Sandbox:
        assets = AppAssetService.get_assets(tenant_id, app_id, user_id, is_draft=False)
        if not assets:
            raise ValueError(f"No assets found for tid={tenant_id}, app_id={app_id}")

        archive_storage = ArchiveSandboxStorage(tenant_id, app_id, sandbox_id, storage.storage_runner)
        sandbox = (
            SandboxBuilder(tenant_id, SandboxType(sandbox_provider.provider_type))
            .options(sandbox_provider.config)
            .user(user_id)
            .app(app_id)
            .initializer(AppAssetAttrsInitializer(tenant_id, app_id, assets.id))
            .initializer(AppAssetsInitializer(tenant_id, app_id, assets.id))
            .initializer(DifyCliInitializer(tenant_id, user_id, app_id, assets.id))
            .initializer(SkillInitializer(tenant_id, user_id, app_id, assets.id))
            .storage(archive_storage, assets.id)
            .build()
        )

        logger.info("Sandbox created: id=%s, assets=%s", sandbox.vm.metadata.id, sandbox.assets_id)
        return sandbox

    @classmethod
    def delete_draft_storage(cls, tenant_id: str, app_id: str, user_id: str) -> None:
        archive_storage = ArchiveSandboxStorage(
            tenant_id, app_id, SandboxBuilder.draft_id(user_id), storage.storage_runner
        )
        archive_storage.delete()

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

        AppAssetPackageService.build_assets(tenant_id, app_id, assets)
        sandbox_id = SandboxBuilder.draft_id(user_id)
        archive_storage = ArchiveSandboxStorage(
            tenant_id, app_id, sandbox_id, storage.storage_runner, exclude_patterns=[AppAssets.PATH]
        )

        sandbox = (
            SandboxBuilder(tenant_id, SandboxType(sandbox_provider.provider_type))
            .options(sandbox_provider.config)
            .user(user_id)
            .app(app_id)
            .initializer(AppAssetAttrsInitializer(tenant_id, app_id, assets.id))
            .initializer(DraftAppAssetsInitializer(tenant_id, app_id, assets.id))
            .initializer(DifyCliInitializer(tenant_id, user_id, app_id, assets.id))
            .initializer(SkillInitializer(tenant_id, user_id, app_id, assets.id))
            .storage(archive_storage, assets.id)
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

        AppAssetPackageService.build_assets(tenant_id, app_id, assets)
        sandbox_id = SandboxBuilder.draft_id(user_id)
        archive_storage = ArchiveSandboxStorage(
            tenant_id, app_id, sandbox_id, storage.storage_runner, exclude_patterns=[AppAssets.PATH]
        )

        sandbox = (
            SandboxBuilder(tenant_id, SandboxType(sandbox_provider.provider_type))
            .options(sandbox_provider.config)
            .user(user_id)
            .app(app_id)
            .initializer(AppAssetAttrsInitializer(tenant_id, app_id, assets.id))
            .initializer(DraftAppAssetsInitializer(tenant_id, app_id, assets.id))
            .initializer(DifyCliInitializer(tenant_id, user_id, app_id, assets.id))
            .initializer(SkillInitializer(tenant_id, user_id, app_id, assets.id))
            .storage(archive_storage, assets.id)
            .build()
        )

        logger.info("Single-step sandbox created: id=%s, assets=%s", sandbox.vm.metadata.id, sandbox.assets_id)
        return sandbox
