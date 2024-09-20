from collections.abc import Generator
from urllib.parse import quote

from core.plugin.entities.plugin_daemon import InstallPluginMessage
from core.plugin.manager.base import BasePluginManager


class PluginInstallationManager(BasePluginManager):
    def fetch_plugin_by_identifier(self, tenant_id: str, identifier: str) -> bool:
        # urlencode the identifier

        identifier = quote(identifier)
        return self._request_with_plugin_daemon_response(
            "GET", f"/plugin/{tenant_id}/fetch/identifier?plugin_unique_identifier={identifier}", bool
        )

    def install_from_pkg(self, tenant_id: str, pkg: bytes) -> Generator[InstallPluginMessage, None, None]:
        """
        Install a plugin from a package.
        """
        # using multipart/form-data to encode body
        body = {"dify_pkg": ("dify_pkg", pkg, "application/octet-stream")}

        return self._request_with_plugin_daemon_response_stream(
            "POST", f"/plugin/{tenant_id}/install/pkg", InstallPluginMessage, data=body
        )

    def install_from_identifier(self, tenant_id: str, identifier: str) -> bool:
        """
        Install a plugin from an identifier.
        """
        identifier = quote(identifier)
        # exception will be raised if the request failed
        self._request_with_plugin_daemon_response(
            "POST",
            f"/plugin/{tenant_id}/install/identifier",
            dict,
            headers={
                "Content-Type": "application/json",
            },
            data={
                "plugin_unique_identifier": identifier,
            },
        )

        return True
