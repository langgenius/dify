import logging
from collections.abc import Mapping, Sequence
from mimetypes import guess_type

from packaging.version import InvalidVersion, Version
from pydantic import BaseModel
from yarl import URL

from configs import dify_config
from core.helper import marketplace
from core.helper.download import download_with_size_limit
from core.helper.marketplace import download_plugin_pkg
from core.helper.ssrf_proxy import get as ssrf_get
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
    class GithubReleaseAsset(BaseModel):
        name: str
        browser_download_url: str

    class GithubRelease(BaseModel):
        tag_name: str
        prerelease: bool = False
        assets: list["PluginService.GithubReleaseAsset"] = []

    class LatestPluginCache(BaseModel):
        plugin_id: str
        version: str
        unique_identifier: str
        status: str
        deprecated_reason: str
        alternative_plugin_id: str

    REDIS_KEY_PREFIX = "plugin_service:latest_plugin:"
    REDIS_TTL = 60 * 5  # 5 minutes
    GITHUB_RELEASE_CACHE_PREFIX = "plugin_service:github_latest_release:"
    GITHUB_RELEASE_TTL = 60 * 5  # 5 minutes
    GITHUB_RELEASE_SYNC_TAG_PREFIX = "plugin_service:github_latest_release_synced_tag:"

    @staticmethod
    def _is_github_repo_allowlisted_for_signature_bypass(repo: str) -> bool:
        """
        Repo format: "Owner/Repo"
        Allowlist supports:
        - "Owner"
        - "Owner/*"
        - "Owner/Repo"
        """
        if not dify_config.PLUGIN_GITHUB_SIGNATURE_BYPASS_ENABLED:
            return False

        repo_norm = repo.strip().lower()
        if not repo_norm:
            return False

        owner = repo_norm.split("/", 1)[0]

        for item in dify_config.PLUGIN_GITHUB_SIGNATURE_BYPASS_REPOS:
            rule = item.strip().lower()
            if not rule:
                continue

            if "/" not in rule:
                if owner == rule:
                    return True
                continue

            if rule.endswith("/*"):
                if owner == rule[:-2]:
                    return True
                continue

            if repo_norm == rule:
                return True

        return False

    @staticmethod
    def _should_verify_signature_for_github_repo(repo: str) -> bool:
        if not dify_config.PLUGIN_GITHUB_SIGNATURE_BYPASS_ENABLED:
            return False
        return not PluginService._is_github_repo_allowlisted_for_signature_bypass(repo)

    @staticmethod
    def _is_supported_github_release(release: "PluginService.GithubRelease") -> bool:
        return (not release.prerelease) and ("-dev" not in release.tag_name)

    @staticmethod
    def _upload_pkg_bytes_and_check(
        *,
        manager: PluginInstaller,
        tenant_id: str,
        pkg: bytes,
        verify_signature: bool,
    ) -> PluginDecodeResponse:
        features = FeatureService.get_system_features()
        response = manager.upload_pkg(
            tenant_id,
            pkg,
            verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only or verify_signature,
        )
        PluginService._check_plugin_installation_scope(response.verification)
        return response

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
    def fetch_latest_github_release(repo: str) -> "PluginService.GithubRelease":
        """
        Fetch latest (non-prerelease) GitHub release metadata.
        """
        repo = repo.strip()
        if not repo:
            raise ValueError("repo is required")

        cache_key = f"{PluginService.GITHUB_RELEASE_CACHE_PREFIX}{repo.lower()}"
        cached = redis_client.get(cache_key)
        if cached:
            logger.info("GitHub latest release cache hit. repo=%s", repo)
            return PluginService.GithubRelease.model_validate_json(cached)

        logger.info("Fetching GitHub latest release metadata. repo=%s", repo)
        url = f"https://api.github.com/repos/{repo}/releases/latest"
        resp = ssrf_get(
            url,
            follow_redirects=True,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": "Dify",
            },
        )
        resp.raise_for_status()
        release = PluginService.GithubRelease.model_validate(resp.json())

        logger.info(
            "Fetched GitHub latest release metadata. repo=%s tag=%s prerelease=%s assets=%s",
            repo,
            release.tag_name,
            release.prerelease,
            len(release.assets),
        )
        redis_client.setex(cache_key, PluginService.GITHUB_RELEASE_TTL, release.model_dump_json())
        return release

    @staticmethod
    def _upload_pkgs_from_github_release_assets(
        *, tenant_id: str, repo: str, release: "PluginService.GithubRelease"
    ) -> list[PluginDecodeResponse]:
        """
        Download and upload all .difypkg assets from a supported GitHub release.
        """
        verify_signature = PluginService._should_verify_signature_for_github_repo(repo)

        manager = PluginInstaller()
        decoded_list: list[PluginDecodeResponse] = []
        logger.info(
            "Uploading GitHub release .difypkg assets. tenant_id=%s repo=%s tag=%s verify_signature=%s",
            tenant_id,
            repo,
            release.tag_name,
            verify_signature,
        )
        for asset in release.assets:
            if not asset.name.endswith(".difypkg"):
                continue

            logger.info(
                "Downloading GitHub release asset. tenant_id=%s repo=%s tag=%s asset=%s",
                tenant_id,
                repo,
                release.tag_name,
                asset.name,
            )
            pkg = download_with_size_limit(asset.browser_download_url, dify_config.PLUGIN_MAX_PACKAGE_SIZE)
            response = PluginService._upload_pkg_bytes_and_check(
                manager=manager,
                tenant_id=tenant_id,
                pkg=pkg,
                verify_signature=verify_signature,
            )
            decoded_list.append(response)
            logger.info(
                "Uploaded GitHub release asset. tenant_id=%s repo=%s tag=%s asset=%s identifier=%s",
                tenant_id,
                repo,
                release.tag_name,
                asset.name,
                response.unique_identifier,
            )

        logger.info(
            "Uploaded GitHub release assets done. tenant_id=%s repo=%s tag=%s plugins=%s",
            tenant_id,
            repo,
            release.tag_name,
            len(decoded_list),
        )
        return decoded_list

    @staticmethod
    def should_install_decoded_plugin(*, installed: Sequence[PluginEntity], decoded: PluginDecodeResponse) -> bool:
        """
        Return True if the decoded plugin should be installed/upgraded.
        """
        installed_identifiers = {p.plugin_unique_identifier for p in installed}
        if decoded.unique_identifier in installed_identifiers:
            return False

        target_author = decoded.manifest.author
        target_name = decoded.manifest.name
        target_version = decoded.manifest.version

        for p in installed:
            if p.declaration.author != target_author or p.declaration.name != target_name:
                continue
            try:
                if Version(p.version) >= Version(target_version):
                    return False
            except InvalidVersion:
                if p.version == target_version:
                    return False

        return True

    @staticmethod
    def sync_latest_release_plugins_for_tenant(*, tenant_id: str, repo: str) -> int:
        """
        Sync repo latest (non-prerelease) release plugins to the tenant, best-effort.
        Only runs when a new release tag is detected (or previous sync failed).
        """
        PluginService._check_marketplace_only_permission()

        repo = repo.strip()
        if not repo:
            logger.info("GitHub latest release sync: repo empty, skip. tenant_id=%s", tenant_id)
            return 0

        release = PluginService.fetch_latest_github_release(repo)
        if not PluginService._is_supported_github_release(release):
            logger.info(
                "Skip GitHub latest release sync (prerelease/dev). tenant_id=%s repo=%s tag=%s",
                tenant_id,
                repo,
                release.tag_name,
            )
            return 0

        tag_key = f"{PluginService.GITHUB_RELEASE_SYNC_TAG_PREFIX}{tenant_id}:{repo.lower()}"
        sync_ttl_s = 60 * 10
        last_tag = redis_client.get(tag_key)
        if last_tag and last_tag.decode("utf-8") == release.tag_name:
            logger.info(
                "Skip GitHub latest release sync (already synced). tenant_id=%s repo=%s tag=%s",
                tenant_id,
                repo,
                release.tag_name,
            )
            return 0
        logger.info(
            "GitHub latest release sync: new tag detected. tenant_id=%s repo=%s last_tag=%s new_tag=%s",
            tenant_id,
            repo,
            last_tag.decode("utf-8") if last_tag else None,
            release.tag_name,
        )

        manager = PluginInstaller()
        try:
            installed = manager.list_plugins(tenant_id)
        except Exception:
            logger.exception("Failed to list installed plugins for sync. tenant_id=%s repo=%s", tenant_id, repo)
            installed = []

        decoded_list = PluginService._upload_pkgs_from_github_release_assets(
            tenant_id=tenant_id,
            repo=repo,
            release=release,
        )
        if not decoded_list:
            logger.info(
                "GitHub latest release sync: no difypkg assets uploaded, skip. tenant_id=%s repo=%s tag=%s",
                tenant_id,
                repo,
                release.tag_name,
            )
            return 0

        to_install = [
            d.unique_identifier
            for d in decoded_list
            if PluginService.should_install_decoded_plugin(installed=installed, decoded=d)
        ]
        if not to_install:
            logger.info(
                "GitHub latest release sync: nothing to install. tenant_id=%s repo=%s tag=%s",
                tenant_id,
                repo,
                release.tag_name,
            )
            redis_client.setex(tag_key, sync_ttl_s, release.tag_name)
            return 0

        logger.info(
            "GitHub latest release sync: installing. tenant_id=%s repo=%s tag=%s count=%s",
            tenant_id,
            repo,
            release.tag_name,
            len(to_install),
        )
        PluginService.install_from_local_pkg(tenant_id, to_install)
        redis_client.setex(tag_key, sync_ttl_s, release.tag_name)
        return len(to_install)

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

    @classmethod
    def get_plugin_icon_url(cls, tenant_id: str, filename: str) -> str:
        url_prefix = (
            URL(dify_config.CONSOLE_API_URL or "/") / "console" / "api" / "workspaces" / "current" / "plugin" / "icon"
        )
        return str(url_prefix % {"tenant_id": tenant_id, "filename": filename})

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
    def extract_asset(tenant_id: str, plugin_unique_identifier: str, file_name: str) -> bytes:
        manager = PluginAssetManager()
        return manager.extract_asset(tenant_id, plugin_unique_identifier, file_name)

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
        verify_signature = verify_signature or PluginService._should_verify_signature_for_github_repo(repo)

        manager = PluginInstaller()
        response = manager.upload_pkg(
            tenant_id,
            pkg,
            verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only or verify_signature,
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

        if dify_config.PLUGIN_GITHUB_SIGNATURE_BYPASS_ENABLED:
            return manager.install_from_identifiers(
                tenant_id,
                [plugin_unique_identifier],
                PluginInstallationSource.Package,
                [{}],
            )

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

    @staticmethod
    def fetch_plugin_readme(tenant_id: str, plugin_unique_identifier: str, language: str) -> str:
        """
        Fetch plugin readme
        """
        manager = PluginInstaller()
        return manager.fetch_plugin_readme(tenant_id, plugin_unique_identifier, language)
