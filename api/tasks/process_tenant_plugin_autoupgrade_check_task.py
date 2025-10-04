import json
import operator
import typing

import click
from celery import shared_task

from core.helper import marketplace
from core.helper.marketplace import MarketplacePluginDeclaration
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.impl.plugin import PluginInstaller
from extensions.ext_redis import redis_client
from models.account import TenantPluginAutoUpgradeStrategy

RETRY_TIMES_OF_ONE_PLUGIN_IN_ONE_TENANT = 3
CACHE_REDIS_KEY_PREFIX = "plugin_autoupgrade_check_task:cached_plugin_manifests:"
CACHE_REDIS_TTL = 60 * 15  # 15 minutes


def _get_redis_cache_key(plugin_id: str) -> str:
    """Generate Redis cache key for plugin manifest."""
    return f"{CACHE_REDIS_KEY_PREFIX}{plugin_id}"


def _get_cached_manifest(plugin_id: str) -> typing.Union[MarketplacePluginDeclaration, None, bool]:
    """
    Get cached plugin manifest from Redis.
    Returns:
        - MarketplacePluginDeclaration: if found in cache
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

        return MarketplacePluginDeclaration.model_validate(cached_json)
    except Exception:
        return False


def _set_cached_manifest(plugin_id: str, manifest: typing.Union[MarketplacePluginDeclaration, None]) -> None:
    """
    Cache plugin manifest in Redis.
    Args:
        plugin_id: The plugin ID
        manifest: The manifest to cache, or None if not found in marketplace
    """
    try:
        key = _get_redis_cache_key(plugin_id)
        if manifest is None:
            # Cache the fact that this plugin was not found
            redis_client.setex(key, CACHE_REDIS_TTL, json.dumps(None))
        else:
            # Cache the manifest data
            redis_client.setex(key, CACHE_REDIS_TTL, manifest.model_dump_json())
    except Exception:
        # If Redis fails, continue without caching
        # traceback.print_exc()
        pass


def marketplace_batch_fetch_plugin_manifests(
    plugin_ids_plain_list: list[str],
) -> list[MarketplacePluginDeclaration]:
    """Fetch plugin manifests with Redis caching support."""
    cached_manifests: dict[str, typing.Union[MarketplacePluginDeclaration, None]] = {}
    not_cached_plugin_ids: list[str] = []

    # Check Redis cache for each plugin
    for plugin_id in plugin_ids_plain_list:
        cached_result = _get_cached_manifest(plugin_id)
        if cached_result is False:
            # Not in cache, need to fetch
            not_cached_plugin_ids.append(plugin_id)
        else:
            # Either found manifest or cached as None (not found in marketplace)
            # At this point, cached_result is either MarketplacePluginDeclaration or None
            if isinstance(cached_result, bool):
                # This should never happen due to the if condition above, but for type safety
                continue
            cached_manifests[plugin_id] = cached_result

    # Fetch uncached plugins from marketplace
    if not_cached_plugin_ids:
        manifests = marketplace.batch_fetch_plugin_manifests_ignore_deserialization_error(not_cached_plugin_ids)

        # Cache the fetched manifests
        for manifest in manifests:
            cached_manifests[manifest.plugin_id] = manifest
            _set_cached_manifest(manifest.plugin_id, manifest)

        # Cache plugins that were not found in marketplace
        fetched_plugin_ids = {manifest.plugin_id for manifest in manifests}
        for plugin_id in not_cached_plugin_ids:
            if plugin_id not in fetched_plugin_ids:
                cached_manifests[plugin_id] = None
                _set_cached_manifest(plugin_id, None)

    # Build result list from cached manifests
    result: list[MarketplacePluginDeclaration] = []
    for plugin_id in plugin_ids_plain_list:
        cached_manifest: typing.Union[MarketplacePluginDeclaration, None] = cached_manifests.get(plugin_id)
        if cached_manifest is not None:
            result.append(cached_manifest)

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

                        marketplace.record_install_plugin_event(new_unique_identifier)
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
