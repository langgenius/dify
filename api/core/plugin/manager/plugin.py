import json
from collections.abc import Generator, Mapping
from typing import Any

from core.plugin.entities.plugin import PluginEntity, PluginInstallationSource
from core.plugin.entities.plugin_daemon import InstallPluginMessage
from core.plugin.manager.base import BasePluginManager


class PluginInstallationManager(BasePluginManager):
    def fetch_plugin_by_identifier(self, tenant_id: str, identifier: str) -> bool:
        # urlencode the identifier

        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/fetch/identifier",
            bool,
            params={"plugin_unique_identifier": identifier},
        )

    def list_plugins(self, tenant_id: str) -> list[PluginEntity]:
        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/list",
            list[PluginEntity],
            params={"page": 1, "page_size": 256},
        )

    def install_from_pkg(
        self,
        tenant_id: str,
        pkg: bytes,
        source: PluginInstallationSource,
        meta: Mapping[str, Any],
        verify_signature: bool = False,
    ) -> Generator[InstallPluginMessage, None, None]:
        """
        Install a plugin from a package.
        """
        # using multipart/form-data to encode body
        body = {
            "dify_pkg": ("dify_pkg", pkg, "application/octet-stream"),
        }

        data = {
            "verify_signature": "true" if verify_signature else "false",
            "source": source.value,
            "meta": json.dumps(meta),
        }

        return self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/management/install/pkg",
            InstallPluginMessage,
            files=body,
            data=data,
        )

    def install_from_identifier(self, tenant_id: str, identifier: str) -> bool:
        """
        Install a plugin from an identifier.
        """
        # exception will be raised if the request failed
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/install/identifier",
            bool,
            data={
                "plugin_unique_identifier": identifier,
            },
            headers={"Content-Type": "application/json"},
        )

    def uninstall(self, tenant_id: str, plugin_installation_id: str) -> bool:
        """
        Uninstall a plugin.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/uninstall",
            bool,
            data={
                "plugin_installation_id": plugin_installation_id,
            },
            headers={"Content-Type": "application/json"},
        )
