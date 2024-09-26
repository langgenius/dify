from collections.abc import Generator

from core.plugin.entities.plugin import PluginEntity
from core.plugin.entities.plugin_daemon import InstallPluginMessage
from core.plugin.manager.base import BasePluginManager


class PluginInstallationManager(BasePluginManager):
    def fetch_plugin_by_identifier(self, tenant_id: str, identifier: str) -> bool:
        # urlencode the identifier

        return self._request_with_plugin_daemon_response(
            "GET", f"plugin/{tenant_id}/fetch/identifier", bool, params={"plugin_unique_identifier": identifier}
        )

    def list_plugins(self, tenant_id: str) -> list[PluginEntity]:
        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/list",
            list[PluginEntity],
            params={"page": 1, "page_size": 256},
        )

    def install_from_pkg(self, tenant_id: str, pkg: bytes) -> Generator[InstallPluginMessage, None, None]:
        """
        Install a plugin from a package.
        """
        # using multipart/form-data to encode body
        body = {"dify_pkg": ("dify_pkg", pkg, "application/octet-stream")}

        return self._request_with_plugin_daemon_response_stream(
            "POST", f"plugin/{tenant_id}/install/pkg", InstallPluginMessage, data=body
        )

    def install_from_identifier(self, tenant_id: str, identifier: str) -> bool:
        """
        Install a plugin from an identifier.
        """
        # exception will be raised if the request failed
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/install/identifier",
            bool,
            params={
                "plugin_unique_identifier": identifier,
            },
            data={
                "plugin_unique_identifier": identifier,
            },
        )

    def uninstall(self, tenant_id: str, identifier: str) -> bool:
        """
        Uninstall a plugin.
        """
        return self._request_with_plugin_daemon_response(
            "DELETE", f"plugin/{tenant_id}/uninstall", bool, params={"plugin_unique_identifier": identifier}
        )
