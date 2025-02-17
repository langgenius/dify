from collections.abc import Sequence

from core.plugin.entities.bundle import PluginBundleDependency
from core.plugin.entities.plugin import (
    GenericProviderID,
    MissingPluginDependency,
    PluginDeclaration,
    PluginEntity,
    PluginInstallation,
    PluginInstallationSource,
)
from core.plugin.entities.plugin_daemon import PluginInstallTask, PluginInstallTaskStartResponse, PluginUploadResponse
from core.plugin.manager.base import BasePluginManager


class PluginInstallationManager(BasePluginManager):
    def fetch_plugin_by_identifier(
        self,
        tenant_id: str,
        identifier: str,
    ) -> bool:
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

    def upload_pkg(
        self,
        tenant_id: str,
        pkg: bytes,
        verify_signature: bool = False,
    ) -> PluginUploadResponse:
        """
        Upload a plugin package and return the plugin unique identifier.
        """
        body = {
            "dify_pkg": ("dify_pkg", pkg, "application/octet-stream"),
        }

        data = {
            "verify_signature": "true" if verify_signature else "false",
        }

        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/install/upload/package",
            PluginUploadResponse,
            files=body,
            data=data,
        )

    def upload_bundle(
        self,
        tenant_id: str,
        bundle: bytes,
        verify_signature: bool = False,
    ) -> Sequence[PluginBundleDependency]:
        """
        Upload a plugin bundle and return the dependencies.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/install/upload/bundle",
            list[PluginBundleDependency],
            files={"dify_bundle": ("dify_bundle", bundle, "application/octet-stream")},
            data={"verify_signature": "true" if verify_signature else "false"},
        )

    def install_from_identifiers(
        self,
        tenant_id: str,
        identifiers: Sequence[str],
        source: PluginInstallationSource,
        metas: list[dict],
    ) -> PluginInstallTaskStartResponse:
        """
        Install a plugin from an identifier.
        """
        # exception will be raised if the request failed
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/install/identifiers",
            PluginInstallTaskStartResponse,
            data={
                "plugin_unique_identifiers": identifiers,
                "source": source,
                "metas": metas,
            },
            headers={"Content-Type": "application/json"},
        )

    def fetch_plugin_installation_tasks(self, tenant_id: str, page: int, page_size: int) -> Sequence[PluginInstallTask]:
        """
        Fetch plugin installation tasks.
        """
        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/install/tasks",
            list[PluginInstallTask],
            params={"page": page, "page_size": page_size},
        )

    def fetch_plugin_installation_task(self, tenant_id: str, task_id: str) -> PluginInstallTask:
        """
        Fetch a plugin installation task.
        """
        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/install/tasks/{task_id}",
            PluginInstallTask,
        )

    def delete_plugin_installation_task(self, tenant_id: str, task_id: str) -> bool:
        """
        Delete a plugin installation task.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/install/tasks/{task_id}/delete",
            bool,
        )

    def delete_all_plugin_installation_task_items(self, tenant_id: str) -> bool:
        """
        Delete all plugin installation task items.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/install/tasks/delete_all",
            bool,
        )

    def delete_plugin_installation_task_item(self, tenant_id: str, task_id: str, identifier: str) -> bool:
        """
        Delete a plugin installation task item.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/install/tasks/{task_id}/delete/{identifier}",
            bool,
        )

    def fetch_plugin_manifest(self, tenant_id: str, plugin_unique_identifier: str) -> PluginDeclaration:
        """
        Fetch a plugin manifest.
        """

        return self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/fetch/manifest",
            PluginDeclaration,
            params={"plugin_unique_identifier": plugin_unique_identifier},
        )

    def fetch_plugin_installation_by_ids(
        self, tenant_id: str, plugin_ids: Sequence[str]
    ) -> Sequence[PluginInstallation]:
        """
        Fetch plugin installations by ids.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/installation/fetch/batch",
            list[PluginInstallation],
            data={"plugin_ids": plugin_ids},
            headers={"Content-Type": "application/json"},
        )

    def fetch_missing_dependencies(
        self, tenant_id: str, plugin_unique_identifiers: list[str]
    ) -> list[MissingPluginDependency]:
        """
        Fetch missing dependencies
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/installation/missing",
            list[MissingPluginDependency],
            data={"plugin_unique_identifiers": plugin_unique_identifiers},
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

    def upgrade_plugin(
        self,
        tenant_id: str,
        original_plugin_unique_identifier: str,
        new_plugin_unique_identifier: str,
        source: PluginInstallationSource,
        meta: dict,
    ) -> PluginInstallTaskStartResponse:
        """
        Upgrade a plugin.
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/install/upgrade",
            PluginInstallTaskStartResponse,
            data={
                "original_plugin_unique_identifier": original_plugin_unique_identifier,
                "new_plugin_unique_identifier": new_plugin_unique_identifier,
                "source": source,
                "meta": meta,
            },
            headers={"Content-Type": "application/json"},
        )

    def check_tools_existence(self, tenant_id: str, provider_ids: Sequence[GenericProviderID]) -> Sequence[bool]:
        """
        Check if the tools exist
        """
        return self._request_with_plugin_daemon_response(
            "POST",
            f"plugin/{tenant_id}/management/tools/check_existence",
            list[bool],
            data={
                "provider_ids": [
                    {
                        "plugin_id": provider_id.plugin_id,
                        "provider_name": provider_id.provider_name,
                    }
                    for provider_id in provider_ids
                ]
            },
            headers={"Content-Type": "application/json"},
        )
