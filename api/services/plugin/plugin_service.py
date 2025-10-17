import logging
from collections.abc import Mapping, Sequence
from mimetypes import guess_type

from pydantic import BaseModel

from configs import dify_config
from core.helper import marketplace
from core.helper.download import download_with_size_limit
from core.helper.marketplace import download_plugin_pkg
from core.plugin.entities.bundle import PluginBundleDependency
from core.plugin.entities.plugin import (
    PluginDeclaration,
    PluginEntity,
    PluginInstallation,
    PluginInstallationSource,
)
from core.plugin.entities.plugin_daemon import (
    PluginDecodeResponse,
    PluginInstallTask,
    PluginListResponse,
    PluginVerification,
)
from core.plugin.impl.asset import PluginAssetManager
from core.plugin.impl.debugging import PluginDebuggingClient
from core.plugin.impl.plugin import PluginInstaller
from extensions.ext_redis import redis_client
from models.provider_ids import GenericProviderID
from services.errors.plugin import PluginInstallationForbiddenError
from services.feature_service import FeatureService, PluginInstallationScope

logger = logging.getLogger(__name__)


class PluginService:
    class LatestPluginCache(BaseModel):
        plugin_id: str
        version: str
        unique_identifier: str
        status: str
        deprecated_reason: str
        alternative_plugin_id: str

    REDIS_KEY_PREFIX = "plugin_service:latest_plugin:"
    REDIS_TTL = 60 * 5  # 5 minutes

    @staticmethod
    def fetch_latest_plugin_version(plugin_ids: Sequence[str]) -> Mapping[str, LatestPluginCache | None]:
        """
        Fetch the latest plugin version
        """
        result: dict[str, PluginService.LatestPluginCache | None] = {}

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
                        status=manifest.status,
                        deprecated_reason=manifest.deprecated_reason,
                        alternative_plugin_id=manifest.alternative_plugin_id,
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
    def _check_marketplace_only_permission():
        """
        Check if the marketplace only permission is enabled
        """
        features = FeatureService.get_system_features()
        if features.plugin_installation_permission.restrict_to_marketplace_only:
            raise PluginInstallationForbiddenError("Plugin installation is restricted to marketplace only")

    @staticmethod
    def _check_plugin_installation_scope(plugin_verification: PluginVerification | None):
        """
        Check the plugin installation scope
        """
        features = FeatureService.get_system_features()

        match features.plugin_installation_permission.plugin_installation_scope:
            case PluginInstallationScope.OFFICIAL_ONLY:
                if (
                    plugin_verification is None
                    or plugin_verification.authorized_category != PluginVerification.AuthorizedCategory.Langgenius
                ):
                    raise PluginInstallationForbiddenError("Plugin installation is restricted to official only")
            case PluginInstallationScope.OFFICIAL_AND_SPECIFIC_PARTNERS:
                if plugin_verification is None or plugin_verification.authorized_category not in [
                    PluginVerification.AuthorizedCategory.Langgenius,
                    PluginVerification.AuthorizedCategory.Partner,
                ]:
                    raise PluginInstallationForbiddenError(
                        "Plugin installation is restricted to official and specific partners"
                    )
            case PluginInstallationScope.NONE:
                raise PluginInstallationForbiddenError("Installing plugins is not allowed")
            case PluginInstallationScope.ALL:
                pass

    @staticmethod
    def get_debugging_key(tenant_id: str) -> str:
        """
        get the debugging key of the tenant
        """
        manager = PluginDebuggingClient()
        return manager.get_debugging_key(tenant_id)

    @staticmethod
    def list_latest_versions(plugin_ids: Sequence[str]) -> Mapping[str, LatestPluginCache | None]:
        """
        List the latest versions of the plugins
        """
        return PluginService.fetch_latest_plugin_version(plugin_ids)

    @staticmethod
    def list(tenant_id: str) -> list[PluginEntity]:
        """
        list all plugins of the tenant
        """
        manager = PluginInstaller()
        plugins = manager.list_plugins(tenant_id)
        return plugins

    @staticmethod
    def list_with_total(tenant_id: str, page: int, page_size: int) -> PluginListResponse:
        """
        list all plugins of the tenant
        """
        manager = PluginInstaller()
        plugins = manager.list_plugins_with_total(tenant_id, page, page_size)
        return plugins

    @staticmethod
    def list_installations_from_ids(tenant_id: str, ids: Sequence[str]) -> Sequence[PluginInstallation]:
        """
        List plugin installations from ids
        """
        manager = PluginInstaller()
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
        manager = PluginInstaller()
        return manager.fetch_plugin_by_identifier(tenant_id, plugin_unique_identifier)

    @staticmethod
    def fetch_plugin_manifest(tenant_id: str, plugin_unique_identifier: str) -> PluginDeclaration:
        """
        Fetch plugin manifest
        """
        manager = PluginInstaller()
        return manager.fetch_plugin_manifest(tenant_id, plugin_unique_identifier)

    @staticmethod
    def is_plugin_verified(tenant_id: str, plugin_unique_identifier: str) -> bool:
        """
        Check if the plugin is verified
        """
        manager = PluginInstaller()
        try:
            return manager.fetch_plugin_manifest(tenant_id, plugin_unique_identifier).verified
        except Exception:
            return False

    @staticmethod
    def fetch_install_tasks(tenant_id: str, page: int, page_size: int) -> Sequence[PluginInstallTask]:
        """
        Fetch plugin installation tasks
        """
        manager = PluginInstaller()
        return manager.fetch_plugin_installation_tasks(tenant_id, page, page_size)

    @staticmethod
    def fetch_install_task(tenant_id: str, task_id: str) -> PluginInstallTask:
        manager = PluginInstaller()
        return manager.fetch_plugin_installation_task(tenant_id, task_id)

    @staticmethod
    def delete_install_task(tenant_id: str, task_id: str) -> bool:
        """
        Delete a plugin installation task
        """
        manager = PluginInstaller()
        return manager.delete_plugin_installation_task(tenant_id, task_id)

    @staticmethod
    def delete_all_install_task_items(
        tenant_id: str,
    ) -> bool:
        """
        Delete all plugin installation task items
        """
        manager = PluginInstaller()
        return manager.delete_all_plugin_installation_task_items(tenant_id)

    @staticmethod
    def delete_install_task_item(tenant_id: str, task_id: str, identifier: str) -> bool:
        """
        Delete a plugin installation task item
        """
        manager = PluginInstaller()
        return manager.delete_plugin_installation_task_item(tenant_id, task_id, identifier)

    @staticmethod
    def upgrade_plugin_with_marketplace(
        tenant_id: str, original_plugin_unique_identifier: str, new_plugin_unique_identifier: str
    ):
        """
        Upgrade plugin with marketplace
        """
        if not dify_config.MARKETPLACE_ENABLED:
            raise ValueError("marketplace is not enabled")

        if original_plugin_unique_identifier == new_plugin_unique_identifier:
            raise ValueError("you should not upgrade plugin with the same plugin")

        # check if plugin pkg is already downloaded
        manager = PluginInstaller()

        features = FeatureService.get_system_features()

        try:
            manager.fetch_plugin_manifest(tenant_id, new_plugin_unique_identifier)
            # already downloaded, skip, and record install event
            marketplace.record_install_plugin_event(new_plugin_unique_identifier)
        except Exception:
            # plugin not installed, download and upload pkg
            pkg = download_plugin_pkg(new_plugin_unique_identifier)
            response = manager.upload_pkg(
                tenant_id,
                pkg,
                verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only,
            )

            # check if the plugin is available to install
            PluginService._check_plugin_installation_scope(response.verification)

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
        PluginService._check_marketplace_only_permission()
        manager = PluginInstaller()
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
    def upload_pkg(tenant_id: str, pkg: bytes, verify_signature: bool = False) -> PluginDecodeResponse:
        """
        Upload plugin package files

        returns: plugin_unique_identifier
        """
        PluginService._check_marketplace_only_permission()
        manager = PluginInstaller()
        features = FeatureService.get_system_features()
        response = manager.upload_pkg(
            tenant_id,
            pkg,
            verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only,
        )
        PluginService._check_plugin_installation_scope(response.verification)

        return response

    @staticmethod
    def upload_pkg_from_github(
        tenant_id: str, repo: str, version: str, package: str, verify_signature: bool = False
    ) -> PluginDecodeResponse:
        """
        Install plugin from github release package files,
        returns plugin_unique_identifier
        """
        PluginService._check_marketplace_only_permission()
        pkg = download_with_size_limit(
            f"https://github.com/{repo}/releases/download/{version}/{package}", dify_config.PLUGIN_MAX_PACKAGE_SIZE
        )
        features = FeatureService.get_system_features()

        manager = PluginInstaller()
        response = manager.upload_pkg(
            tenant_id,
            pkg,
            verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only,
        )
        PluginService._check_plugin_installation_scope(response.verification)

        return response

    @staticmethod
    def upload_bundle(
        tenant_id: str, bundle: bytes, verify_signature: bool = False
    ) -> Sequence[PluginBundleDependency]:
        """
        Upload a plugin bundle and return the dependencies.
        """
        manager = PluginInstaller()
        PluginService._check_marketplace_only_permission()
        return manager.upload_bundle(tenant_id, bundle, verify_signature)

    @staticmethod
    def install_from_local_pkg(tenant_id: str, plugin_unique_identifiers: Sequence[str]):
        PluginService._check_marketplace_only_permission()

        manager = PluginInstaller()

        for plugin_unique_identifier in plugin_unique_identifiers:
            resp = manager.decode_plugin_from_identifier(tenant_id, plugin_unique_identifier)
            PluginService._check_plugin_installation_scope(resp.verification)

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
        PluginService._check_marketplace_only_permission()

        manager = PluginInstaller()
        plugin_decode_response = manager.decode_plugin_from_identifier(tenant_id, plugin_unique_identifier)
        PluginService._check_plugin_installation_scope(plugin_decode_response.verification)

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
    def fetch_marketplace_pkg(tenant_id: str, plugin_unique_identifier: str) -> PluginDeclaration:
        """
        Fetch marketplace package
        """
        if not dify_config.MARKETPLACE_ENABLED:
            raise ValueError("marketplace is not enabled")

        features = FeatureService.get_system_features()

        manager = PluginInstaller()
        try:
            declaration = manager.fetch_plugin_manifest(tenant_id, plugin_unique_identifier)
        except Exception:
            pkg = download_plugin_pkg(plugin_unique_identifier)
            response = manager.upload_pkg(
                tenant_id,
                pkg,
                verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only,
            )
            # check if the plugin is available to install
            PluginService._check_plugin_installation_scope(response.verification)
            declaration = response.manifest

        return declaration

    @staticmethod
    def install_from_marketplace_pkg(tenant_id: str, plugin_unique_identifiers: Sequence[str]):
        """
        Install plugin from marketplace package files,
        returns installation task id
        """
        if not dify_config.MARKETPLACE_ENABLED:
            raise ValueError("marketplace is not enabled")

        manager = PluginInstaller()

        # collect actual plugin_unique_identifiers
        actual_plugin_unique_identifiers = []
        metas = []
        features = FeatureService.get_system_features()

        # check if already downloaded
        for plugin_unique_identifier in plugin_unique_identifiers:
            try:
                manager.fetch_plugin_manifest(tenant_id, plugin_unique_identifier)
                plugin_decode_response = manager.decode_plugin_from_identifier(tenant_id, plugin_unique_identifier)
                # check if the plugin is available to install
                PluginService._check_plugin_installation_scope(plugin_decode_response.verification)
                # already downloaded, skip
                actual_plugin_unique_identifiers.append(plugin_unique_identifier)
                metas.append({"plugin_unique_identifier": plugin_unique_identifier})
            except Exception:
                # plugin not installed, download and upload pkg
                pkg = download_plugin_pkg(plugin_unique_identifier)
                response = manager.upload_pkg(
                    tenant_id,
                    pkg,
                    verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only,
                )
                # check if the plugin is available to install
                PluginService._check_plugin_installation_scope(response.verification)
                # use response plugin_unique_identifier
                actual_plugin_unique_identifiers.append(response.unique_identifier)
                metas.append({"plugin_unique_identifier": response.unique_identifier})

        return manager.install_from_identifiers(
            tenant_id,
            actual_plugin_unique_identifiers,
            PluginInstallationSource.Marketplace,
            metas,
        )

    @staticmethod
    def uninstall(tenant_id: str, plugin_installation_id: str) -> bool:
        manager = PluginInstaller()
        return manager.uninstall(tenant_id, plugin_installation_id)

    @staticmethod
    def check_tools_existence(tenant_id: str, provider_ids: Sequence[GenericProviderID]) -> Sequence[bool]:
        """
        Check if the tools exist
        """
        manager = PluginInstaller()
        return manager.check_tools_existence(tenant_id, provider_ids)
