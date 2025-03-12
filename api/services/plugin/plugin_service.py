import logging
from collections.abc import Mapping, Sequence
from mimetypes import guess_type
from typing import Optional

from pydantic import BaseModel

from configs import dify_config
from core.helper import marketplace
from core.helper.download import download_with_size_limit
from core.helper.marketplace import download_plugin_pkg
from core.plugin.entities.bundle import PluginBundleDependency
from core.plugin.entities.plugin import (
    GenericProviderID,
    PluginDeclaration,
    PluginEntity,
    PluginInstallation,
    PluginInstallationSource,
)
from core.plugin.entities.plugin_daemon import PluginInstallTask, PluginUploadResponse
from core.plugin.manager.asset import PluginAssetManager
from core.plugin.manager.debugging import PluginDebuggingManager
from core.plugin.manager.plugin import PluginInstallationManager
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


class PluginService:
    class LatestPluginCache(BaseModel):
        plugin_id: str
        version: str
        unique_identifier: str

    REDIS_KEY_PREFIX = "plugin_service:latest_plugin:"
    REDIS_TTL = 60 * 5  # 5 minutes

    @staticmethod
    def fetch_latest_plugin_version(plugin_ids: Sequence[str]) -> Mapping[str, Optional[LatestPluginCache]]:
        """
        Fetch the latest plugin version
        """
        result: dict[str, Optional[PluginService.LatestPluginCache]] = {}

        try:
            cache_not_exists = []

            # Try to get from Redis first
            for plugin_id in plugin_ids:
                cached_data = redis_client.get(f"{PluginService.REDIS_KEY_PREFIX}{plugin_id}")
                if cached_data:
                    result[plugin_id] = PluginService.LatestPluginCache.model_validate_json(cached_data)
                else:
                    cache_not_exists.append(plugin_id)

            if cache_not_exists:
                manifests = {
                    manifest.plugin_id: manifest
                    for manifest in marketplace.batch_fetch_plugin_manifests(cache_not_exists)
                }

                for plugin_id, manifest in manifests.items():
                    latest_plugin = PluginService.LatestPluginCache(
                        plugin_id=plugin_id,
                        version=manifest.latest_version,
                        unique_identifier=manifest.latest_package_identifier,
                    )

                    # Store in Redis
                    redis_client.setex(
                        f"{PluginService.REDIS_KEY_PREFIX}{plugin_id}",
                        PluginService.REDIS_TTL,
                        latest_plugin.model_dump_json(),
                    )

                    result[plugin_id] = latest_plugin

                    # pop plugin_id from cache_not_exists
                    cache_not_exists.remove(plugin_id)

                for plugin_id in cache_not_exists:
                    result[plugin_id] = None

            return result
        except Exception:
            logger.exception("failed to fetch latest plugin version")
            return result

    @staticmethod
    def get_debugging_key(tenant_id: str) -> str:
        """
        get the debugging key of the tenant
        """
        manager = PluginDebuggingManager()
        return manager.get_debugging_key(tenant_id)

    @staticmethod
    def list(tenant_id: str) -> list[PluginEntity]:
        """
        list all plugins of the tenant
        """
        manager = PluginInstallationManager()
        plugins = manager.list_plugins(tenant_id)
        plugin_ids = [plugin.plugin_id for plugin in plugins if plugin.source == PluginInstallationSource.Marketplace]
        try:
            manifests = PluginService.fetch_latest_plugin_version(plugin_ids)
        except Exception:
            manifests = {}
            logger.exception("failed to fetch plugin manifests")

        for plugin in plugins:
            if plugin.source == PluginInstallationSource.Marketplace:
                if plugin.plugin_id in manifests:
                    latest_plugin_cache = manifests[plugin.plugin_id]
                    if latest_plugin_cache:
                        # set latest_version
                        plugin.latest_version = latest_plugin_cache.version
                        plugin.latest_unique_identifier = latest_plugin_cache.unique_identifier

        return plugins

    @staticmethod
    def list_installations_from_ids(tenant_id: str, ids: Sequence[str]) -> Sequence[PluginInstallation]:
        """
        List plugin installations from ids
        """
        manager = PluginInstallationManager()
        return manager.fetch_plugin_installation_by_ids(tenant_id, ids)

    @staticmethod
    def get_asset(tenant_id: str, asset_file: str) -> tuple[bytes, str]:
        """
        get the asset file of the plugin
        """
        manager = PluginAssetManager()
        # guess mime type
        mime_type, _ = guess_type(asset_file)
        return manager.fetch_asset(tenant_id, asset_file), mime_type or "application/octet-stream"

    @staticmethod
    def check_plugin_unique_identifier(tenant_id: str, plugin_unique_identifier: str) -> bool:
        """
        check if the plugin unique identifier is already installed by other tenant
        """
        manager = PluginInstallationManager()
        return manager.fetch_plugin_by_identifier(tenant_id, plugin_unique_identifier)

    @staticmethod
    def fetch_plugin_manifest(tenant_id: str, plugin_unique_identifier: str) -> PluginDeclaration:
        """
        Fetch plugin manifest
        """
        manager = PluginInstallationManager()
        return manager.fetch_plugin_manifest(tenant_id, plugin_unique_identifier)

    @staticmethod
    def fetch_install_tasks(tenant_id: str, page: int, page_size: int) -> Sequence[PluginInstallTask]:
        """
        Fetch plugin installation tasks
        """
        manager = PluginInstallationManager()
        return manager.fetch_plugin_installation_tasks(tenant_id, page, page_size)

    @staticmethod
    def fetch_install_task(tenant_id: str, task_id: str) -> PluginInstallTask:
        manager = PluginInstallationManager()
        return manager.fetch_plugin_installation_task(tenant_id, task_id)

    @staticmethod
    def delete_install_task(tenant_id: str, task_id: str) -> bool:
        """
        Delete a plugin installation task
        """
        manager = PluginInstallationManager()
        return manager.delete_plugin_installation_task(tenant_id, task_id)

    @staticmethod
    def delete_all_install_task_items(
        tenant_id: str,
    ) -> bool:
        """
        Delete all plugin installation task items
        """
        manager = PluginInstallationManager()
        return manager.delete_all_plugin_installation_task_items(tenant_id)

    @staticmethod
    def delete_install_task_item(tenant_id: str, task_id: str, identifier: str) -> bool:
        """
        Delete a plugin installation task item
        """
        manager = PluginInstallationManager()
        return manager.delete_plugin_installation_task_item(tenant_id, task_id, identifier)

    @staticmethod
    def upgrade_plugin_with_marketplace(
        tenant_id: str, original_plugin_unique_identifier: str, new_plugin_unique_identifier: str
    ):
        """
        Upgrade plugin with marketplace
        """
        if original_plugin_unique_identifier == new_plugin_unique_identifier:
            raise ValueError("you should not upgrade plugin with the same plugin")

        # check if plugin pkg is already downloaded
        manager = PluginInstallationManager()

        try:
            manager.fetch_plugin_manifest(tenant_id, new_plugin_unique_identifier)
            # already downloaded, skip, and record install event
            marketplace.record_install_plugin_event(new_plugin_unique_identifier)
        except Exception:
            # plugin not installed, download and upload pkg
            pkg = download_plugin_pkg(new_plugin_unique_identifier)
            manager.upload_pkg(tenant_id, pkg, verify_signature=False)

        return manager.upgrade_plugin(
            tenant_id,
            original_plugin_unique_identifier,
            new_plugin_unique_identifier,
            PluginInstallationSource.Marketplace,
            {
                "plugin_unique_identifier": new_plugin_unique_identifier,
            },
        )

    @staticmethod
    def upgrade_plugin_with_github(
        tenant_id: str,
        original_plugin_unique_identifier: str,
        new_plugin_unique_identifier: str,
        repo: str,
        version: str,
        package: str,
    ):
        """
        Upgrade plugin with github
        """
        manager = PluginInstallationManager()
        return manager.upgrade_plugin(
            tenant_id,
            original_plugin_unique_identifier,
            new_plugin_unique_identifier,
            PluginInstallationSource.Github,
            {
                "repo": repo,
                "version": version,
                "package": package,
            },
        )

    @staticmethod
    def upload_pkg(tenant_id: str, pkg: bytes, verify_signature: bool = False) -> PluginUploadResponse:
        """
        Upload plugin package files

        returns: plugin_unique_identifier
        """
        manager = PluginInstallationManager()
        return manager.upload_pkg(tenant_id, pkg, verify_signature)

    @staticmethod
    def upload_pkg_from_github(
        tenant_id: str, repo: str, version: str, package: str, verify_signature: bool = False
    ) -> PluginUploadResponse:
        """
        Install plugin from github release package files,
        returns plugin_unique_identifier
        """
        pkg = download_with_size_limit(
            f"https://github.com/{repo}/releases/download/{version}/{package}", dify_config.PLUGIN_MAX_PACKAGE_SIZE
        )

        manager = PluginInstallationManager()
        return manager.upload_pkg(
            tenant_id,
            pkg,
            verify_signature,
        )

    @staticmethod
    def upload_bundle(
        tenant_id: str, bundle: bytes, verify_signature: bool = False
    ) -> Sequence[PluginBundleDependency]:
        """
        Upload a plugin bundle and return the dependencies.
        """
        manager = PluginInstallationManager()
        return manager.upload_bundle(tenant_id, bundle, verify_signature)

    @staticmethod
    def install_from_local_pkg(tenant_id: str, plugin_unique_identifiers: Sequence[str]):
        manager = PluginInstallationManager()
        return manager.install_from_identifiers(
            tenant_id,
            plugin_unique_identifiers,
            PluginInstallationSource.Package,
            [{}],
        )

    @staticmethod
    def install_from_github(tenant_id: str, plugin_unique_identifier: str, repo: str, version: str, package: str):
        """
        Install plugin from github release package files,
        returns plugin_unique_identifier
        """
        manager = PluginInstallationManager()
        return manager.install_from_identifiers(
            tenant_id,
            [plugin_unique_identifier],
            PluginInstallationSource.Github,
            [
                {
                    "repo": repo,
                    "version": version,
                    "package": package,
                }
            ],
        )

    @staticmethod
    def install_from_marketplace_pkg(
        tenant_id: str, plugin_unique_identifiers: Sequence[str], verify_signature: bool = False
    ):
        """
        Install plugin from marketplace package files,
        returns installation task id
        """
        manager = PluginInstallationManager()

        # check if already downloaded
        for plugin_unique_identifier in plugin_unique_identifiers:
            try:
                manager.fetch_plugin_manifest(tenant_id, plugin_unique_identifier)
                # already downloaded, skip
            except Exception:
                # plugin not installed, download and upload pkg
                pkg = download_plugin_pkg(plugin_unique_identifier)
                manager.upload_pkg(tenant_id, pkg, verify_signature)

        return manager.install_from_identifiers(
            tenant_id,
            plugin_unique_identifiers,
            PluginInstallationSource.Marketplace,
            [
                {
                    "plugin_unique_identifier": plugin_unique_identifier,
                }
                for plugin_unique_identifier in plugin_unique_identifiers
            ],
        )

    @staticmethod
    def uninstall(tenant_id: str, plugin_installation_id: str) -> bool:
        manager = PluginInstallationManager()
        return manager.uninstall(tenant_id, plugin_installation_id)

    @staticmethod
    def check_tools_existence(tenant_id: str, provider_ids: Sequence[GenericProviderID]) -> Sequence[bool]:
        """
        Check if the tools exist
        """
        manager = PluginInstallationManager()
        return manager.check_tools_existence(tenant_id, provider_ids)
