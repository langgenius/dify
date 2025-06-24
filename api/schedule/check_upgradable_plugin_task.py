import time
import traceback

import click

import app
from core.helper import marketplace
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.impl.plugin import PluginInstaller
from extensions.ext_database import db
from models.account import TenantPluginAutoUpgradeStrategy

AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL = 15 * 60  # 15 minutes

RETRY_TIMES_OF_ONE_PLUGIN_IN_ONE_TENANT = 3


@app.celery.task(queue="plugin")
def check_upgradable_plugin_task():
    click.echo(click.style("Start check upgradable plugin.", fg="green"))
    start_at = time.perf_counter()

    now_seconds_of_day = time.time() % 86400  # we assume the tz is UTC
    click.echo(click.style("Now seconds of day: {}".format(now_seconds_of_day), fg="green"))

    # get strategies that set to be performed in the next AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL
    strategies = (
        db.session.query(TenantPluginAutoUpgradeStrategy)
        .filter(
            TenantPluginAutoUpgradeStrategy.upgrade_time_of_day >= now_seconds_of_day,
            TenantPluginAutoUpgradeStrategy.upgrade_time_of_day
            < now_seconds_of_day + AUTO_UPGRADE_MINIMAL_CHECKING_INTERVAL,
            TenantPluginAutoUpgradeStrategy.strategy_setting
            != TenantPluginAutoUpgradeStrategy.StrategySetting.DISABLED,
        )
        .all()
    )

    manager = PluginInstaller()

    for strategy in strategies:
        try:
            tenant_id = strategy.tenant_id
            strategy_setting = strategy.strategy_setting
            upgrade_mode = strategy.upgrade_mode
            exclude_plugins = strategy.exclude_plugins
            include_plugins = strategy.include_plugins

            if strategy_setting == TenantPluginAutoUpgradeStrategy.StrategySetting.DISABLED:
                continue

            # get plugins that need to be checked
            plugin_ids: list[tuple[str, str, str]] = []  # plugin_id, version, unique_identifier

            if upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.PARTIAL and include_plugins:
                all_plugins = manager.list_plugins(tenant_id)

                for plugin in all_plugins:
                    if plugin.source == PluginInstallationSource.Marketplace and plugin.plugin_id in include_plugins:
                        plugin_ids.append((plugin.plugin_id, plugin.version, plugin.plugin_unique_identifier))

            elif upgrade_mode == TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE:
                # get all plugins and remove the exclude plugins
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
                continue

            plugin_ids_plain_list = [plugin_id for plugin_id, _, _ in plugin_ids]

            click.echo(click.style("Fetching manifests for plugins: {}".format(plugin_ids_plain_list), fg="green"))

            # fetch latest versions from marketplace
            manifests = marketplace.batch_fetch_plugin_manifests(plugin_ids_plain_list)

            for manifest in manifests:
                for plugin_id, version, original_unique_identifier in plugin_ids:
                    if manifest.plugin_id != plugin_id:
                        continue

                    try:
                        current_version = version
                        latest_version = manifest.latest_version

                        # @yeuoly review here
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
                                    "Upgrade plugin: {} -> {}".format(
                                        original_unique_identifier, new_unique_identifier
                                    ),
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
                        click.echo(click.style("Error when upgrading plugin: {}".format(e), fg="red"))
                        traceback.print_exc()
                    break

        except Exception as e:
            click.echo(click.style("Error when checking upgradable plugin: {}".format(e), fg="red"))
            traceback.print_exc()
            continue

    end_at = time.perf_counter()
    click.echo(
        click.style(
            "Checked upgradable plugin success latency: {}".format(end_at - start_at),
            fg="green",
        )
    )
