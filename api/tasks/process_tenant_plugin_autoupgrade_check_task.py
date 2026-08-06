import json
import logging
import operator
import typing

import click
from celery import shared_task

from core.plugin.entities.marketplace import MarketplacePluginSnapshot
from core.plugin.entities.plugin import PluginInstallation, PluginInstallationSource
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.plugin_service import PluginService
from extensions.ext_redis import redis_client
from models.account import (
    TenantPluginAutoUpgradeCategory,
    TenantPluginAutoUpgradeMode,
    TenantPluginAutoUpgradeStrategySetting,
)

logger = logging.getLogger(__name__)

PluginCategory = TenantPluginAutoUpgradeCategory
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


def _normalize_category(category: PluginCategory | str | None) -> str | None:
    if category is None:
        return None
    if isinstance(category, PluginCategory):
        return category.value
    return str(category)


def _plugin_matches_category(plugin: PluginInstallation, category: str | None) -> bool:
    """Return whether an installed plugin should be checked by a category strategy."""
    if category is None:
        return True

    declaration = getattr(plugin, "declaration", None)
    plugin_category = getattr(declaration, "category", None)
    plugin_category_value = getattr(plugin_category, "value", plugin_category)
    return plugin_category_value == category


@shared_task(queue="plugin")
def process_tenant_plugin_autoupgrade_check_task(
    tenant_id: str,
    strategy_setting: TenantPluginAutoUpgradeStrategySetting,
    upgrade_time_of_day: int,
    upgrade_mode: TenantPluginAutoUpgradeMode,
    exclude_plugins: list[str],
    include_plugins: list[str],
    category: PluginCategory | str | None = None,
):
    try:
        manager = PluginInstaller()
        category_value = _normalize_category(category)

        click.echo(
            click.style(
                f"Checking upgradable plugin for tenant: {tenant_id}, category: {category_value or 'all'}",
                fg="green",
            )
        )

        if strategy_setting == TenantPluginAutoUpgradeStrategySetting.DISABLED:
            return

        # get plugin_ids to check
        plugin_ids: list[tuple[str, str, str]] = []  # plugin_id, version, unique_identifier
        click.echo(click.style(f"Upgrade mode: {upgrade_mode}", fg="green"))

        if upgrade_mode == TenantPluginAutoUpgradeMode.PARTIAL and include_plugins:
            all_plugins = manager.list_plugins(tenant_id)

            for plugin in all_plugins:
                if (
                    plugin.source == PluginInstallationSource.Marketplace
                    and plugin.plugin_id in include_plugins
                    and _plugin_matches_category(plugin, category_value)
                ):
                    plugin_ids.append(
                        (
                            plugin.plugin_id,
                            plugin.version,
                            plugin.plugin_unique_identifier,
                        )
                    )

        elif upgrade_mode == TenantPluginAutoUpgradeMode.EXCLUDE:
            # get all plugins and remove excluded plugins
            all_plugins = manager.list_plugins(tenant_id)
            plugin_ids = [
                (plugin.plugin_id, plugin.version, plugin.plugin_unique_identifier)
                for plugin in all_plugins
                if plugin.source == PluginInstallationSource.Marketplace
                and plugin.plugin_id not in exclude_plugins
                and _plugin_matches_category(plugin, category_value)
            ]
        elif upgrade_mode == TenantPluginAutoUpgradeMode.ALL:
            all_plugins = manager.list_plugins(tenant_id)
            plugin_ids = [
                (plugin.plugin_id, plugin.version, plugin.plugin_unique_identifier)
                for plugin in all_plugins
                if plugin.source == PluginInstallationSource.Marketplace
                and _plugin_matches_category(plugin, category_value)
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
                        TenantPluginAutoUpgradeStrategySetting.LATEST: operator.ne,
                        TenantPluginAutoUpgradeStrategySetting.FIX_ONLY: fix_only_checker,
                    }

                    if version_checker[strategy_setting](latest_version, current_version):
                        # execute upgrade
                        new_unique_identifier = manifest.latest_package_identifier

                        click.echo(
                            click.style(
                                f"Upgrade plugin: {original_unique_identifier} -> {new_unique_identifier}",
                                fg="green",
                            )
                        )
                        # Use the service that downloads and uploads the package to the daemon
                        # first; calling manager.upgrade_plugin directly skips that step and the
                        # daemon fails because the package never reaches its local bucket.
                        _ = PluginService.upgrade_plugin_with_marketplace(
                            tenant_id,
                            original_unique_identifier,
                            new_unique_identifier,
                        )
                except Exception as e:
                    click.echo(click.style(f"Error when upgrading plugin: {e}", fg="red"))
                    # traceback.print_exc()
                break

    except Exception as e:
        click.echo(click.style(f"Error when checking upgradable plugin: {e}", fg="red"))
        # traceback.print_exc()
        return
