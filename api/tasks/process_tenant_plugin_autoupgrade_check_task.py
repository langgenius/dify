import json
import logging
import operator
import secrets
import time
from uuid import uuid4

import click
from celery import Task, shared_task
from pydantic import TypeAdapter
from redis import RedisError

from core.helper.marketplace import batch_fetch_plugin_manifests, get_plugin_pkg_url
from core.plugin.entities.marketplace import MarketplacePluginDeclaration, MarketplacePluginSnapshot
from core.plugin.entities.plugin import PluginInstallation, PluginInstallationSource
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.plugin_service import PluginService
from extensions.ext_redis import redis_client
from models.account import (
    TenantPluginAutoUpgradeCategory,
    TenantPluginAutoUpgradeMode,
    TenantPluginAutoUpgradeStrategySetting,
)
from tasks.plugin_autoupgrade_coordination import (
    CHECK_TASK_TIME_LIMIT,
    AcquireResult,
    CheckReservation,
    get_upgrade_check_coordinator,
)

logger = logging.getLogger(__name__)

PluginCategory = TenantPluginAutoUpgradeCategory
RETRY_TIMES_OF_ONE_PLUGIN_IN_ONE_TENANT = 3
CACHE_REDIS_KEY_PREFIX = "plugin_autoupgrade_check_task:cached_plugin_snapshot:"
CACHE_REDIS_TTL = 60 * 60  # 1 hour
COORDINATION_HEADER = "plugin_autoupgrade_check"

# A cached miss is stored as JSON null, so None has to stay a valid payload.
_CACHED_MANIFEST_ADAPTER = TypeAdapter(MarketplacePluginSnapshot | None)


def _get_redis_cache_key(plugin_id: str) -> str:
    """Generate Redis cache key for plugin manifest."""
    return f"{CACHE_REDIS_KEY_PREFIX}{plugin_id}"


def _get_cached_manifest(plugin_id: str) -> MarketplacePluginSnapshot | None | bool:
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

        return _CACHED_MANIFEST_ADAPTER.validate_json(cached_data)
    except Exception:
        logger.exception("Failed to get cached manifest for plugin %s", plugin_id)
        return False


def _set_cached_manifest(plugin_id: str, snapshot: MarketplacePluginSnapshot | None) -> None:
    """
    Cache a plugin snapshot in Redis, or record that the marketplace has no such plugin.

    Caching misses as well as hits keeps the fallback cheap: a plugin that the marketplace
    does not know about is looked up once per TTL instead of once per check cycle.
    """
    try:
        key = _get_redis_cache_key(plugin_id)
        if snapshot is None:
            redis_client.setex(key, CACHE_REDIS_TTL, json.dumps(None))
        else:
            redis_client.setex(key, CACHE_REDIS_TTL, snapshot.model_dump_json())
    except Exception:
        # If Redis fails, continue without caching
        logger.exception("Failed to set cached manifest for plugin %s", plugin_id)


def _snapshot_from_declaration(declaration: MarketplacePluginDeclaration) -> MarketplacePluginSnapshot:
    """Adapt a batch-API declaration to the snapshot shape used by the upgrade check."""
    return MarketplacePluginSnapshot(
        org=declaration.org,
        name=declaration.name,
        latest_version=declaration.latest_version,
        latest_package_identifier=declaration.latest_package_identifier,
        latest_package_url=get_plugin_pkg_url(declaration.latest_package_identifier),
    )


def marketplace_batch_fetch_plugin_manifests(
    plugin_ids_plain_list: list[str],
) -> list[MarketplacePluginSnapshot]:
    """
    Fetch plugin manifests, preferring the pre-populated Redis cache.

    fetch_global_plugin_manifest() normally warms the cache with the whole marketplace.
    When that snapshot is unavailable or incomplete, fall back to the per-plugin batch API
    so upgrades still happen instead of being silently skipped.
    """
    result: list[MarketplacePluginSnapshot] = []
    uncached_plugin_ids: list[str] = []

    # Check Redis cache for each plugin
    for plugin_id in plugin_ids_plain_list:
        cached_result = _get_cached_manifest(plugin_id)
        if isinstance(cached_result, MarketplacePluginSnapshot):
            result.append(cached_result)
        elif cached_result is None:
            # Cached as not found in the marketplace; nothing to upgrade to.
            continue
        else:
            uncached_plugin_ids.append(plugin_id)

    if not uncached_plugin_ids:
        return result

    logger.info(
        "%d plugin manifests missing from the global snapshot, fetching them from the marketplace",
        len(uncached_plugin_ids),
    )

    try:
        declarations = batch_fetch_plugin_manifests(uncached_plugin_ids)
    except Exception:
        logger.exception(
            "failed to fetch plugin manifests from marketplace, skipping %d plugins", len(uncached_plugin_ids)
        )
        return result

    fetched_plugin_ids = set()
    for declaration in declarations:
        snapshot = _snapshot_from_declaration(declaration)
        fetched_plugin_ids.add(declaration.plugin_id)
        _set_cached_manifest(declaration.plugin_id, snapshot)
        result.append(snapshot)

    # Remember which plugins the marketplace does not serve, so we stop asking every cycle.
    for plugin_id in uncached_plugin_ids:
        if plugin_id not in fetched_plugin_ids:
            _set_cached_manifest(plugin_id, None)

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


@shared_task(
    bind=True,
    queue="plugin",
    time_limit=CHECK_TASK_TIME_LIMIT,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=None,
)
def process_tenant_plugin_autoupgrade_check_task(
    self: Task,
    tenant_id: str,
    strategy_setting: TenantPluginAutoUpgradeStrategySetting,
    upgrade_time_of_day: int,
    upgrade_mode: TenantPluginAutoUpgradeMode,
    exclude_plugins: list[str],
    include_plugins: list[str],
    category: PluginCategory | str | None = None,
) -> None:
    """Admit one scheduled strategy before running any plugin or marketplace work.

    Preconditions: an optional reservation header must match the tenant and category;
    absent headers support messages queued before this coordination was deployed.
    Postconditions: only an admitted execution performs work, and all normal exits release
    its global slot while preserving completed-work deduplication. Busy/failed admission
    retries until the reservation deadline. A hard-killed worker's lease expires only
    after the task's hard time limit, allowing bounded recovery without early slot reuse.
    """
    if strategy_setting == TenantPluginAutoUpgradeStrategySetting.DISABLED:
        return

    coordinator = get_upgrade_check_coordinator()
    category_value = _normalize_category(category)
    coordination = (self.request.headers or {}).get(COORDINATION_HEADER)
    if coordination is None:
        try:
            reservation = coordinator.reserve_legacy(
                tenant_id=tenant_id,
                category=category_value,
                upgrade_time_of_day=upgrade_time_of_day,
                now=time.time(),
                producer_id=f"legacy:{self.request.id}" if self.request.id is not None else None,
            )
        except RedisError as exc:
            # There is no reservation deadline yet. Bound this legacy admission retry.
            raise self.retry(exc=exc, countdown=30, max_retries=3) from exc
    else:
        reservation = CheckReservation.model_validate_json(coordination)

    if reservation is None:
        return
    if reservation.tenant_id != tenant_id or reservation.category != category_value:
        raise ValueError("Plugin upgrade check reservation does not match its strategy")

    execution_token = str(uuid4())
    try:
        admission = coordinator.acquire(reservation, execution_token)
    except RedisError as exc:
        _retry_admission(self, reservation, exc)
        return

    if admission == AcquireResult.BUSY:
        _retry_admission(self, reservation, None)
    elif admission == AcquireResult.ACQUIRED:
        try:
            _process_tenant_plugin_autoupgrade_check(
                tenant_id,
                strategy_setting,
                upgrade_time_of_day,
                upgrade_mode,
                exclude_plugins,
                include_plugins,
                category,
            )
        finally:
            try:
                coordinator.finish(reservation, execution_token)
            except RedisError:
                logger.exception("failed to finish plugin upgrade check for tenant %s", tenant_id)


def _retry_admission(task: Task, reservation: CheckReservation, exc: RedisError | None) -> None:
    """Retry admission with bounded backoff and the original work deadline.

    Preconditions: no plugin work or execution slot is owned by this invocation.
    Postconditions: a retry preserves its reservation and cannot create a new daily
    check; expired work returns without a retry. Celery Retry deliberately escapes
    the processor's broad business-error handler.
    """
    remaining = reservation.deadline - time.time()
    if remaining > 0:
        delay = min(60, 2 ** min(task.request.retries, 5) + secrets.randbelow(5) + 1)
        headers = dict(task.request.headers or {})
        headers[COORDINATION_HEADER] = reservation.model_dump_json()
        logger.info("deferring plugin upgrade check for tenant %s until capacity is available", reservation.tenant_id)
        raise task.retry(exc=exc, headers=headers, countdown=min(delay, remaining), max_retries=None)
    logger.info("expired deferred plugin upgrade check for tenant %s", reservation.tenant_id)


def _process_tenant_plugin_autoupgrade_check(
    tenant_id: str,
    strategy_setting: TenantPluginAutoUpgradeStrategySetting,
    upgrade_time_of_day: int,
    upgrade_mode: TenantPluginAutoUpgradeMode,
    exclude_plugins: list[str],
    include_plugins: list[str],
    category: PluginCategory | str | None = None,
) -> None:
    """Check one admitted strategy using the existing category and upgrade rules.

    Preconditions: the caller owns an execution slot for this tenant/category.
    Postconditions: eligible upgrades retain their existing download/upload path;
    failures remain isolated and logged, without changing strategy selection.
    """
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
