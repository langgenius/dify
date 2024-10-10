from collections.abc import Generator
from mimetypes import guess_type

from core.helper.download import download_with_size_limit
from core.plugin.entities.plugin import PluginEntity, PluginInstallationSource
from core.plugin.entities.plugin_daemon import InstallPluginMessage, PluginDaemonInnerError
from core.plugin.manager.asset import PluginAssetManager
from core.plugin.manager.debugging import PluginDebuggingManager
from core.plugin.manager.plugin import PluginInstallationManager


class PluginService:
    @staticmethod
    def get_debugging_key(tenant_id: str) -> str:
        manager = PluginDebuggingManager()
        return manager.get_debugging_key(tenant_id)

    @staticmethod
    def list(tenant_id: str) -> list[PluginEntity]:
        manager = PluginInstallationManager()
        return manager.list_plugins(tenant_id)

    @staticmethod
    def get_asset(tenant_id: str, asset_file: str) -> tuple[bytes, str]:
        manager = PluginAssetManager()
        # guess mime type
        mime_type, _ = guess_type(asset_file)
        return manager.fetch_asset(tenant_id, asset_file), mime_type or "application/octet-stream"

    @staticmethod
    def check_plugin_unique_identifier(tenant_id: str, plugin_unique_identifier: str) -> bool:
        manager = PluginInstallationManager()
        return manager.fetch_plugin_by_identifier(tenant_id, plugin_unique_identifier)

    @staticmethod
    def install_from_unique_identifier(tenant_id: str, plugin_unique_identifier: str) -> bool:
        manager = PluginInstallationManager()
        return manager.install_from_identifier(tenant_id, plugin_unique_identifier)

    @staticmethod
    def install_from_local_pkg(tenant_id: str, pkg: bytes) -> Generator[InstallPluginMessage, None, None]:
        """
        Install plugin from uploaded package files
        """
        manager = PluginInstallationManager()
        try:
            yield from manager.install_from_pkg(tenant_id, pkg, PluginInstallationSource.Package, {})
        except PluginDaemonInnerError as e:
            yield InstallPluginMessage(event=InstallPluginMessage.Event.Error, data=str(e.message))

    @staticmethod
    def install_from_github_pkg(
        tenant_id: str, repo: str, version: str, package: str
    ) -> Generator[InstallPluginMessage, None, None]:
        """
        Install plugin from github release package files
        """
        pkg = download_with_size_limit(
            f"https://github.com/{repo}/releases/download/{version}/{package}", 15 * 1024 * 1024
        )

        manager = PluginInstallationManager()
        try:
            yield from manager.install_from_pkg(
                tenant_id,
                pkg,
                PluginInstallationSource.Github,
                {
                    "repo": repo,
                    "version": version,
                    "package": package,
                },
            )
        except PluginDaemonInnerError as e:
            yield InstallPluginMessage(event=InstallPluginMessage.Event.Error, data=str(e.message))

    @staticmethod
    def install_from_marketplace_pkg(
        tenant_id: str, plugin_unique_identifier: str
    ) -> Generator[InstallPluginMessage, None, None]:
        """
        TODO: wait for marketplace api
        """
        manager = PluginInstallationManager()

        pkg = b""

        try:
            yield from manager.install_from_pkg(
                tenant_id,
                pkg,
                PluginInstallationSource.Marketplace,
                {
                    "plugin_unique_identifier": plugin_unique_identifier,
                },
            )
        except PluginDaemonInnerError as e:
            yield InstallPluginMessage(event=InstallPluginMessage.Event.Error, data=str(e.message))

    @staticmethod
    def uninstall(tenant_id: str, plugin_installation_id: str) -> bool:
        manager = PluginInstallationManager()
        return manager.uninstall(tenant_id, plugin_installation_id)
