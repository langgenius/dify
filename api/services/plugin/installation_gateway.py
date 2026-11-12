"""Legacy daemon mechanics behind the admitted plugin installation use case.

These five operations preserve existing download, signature/source-policy and
cache invalidation behavior. Application admission runs before this adapter;
there is deliberately no Kernel-to-application composition-root backedge.
"""

from collections.abc import Sequence

from configs import dify_config
from core.helper import marketplace
from core.helper.marketplace import download_plugin_pkg
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginInstallTaskStartResponse
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.plugin_service import PluginService
from services.plugin.installation_service import PluginInstallationOperation, PluginInstallationResult


def _result(value: PluginInstallTaskStartResponse) -> PluginInstallationResult:
    return PluginInstallationResult(
        all_installed=value.all_installed,
        task_id=value.task_id,
        task=value.task.model_dump(mode="json") if value.task is not None else None,
    )


class LegacyPluginInstallationGateway:
    @staticmethod
    def assert_available(
        operation: PluginInstallationOperation, original_uid: str | None, candidate_uid: str | None
    ) -> None:
        if operation in {"marketplace", "upgrade_marketplace"}:
            if not dify_config.MARKETPLACE_ENABLED:
                raise ValueError("marketplace is not enabled")
            if operation == "upgrade_marketplace" and original_uid == candidate_uid:
                raise ValueError("you should not upgrade plugin with the same plugin")
            PluginService._get_plugin_installation_permission()
        else:
            PluginService._check_marketplace_only_permission()

    @staticmethod
    def upgrade_plugin_with_marketplace(
        tenant_id: str, original_plugin_unique_identifier: str, new_plugin_unique_identifier: str
    ) -> PluginInstallationResult:
        """
        Upgrade plugin with marketplace
        """
        if not dify_config.MARKETPLACE_ENABLED:
            raise ValueError("marketplace is not enabled")

        if original_plugin_unique_identifier == new_plugin_unique_identifier:
            raise ValueError("you should not upgrade plugin with the same plugin")

        # check if plugin pkg is already downloaded
        manager = PluginInstaller()

        permission = PluginService._get_plugin_installation_permission()

        try:
            manager.fetch_plugin_manifest(tenant_id, new_plugin_unique_identifier)
        except Exception:
            # plugin not downloaded yet, download and upload pkg
            pkg = download_plugin_pkg(new_plugin_unique_identifier)
            response = manager.upload_pkg(
                tenant_id,
                pkg,
                verify_signature=permission.restrict_to_marketplace_only,
            )

            # check if the plugin is available to install
            PluginService._check_plugin_installation_scope(response.verification)
        else:
            # already downloaded, the cached pkg still has to satisfy the installation scope
            decode_response = manager.decode_plugin_from_identifier(tenant_id, new_plugin_unique_identifier)
            PluginService._check_plugin_installation_scope(decode_response.verification)
            marketplace.record_install_plugin_event(new_plugin_unique_identifier)

        result = manager.upgrade_plugin(
            tenant_id,
            original_plugin_unique_identifier,
            new_plugin_unique_identifier,
            PluginInstallationSource.Marketplace,
            {
                "plugin_unique_identifier": new_plugin_unique_identifier,
            },
        )
        PluginService.invalidate_plugin_model_providers_cache(tenant_id)
        return _result(result)

    @staticmethod
    def upgrade_plugin_with_github(
        tenant_id: str,
        original_plugin_unique_identifier: str,
        new_plugin_unique_identifier: str,
        repo: str,
        version: str,
        package: str,
    ) -> PluginInstallationResult:
        """
        Upgrade plugin with github
        """
        PluginService._check_marketplace_only_permission()
        manager = PluginInstaller()
        result = manager.upgrade_plugin(
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
        PluginService.invalidate_plugin_model_providers_cache(tenant_id)
        return _result(result)

    @staticmethod
    def install_from_local_pkg(tenant_id: str, plugin_unique_identifiers: Sequence[str]) -> PluginInstallationResult:
        PluginService._check_marketplace_only_permission()

        manager = PluginInstaller()

        for plugin_unique_identifier in plugin_unique_identifiers:
            resp = manager.decode_plugin_from_identifier(tenant_id, plugin_unique_identifier)
            PluginService._check_plugin_installation_scope(resp.verification)

        result = manager.install_from_identifiers(
            tenant_id,
            plugin_unique_identifiers,
            PluginInstallationSource.Package,
            [
                {"plugin_unique_identifier": plugin_unique_identifier}
                for plugin_unique_identifier in plugin_unique_identifiers
            ],
        )
        PluginService.invalidate_plugin_model_providers_cache(tenant_id)
        return _result(result)

    @staticmethod
    def install_from_github(
        tenant_id: str, plugin_unique_identifier: str, repo: str, version: str, package: str
    ) -> PluginInstallationResult:
        """
        Install plugin from github release package files,
        returns plugin_unique_identifier
        """
        PluginService._check_marketplace_only_permission()

        manager = PluginInstaller()
        plugin_decode_response = manager.decode_plugin_from_identifier(tenant_id, plugin_unique_identifier)
        PluginService._check_plugin_installation_scope(plugin_decode_response.verification)

        result = manager.install_from_identifiers(
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
        PluginService.invalidate_plugin_model_providers_cache(tenant_id)
        return _result(result)

    @staticmethod
    def install_from_marketplace_pkg(
        tenant_id: str, plugin_unique_identifiers: Sequence[str]
    ) -> PluginInstallationResult:
        """
        Install plugin from marketplace package files,
        returns installation task id
        """
        if not dify_config.MARKETPLACE_ENABLED:
            raise ValueError("marketplace is not enabled")

        manager = PluginInstaller()

        # Install only the exact identifiers admitted by the application owner.
        actual_plugin_unique_identifiers = []
        metas = []
        permission = PluginService._get_plugin_installation_permission()

        # check if already downloaded
        for plugin_unique_identifier in plugin_unique_identifiers:
            try:
                manager.fetch_plugin_manifest(tenant_id, plugin_unique_identifier)
            except Exception:
                # plugin not downloaded yet, download and upload pkg
                pkg = download_plugin_pkg(plugin_unique_identifier)
                response = manager.upload_pkg(
                    tenant_id,
                    pkg,
                    verify_signature=permission.restrict_to_marketplace_only,
                )
                # check if the plugin is available to install
                PluginService._check_plugin_installation_scope(response.verification)
                if response.unique_identifier != plugin_unique_identifier:
                    raise ValueError(
                        "Marketplace package identifier does not match the requested identifier."
                    ) from None
            else:
                # already downloaded, the cached pkg still has to satisfy the installation scope
                plugin_decode_response = manager.decode_plugin_from_identifier(tenant_id, plugin_unique_identifier)
                PluginService._check_plugin_installation_scope(plugin_decode_response.verification)
                if plugin_decode_response.unique_identifier != plugin_unique_identifier:
                    raise ValueError("Marketplace package identifier does not match the requested identifier.")
            actual_plugin_unique_identifiers.append(plugin_unique_identifier)
            metas.append({"plugin_unique_identifier": plugin_unique_identifier})

        result = manager.install_from_identifiers(
            tenant_id,
            actual_plugin_unique_identifiers,
            PluginInstallationSource.Marketplace,
            metas,
        )
        PluginService.invalidate_plugin_model_providers_cache(tenant_id)
        return _result(result)
