import traceback
import typing

import click
from celery import shared_task

from core.helper import marketplace
from core.helper.marketplace import MarketplacePluginDeclaration
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.impl.plugin import PluginInstaller
from models.account import TenantPluginAutoUpgradeStrategy

RETRY_TIMES_OF_ONE_PLUGIN_IN_ONE_TENANT = 3


cached_plugin_manifests: dict[str, typing.Union[MarketplacePluginDeclaration, None]] = {}


def marketplace_batch_fetch_plugin_manifests(
    plugin_ids_plain_list: list[str],
) -> list[MarketplacePluginDeclaration]:
    global cached_plugin_manifests
    # return marketplace.batch_fetch_plugin_manifests(plugin_ids_plain_list)
    not_included_plugin_ids = [
        plugin_id for plugin_id in plugin_ids_plain_list if plugin_id not in cached_plugin_manifests
    ]
    if not_included_plugin_ids:
        manifests = marketplace.batch_fetch_plugin_manifests_ignore_deserialization_error(not_included_plugin_ids)
        for manifest in manifests:
            cached_plugin_manifests[manifest.plugin_id] = manifest

        if (
            len(manifests) == 0
        ):  # this indicates that the plugin not found in marketplace, should set None in cache to prevent future check
            for plugin_id in not_included_plugin_ids:
                cached_plugin_manifests[plugin_id] = None

    result: list[MarketplacePluginDeclaration] = []
    for plugin_id in plugin_ids_plain_list:
        final_manifest = cached_plugin_manifests.get(plugin_id)
        if final_manifest is not None:
            result.append(final_manifest)

    return result


@shared_task(queue="plugin")
def process_tenant_plugin_autoupgrade_check_task(
    tenant_id: str,
    strategy_setting: TenantPluginAutoUpgradeStrategy.StrategySetting,
    upgrade_time_of_day: int,
    upgrade_mode: TenantPluginAutoUpgradeStrategy.UpgradeMode,
    exclude_plugins: list[str],
    include_plugins: list[str],
):
    try:
        manager = PluginInstaller()

        click.echo(
            click.style(
                f"Checking upgradable plugin for tenant: {tenant_id}",
                fg="green",
            )
        )

        if strategy_setting == TenantPluginAutoUpgradeStrategy.StrategySetting.DISABLED:
            return

        # get plugin_ids to check
        plugin_ids: list[tuple[str, str, str]] = []  # plugin_id, version, unique_identifier
        click.echo(click.style(f"Upgrade mode: {upgrade_mode}", fg="green"))

        if upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.PARTIAL and include_plugins:
            all_plugins = manager.list_plugins(tenant_id)

            for plugin in all_plugins:
                if plugin.source == PluginInstallationSource.Marketplace and plugin.plugin_id in include_plugins:
                    plugin_ids.append(
                        (
                            plugin.plugin_id,
                            plugin.version,
                            plugin.plugin_unique_identifier,
                        )
                    )

        elif upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE:
            # get all plugins and remove excluded plugins
            all_plugins = manager.list_plugins(tenant_id)
            plugin_ids = [
                (plugin.plugin_id, plugin.version, plugin.plugin_unique_identifier)
                for plugin in all_plugins
                if plugin.source == PluginInstallationSource.Marketplace and plugin.plugin_id not in exclude_plugins
            ]
        elif upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL:
            all_plugins = manager.list_plugins(tenant_id)
            plugin_ids = [
                (plugin.plugin_id, plugin.version, plugin.plugin_unique_identifier)
                for plugin in all_plugins
                if plugin.source == PluginInstallationSource.Marketplace
            ]

        if not plugin_ids:
            return

        plugin_ids_plain_list = [plugin_id for plugin_id, _, _ in plugin_ids]

        manifests = marketplace_batch_fetch_plugin_manifests(plugin_ids_plain_list)

        if not manifests:
            return

        for manifest in manifests:
            for plugin_id, version, original_unique_identifier in plugin_ids:
                if manifest.plugin_id != plugin_id:
                    continue

                try:
                    current_version = version
                    latest_version = manifest.latest_version

                    def fix_only_checker(latest_version, current_version):
                        latest_version_tuple = tuple(int(val) for val in latest_version.split("."))
                        current_version_tuple = tuple(int(val) for val in current_version.split("."))

                        if (
                            latest_version_tuple[0] == current_version_tuple[0]
                            and latest_version_tuple[1] == current_version_tuple[1]
                        ):
                            return latest_version_tuple[2] != current_version_tuple[2]
                        return False

                    version_checker = {
                        TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST: lambda latest_version,
                        current_version: latest_version != current_version,
                        TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY: fix_only_checker,
                    }

                    if version_checker[strategy_setting](latest_version, current_version):
                        # execute upgrade
                        new_unique_identifier = manifest.latest_package_identifier

                        marketplace.record_install_plugin_event(new_unique_identifier)
                        click.echo(
                            click.style(
                                f"Upgrade plugin: {original_unique_identifier} -> {new_unique_identifier}",
                                fg="green",
                            )
                        )
                        task_start_resp = manager.upgrade_plugin(
                            tenant_id,
                            original_unique_identifier,
                            new_unique_identifier,
                            PluginInstallationSource.Marketplace,
                            {
                                "plugin_unique_identifier": new_unique_identifier,
                            },
                        )
                except Exception as e:
                    click.echo(click.style(f"Error when upgrading plugin: {e}", fg="red"))
                    traceback.print_exc()
                break

    except Exception as e:
        click.echo(click.style(f"Error when checking upgradable plugin: {e}", fg="red"))
        traceback.print_exc()
        return
