from collections.abc import Generator
from mimetypes import guess_type

from core.plugin.entities.plugin import PluginEntity
from core.plugin.entities.plugin_daemon import InstallPluginMessage, PluginDaemonInnerError
from core.plugin.manager.asset import PluginAssetManager
from core.plugin.manager.debugging import PluginDebuggingManager
from core.plugin.manager.plugin import PluginInstallationManager


class PluginService:
    @staticmethod
    def get_plugin_debugging_key(tenant_id: str) -> str:
        manager = PluginDebuggingManager()
        return manager.get_debugging_key(tenant_id)

    @staticmethod
    def list_plugins(tenant_id: str) -> list[PluginEntity]:
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
    def install_plugin_from_unique_identifier(tenant_id: str, plugin_unique_identifier: str) -> bool:
        manager = PluginInstallationManager()
        return manager.install_from_identifier(tenant_id, plugin_unique_identifier)

    @staticmethod
    def install_plugin_from_pkg(tenant_id: str, pkg: bytes) -> Generator[InstallPluginMessage, None, None]:
        manager = PluginInstallationManager()
        try:
            yield from manager.install_from_pkg(tenant_id, pkg)
        except PluginDaemonInnerError as e:
            yield InstallPluginMessage(event=InstallPluginMessage.Event.Error, data=str(e.message))
