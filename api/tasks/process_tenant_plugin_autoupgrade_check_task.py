import json
import logging
import operator
import typing

import click
from celery import shared_task

from core.helper.marketplace import record_install_plugin_event
from core.plugin.entities.marketplace import MarketplacePluginSnapshot
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.impl.plugin import PluginInstaller
from extensions.ext_redis import redis_client
from models.account import TenantPluginAutoUpgradeStrategy

logger = logging.getLogger(__name__)

RETRY_TIMES_OF_ONE_PLUGIN_IN_ONE_TENANT = 3
CACHE_REDIS_KEY_PREFIX = "plugin_autoupgrade_check_task:cached_plugin_snapshot:"
CACHE_REDIS_TTL = 60 * 60  # 1 hour


def _get_redis_cache_key(plugin_id: str) -> str:
    """Generate Redis cache key for plugin manifest."""
    return f"{CACHE_REDIS_KEY_PREFIX}{plugin_id}"


def _get_cached_manifest(plugin_id: str) -> typing.Union[MarketplacePluginSnapshot, None, bool]:
    """
    Get cached plugin manifest from Redis.
    Returns:
        - MarketplacePluginSnapshot: if found in cache
        - None: if cached as not found (marketplace returned no result)
        - False: if not in cache at all
    """
    try:
        key = _get_redis_cache_key(plugin_id)
        cached_data = redis_client.get(key)
        if cached_data is None:
            return False

        cached_json = json.loads(cached_data)
        if cached_json is None:
            return None

        return MarketplacePluginSnapshot.model_validate(cached_json)
    except Exception:
        logger.exception("Failed to get cached manifest for plugin %s", plugin_id)
        return False


def marketplace_batch_fetch_plugin_manifests(
    plugin_ids_plain_list: list[str],
) -> list[MarketplacePluginSnapshot]:
    """
    Fetch plugin manifests from Redis cache only.
    This function assumes fetch_global_plugin_manifest() has been called
    to pre-populate the cache with all marketplace plugins.
    """
    result: list[MarketplacePluginSnapshot] = []

    # Check Redis cache for each plugin
    for plugin_id in plugin_ids_plain_list:
        cached_result = _get_cached_manifest(plugin_id)
        if not isinstance(cached_result, MarketplacePluginSnapshot):
            # cached_result is False (not in cache) or None (cached as not found)
            logger.warning("plugin %s not found in cache, skipping", plugin_id)
            continue

        result.append(cached_result)

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

                    def fix_only_checker(latest_version: str, current_version: str):
                        latest_version_tuple = tuple(int(val) for val in latest_version.split("."))
                        current_version_tuple = tuple(int(val) for val in current_version.split("."))

                        if (
                            latest_version_tuple[0] == current_version_tuple[0]
                            and latest_version_tuple[1] == current_version_tuple[1]
                        ):
                            return latest_version_tuple[2] != current_version_tuple[2]
                        return False

                    version_checker = {
                        TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST: operator.ne,
                        TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY: fix_only_checker,
                    }

                    if version_checker[strategy_setting](latest_version, current_version):
                        # execute upgrade
                        new_unique_identifier = manifest.latest_package_identifier

                        record_install_plugin_event(new_unique_identifier)
                        click.echo(
                            click.style(
                                f"Upgrade plugin: {original_unique_identifier} -> {new_unique_identifier}",
                                fg="green",
                            )
                        )
                        _ = manager.upgrade_plugin(
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
                    # traceback.print_exc()
                break

    except Exception as e:
        click.echo(click.style(f"Error when checking upgradable plugin: {e}", fg="red"))
        # traceback.print_exc()
        return
