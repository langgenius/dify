"""Core plugin service and tenant-scoped plugin metadata cache ownership.

This module owns plugin daemon management calls that are shared by API services
and core runtimes. Plugin model provider discovery is cached here, alongside
plugin install, uninstall, and upgrade invalidation, so all cache mutations for
plugin-owned provider metadata stay tenant-scoped and in one place.

The console plugin list also normalizes endpoint setup counters against live
endpoint records. Some plugin daemon builds return stale ``endpoints_*``
aggregates in ``management/list`` even while plugin-scoped endpoint queries are
current, so the API reconciles those counts before serving workspace plugin
metadata.
"""

import logging
import time
from collections.abc import Mapping, Sequence
from mimetypes import guess_type
from typing import ClassVar, Literal, Protocol

from pydantic import BaseModel, TypeAdapter, ValidationError
from redis import RedisError
from redis.exceptions import LockError
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session
from yarl import URL

from configs import dify_config
from core.helper import marketplace
from core.helper.download import download_with_size_limit
from core.helper.marketplace import download_plugin_pkg
from core.helper.model_provider_cache import ProviderCredentialsCache, ProviderCredentialsCacheType
from core.plugin.entities.bundle import PluginBundleDependency
from core.plugin.entities.plugin import (
    PluginCategory,
    PluginDeclaration,
    PluginEntity,
    PluginInstallation,
    PluginInstallationSource,
)
from core.plugin.entities.plugin_daemon import (
    PluginDecodeResponse,
    PluginInstallTask,
    PluginInstallTaskStatus,
    PluginListResponse,
    PluginListWithoutTotalResponse,
    PluginModelProviderEntity,
    PluginVerification,
)
from core.plugin.impl.asset import PluginAssetManager
from core.plugin.impl.debugging import PluginDebuggingClient
from core.plugin.impl.endpoint import PluginEndpointClient
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.plugin import PluginInstaller
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from models.provider import Provider, ProviderCredential, TenantPreferredModelProvider
from models.provider_ids import GenericProviderID, ModelProviderID
from services.enterprise.plugin_manager_service import (
    PluginManagerService,
    PreUninstallPluginRequest,
)
from services.errors.plugin import PluginInstallationForbiddenError
from services.feature_service import FeatureService, PluginInstallationScope

logger = logging.getLogger(__name__)
_provider_entities_adapter: TypeAdapter[list[ProviderEntity]] = TypeAdapter(list[ProviderEntity])


class _RedisLock(Protocol):
    def acquire(self, *, blocking: bool = True, blocking_timeout: float | None = None) -> bool: ...

    def release(self) -> None: ...


class PluginService:
    _plugin_model_providers_memory_cache: ClassVar[dict[str, tuple[int, float, tuple[ProviderEntity, ...]]]] = {}

    class LatestPluginCache(BaseModel):
        plugin_id: str
        version: str
        unique_identifier: str
        status: Literal["active", "deleted"]
        deprecated_reason: str
        alternative_plugin_id: str

    REDIS_KEY_PREFIX = "plugin_service:latest_plugin:"
    REDIS_TTL = 60 * 5  # 5 minutes
    PLUGIN_MODEL_PROVIDERS_REDIS_KEY_PREFIX = "plugin_model_providers:tenant_id:"
    PLUGIN_MODEL_PROVIDERS_GENERATION_REDIS_KEY_PREFIX = "plugin_model_providers_generation:tenant_id:"
    PLUGIN_MODEL_PROVIDERS_LOCK_REDIS_KEY_PREFIX = "plugin_model_providers_refresh_lock:tenant_id:"
    PLUGIN_MODEL_PROVIDERS_LOCK_TTL = 30
    PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_TIMEOUT = 2.0
    PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_INTERVAL = 0.05
    PLUGIN_INSTALL_TASK_TERMINAL_STATUSES = (PluginInstallTaskStatus.Success, PluginInstallTaskStatus.Failed)
    # Mirror the detail-panel endpoint query size so list reconciliation and
    # the visible endpoint drawer exercise the same daemon pagination path.
    ENDPOINT_RECONCILIATION_PAGE_SIZE = 100

    @classmethod
    def _get_plugin_model_providers_cache_key(cls, tenant_id: str, generation: int | None = None) -> str:
        if generation is None:
            return f"{cls.PLUGIN_MODEL_PROVIDERS_REDIS_KEY_PREFIX}{tenant_id}"

        return f"{cls.PLUGIN_MODEL_PROVIDERS_REDIS_KEY_PREFIX}{tenant_id}:generation:{generation}"

    @classmethod
    def _get_plugin_model_providers_generation_cache_key(cls, tenant_id: str) -> str:
        return f"{cls.PLUGIN_MODEL_PROVIDERS_GENERATION_REDIS_KEY_PREFIX}{tenant_id}"

    @classmethod
    def _get_plugin_model_providers_lock_key(cls, tenant_id: str, generation: int) -> str:
        return f"{cls.PLUGIN_MODEL_PROVIDERS_LOCK_REDIS_KEY_PREFIX}{tenant_id}:generation:{generation}"

    @staticmethod
    def _get_provider_short_name_alias(provider: PluginModelProviderEntity) -> str:
        """
        Expose a bare provider alias only for the canonical provider mapping.

        Multiple plugins can publish the same short provider slug. If every
        provider entity keeps that slug in ``provider_name``, callers that still
        resolve by short name become order-dependent. Restrict the alias to the
        provider selected by ``ModelProviderID`` so legacy short-name lookups
        remain deterministic while the runtime surface stays canonical.
        """
        try:
            canonical_provider_id = ModelProviderID(provider.provider)
        except ValueError:
            return ""

        if canonical_provider_id.plugin_id != provider.plugin_id:
            return ""
        if canonical_provider_id.provider_name != provider.provider:
            return ""

        return provider.provider

    @classmethod
    def _to_provider_entity(cls, provider: PluginModelProviderEntity) -> ProviderEntity:
        declaration = provider.declaration.model_copy(deep=True)
        declaration.provider = f"{provider.plugin_id}/{provider.provider}"
        declaration.provider_name = cls._get_provider_short_name_alias(provider)
        return declaration

    @classmethod
    def _copy_provider_entities(cls, providers: Sequence[ProviderEntity]) -> tuple[ProviderEntity, ...]:
        return tuple(provider.model_copy(deep=True) for provider in providers)

    @classmethod
    def _load_plugin_model_providers_generation(cls, tenant_id: str) -> int | None:
        cache_key = cls._get_plugin_model_providers_generation_cache_key(tenant_id)
        try:
            cached_generation = redis_client.get(cache_key)
        except (RedisError, RuntimeError):
            logger.warning("Failed to read plugin model provider generation for tenant %s.", tenant_id, exc_info=True)
            return None

        if cached_generation is None:
            return 0

        try:
            return int(cached_generation)
        except (TypeError, ValueError):
            logger.warning(
                "Invalid plugin model provider generation for tenant %s; deleting cache marker.",
                tenant_id,
                exc_info=True,
            )
            try:
                redis_client.delete(cache_key)
            except (RedisError, RuntimeError):
                logger.warning(
                    "Failed to delete invalid plugin model provider generation for tenant %s.",
                    tenant_id,
                    exc_info=True,
                )
            return None

    @classmethod
    def _load_in_memory_plugin_model_providers(
        cls, memory_cache_key: str, generation: int
    ) -> tuple[ProviderEntity, ...] | None:
        cached_entry = cls._plugin_model_providers_memory_cache.get(memory_cache_key)
        if cached_entry is None:
            return None

        cached_generation, expires_at, providers = cached_entry
        if cached_generation != generation or time.monotonic() >= expires_at:
            cls._plugin_model_providers_memory_cache.pop(memory_cache_key, None)
            return None

        return cls._copy_provider_entities(providers)

    @classmethod
    def _store_in_memory_plugin_model_providers(
        cls, memory_cache_key: str, generation: int, providers: Sequence[ProviderEntity]
    ) -> None:
        ttl = dify_config.PLUGIN_MODEL_PROVIDERS_CACHE_TTL
        if ttl <= 0:
            cls._plugin_model_providers_memory_cache.pop(memory_cache_key, None)
            return

        cls._plugin_model_providers_memory_cache[memory_cache_key] = (
            generation,
            time.monotonic() + ttl,
            cls._copy_provider_entities(providers),
        )

    @classmethod
    def _load_cached_plugin_model_providers_for_generation(
        cls, tenant_id: str, generation: int | None
    ) -> tuple[tuple[ProviderEntity, ...] | None, bool]:
        if generation is not None:
            in_memory_cached_providers = cls._load_in_memory_plugin_model_providers(tenant_id, generation)
            if in_memory_cached_providers is not None:
                return in_memory_cached_providers, True

        if generation is None:
            return None, False

        cache_keys = []
        cache_keys.append(cls._get_plugin_model_providers_cache_key(tenant_id, generation))
        if generation == 0:
            cache_keys.append(cls._get_plugin_model_providers_cache_key(tenant_id))

        if not cache_keys:
            return None, True

        try:
            cached_provider_entries = redis_client.mget(cache_keys)
        except (LockError, RedisError, RuntimeError):
            logger.warning("Failed to read cached plugin model providers for tenant %s.", tenant_id, exc_info=True)
            return None, False

        if len(cached_provider_entries) != len(cache_keys):
            logger.warning(
                "Unexpected cached plugin model providers response size for tenant %s.",
                tenant_id,
            )
            return None, False

        for cache_key, cached_providers in zip(cache_keys, cached_provider_entries):
            if not cached_providers:
                continue

            try:
                providers = tuple(_provider_entities_adapter.validate_json(cached_providers))
                if generation is not None:
                    cls._store_in_memory_plugin_model_providers(tenant_id, generation, providers)
                return providers, True
            except (TypeError, ValueError, ValidationError):
                logger.warning(
                    "Invalid cached plugin model providers for tenant %s; deleting cache key %s.",
                    tenant_id,
                    cache_key,
                    exc_info=True,
                )
                try:
                    redis_client.delete(cache_key)
                except (RedisError, RuntimeError):
                    logger.warning(
                        "Failed to delete invalid cached plugin model providers for tenant %s.",
                        tenant_id,
                        exc_info=True,
                    )

        return None, True

    @classmethod
    def _store_cached_plugin_model_providers(
        cls, tenant_id: str, generation: int, providers: Sequence[ProviderEntity]
    ) -> None:
        cache_key = cls._get_plugin_model_providers_cache_key(tenant_id, generation)
        try:
            payload = _provider_entities_adapter.dump_json(list(providers)).decode("utf-8")
            redis_client.setex(cache_key, dify_config.PLUGIN_MODEL_PROVIDERS_CACHE_TTL, payload)
        except (RedisError, RuntimeError):
            logger.warning("Failed to cache plugin model providers for tenant %s.", tenant_id, exc_info=True)

    @classmethod
    def _try_acquire_plugin_model_providers_lock(
        cls, tenant_id: str, generation: int, *, wait_timeout: float | None = None
    ) -> tuple[_RedisLock | None, bool]:
        lock_key = cls._get_plugin_model_providers_lock_key(tenant_id, generation)
        blocking = wait_timeout is not None
        try:
            lock = redis_client.lock(
                lock_key,
                timeout=cls.PLUGIN_MODEL_PROVIDERS_LOCK_TTL,
                sleep=cls.PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_INTERVAL,
            )
            if blocking:
                acquired = lock.acquire(blocking=True, blocking_timeout=wait_timeout)
            else:
                acquired = lock.acquire(blocking=False)
        except (RedisError, RuntimeError):
            logger.warning(
                "Failed to acquire plugin model providers refresh lock for tenant %s.",
                tenant_id,
                exc_info=True,
            )
            return None, False

        if not acquired:
            return None, True

        return lock, True

    @classmethod
    def _release_plugin_model_providers_lock(cls, tenant_id: str, lock: _RedisLock) -> None:
        try:
            lock.release()
        except (LockError, RedisError, RuntimeError):
            logger.warning(
                "Failed to release plugin model providers refresh lock for tenant %s.",
                tenant_id,
                exc_info=True,
            )

    @classmethod
    def _load_or_acquire_plugin_model_providers_refresh(
        cls, tenant_id: str
    ) -> tuple[tuple[ProviderEntity, ...] | None, _RedisLock | None, int | None]:
        """
        Return cached provider metadata or a lock granting permission to refresh it.

        Redis lock TTL is only a lease for crashed refresh owners; it is not a
        waiter deadline. Waiters use Redis lock blocking with a short request
        budget, then re-check cache before failing so requests do not hang behind
        a stale or slow refresh owner.
        """
        while True:
            generation = cls._load_plugin_model_providers_generation(tenant_id)
            cached_providers, cache_available = cls._load_cached_plugin_model_providers_for_generation(
                tenant_id, generation
            )
            if cached_providers is not None:
                return cached_providers, None, generation
            if generation is None or not cache_available:
                return None, None, generation

            refresh_lock, lock_available = cls._try_acquire_plugin_model_providers_lock(
                tenant_id,
                generation,
                wait_timeout=cls.PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_TIMEOUT,
            )
            if not lock_available:
                return None, None, generation

            latest_generation = cls._load_plugin_model_providers_generation(tenant_id)
            cached_providers, cache_available = cls._load_cached_plugin_model_providers_for_generation(
                tenant_id, latest_generation
            )
            if cached_providers is not None:
                if refresh_lock is not None:
                    cls._release_plugin_model_providers_lock(tenant_id, refresh_lock)
                return cached_providers, None, latest_generation
            if latest_generation is None or not cache_available:
                if refresh_lock is not None:
                    cls._release_plugin_model_providers_lock(tenant_id, refresh_lock)
                return None, None, latest_generation
            if latest_generation != generation:
                if refresh_lock is not None:
                    cls._release_plugin_model_providers_lock(tenant_id, refresh_lock)
                continue
            if refresh_lock is not None:
                return None, refresh_lock, generation

            logger.warning(
                "Timed out waiting for plugin model providers refresh lock for tenant %s generation %s.",
                tenant_id,
                generation,
            )
            raise RuntimeError(f"Timed out waiting for plugin model providers refresh lock for tenant {tenant_id}.")

    @classmethod
    def invalidate_plugin_model_providers_cache(cls, tenant_id: str) -> None:
        """Invalidate tenant-scoped provider metadata across Redis and worker-local mirrors."""
        cls._plugin_model_providers_memory_cache.pop(tenant_id, None)
        cache_key = cls._get_plugin_model_providers_cache_key(tenant_id)
        generation_key = cls._get_plugin_model_providers_generation_cache_key(tenant_id)
        try:
            pipe = redis_client.pipeline(transaction=False)
            pipe.delete(cache_key)
            pipe.incr(generation_key)
            pipe.execute()
        except (RedisError, RuntimeError):
            logger.warning("Failed to invalidate plugin model providers cache for tenant %s.", tenant_id, exc_info=True)

    @classmethod
    def fetch_plugin_model_providers(
        cls, *, tenant_id: str, client: PluginModelClient | None = None
    ) -> Sequence[ProviderEntity]:
        """
        Fetch plugin model providers through the tenant-scoped plugin cache.

        Plugin daemon provider discovery and plugin lifecycle cache invalidation
        are intentionally owned by this service so tenant isolation and cache
        expiry are handled in one place.
        """
        cached_providers, refresh_lock, refresh_generation = cls._load_or_acquire_plugin_model_providers_refresh(
            tenant_id
        )
        if cached_providers is not None:
            return cached_providers

        model_client = client or PluginModelClient()
        try:
            providers = tuple(
                cls._to_provider_entity(provider) for provider in model_client.fetch_model_providers(tenant_id)
            )
            generation = cls._load_plugin_model_providers_generation(tenant_id)
            if generation is not None and generation == refresh_generation:
                cls._store_in_memory_plugin_model_providers(tenant_id, generation, providers)
                cls._store_cached_plugin_model_providers(tenant_id, generation, providers)
            return providers
        finally:
            if refresh_lock is not None:
                cls._release_plugin_model_providers_lock(tenant_id, refresh_lock)

    @staticmethod
    def fetch_latest_plugin_version(plugin_ids: Sequence[str]) -> Mapping[str, LatestPluginCache | None]:
        """
        Fetch the latest plugin version
        """
        result: dict[str, PluginService.LatestPluginCache | None] = {}

        try:
            cache_not_exists = []

            # Try to get from Redis first
            for plugin_id in plugin_ids:
                cached_data = redis_client.get(f"{PluginService.REDIS_KEY_PREFIX}{plugin_id}")
                if cached_data:
                    result[plugin_id] = PluginService.LatestPluginCache.model_validate_json(cached_data)
                else:
                    cache_not_exists.append(plugin_id)

            if cache_not_exists:
                if not dify_config.MARKETPLACE_ENABLED:
                    logger.info(
                        "Marketplace disabled; skipping latest-plugins metadata fetch for %d ids",
                        len(cache_not_exists),
                    )
                    for plugin_id in cache_not_exists:
                        result[plugin_id] = None
                else:
                    manifests = {
                        manifest.plugin_id: manifest
                        for manifest in marketplace.batch_fetch_plugin_manifests(cache_not_exists)
                    }

                    for plugin_id, manifest in manifests.items():
                        latest_plugin = PluginService.LatestPluginCache(
                            plugin_id=plugin_id,
                            version=manifest.latest_version,
                            unique_identifier=manifest.latest_package_identifier,
                            status=manifest.status,
                            deprecated_reason=manifest.deprecated_reason,
                            alternative_plugin_id=manifest.alternative_plugin_id,
                        )

                        # Store in Redis
                        redis_client.setex(
                            f"{PluginService.REDIS_KEY_PREFIX}{plugin_id}",
                            PluginService.REDIS_TTL,
                            latest_plugin.model_dump_json(),
                        )

                        result[plugin_id] = latest_plugin

                        # pop plugin_id from cache_not_exists
                        cache_not_exists.remove(plugin_id)

                    for plugin_id in cache_not_exists:
                        result[plugin_id] = None

            return result
        except Exception:
            logger.exception("failed to fetch latest plugin version")
            return result

    @staticmethod
    def _check_marketplace_only_permission():
        """
        Check if the marketplace only permission is enabled
        """
        features = FeatureService.get_system_features()
        if features.plugin_installation_permission.restrict_to_marketplace_only:
            raise PluginInstallationForbiddenError("Plugin installation is restricted to marketplace only")

    @staticmethod
    def _check_plugin_installation_scope(plugin_verification: PluginVerification | None):
        """
        Check the plugin installation scope
        """
        features = FeatureService.get_system_features()

        match features.plugin_installation_permission.plugin_installation_scope:
            case PluginInstallationScope.OFFICIAL_ONLY:
                if (
                    plugin_verification is None
                    or plugin_verification.authorized_category != PluginVerification.AuthorizedCategory.Langgenius
                ):
                    raise PluginInstallationForbiddenError("Plugin installation is restricted to official only")
            case PluginInstallationScope.OFFICIAL_AND_SPECIFIC_PARTNERS:
                if plugin_verification is None or plugin_verification.authorized_category not in [
                    PluginVerification.AuthorizedCategory.Langgenius,
                    PluginVerification.AuthorizedCategory.Partner,
                ]:
                    raise PluginInstallationForbiddenError(
                        "Plugin installation is restricted to official and specific partners"
                    )
            case PluginInstallationScope.NONE:
                raise PluginInstallationForbiddenError("Installing plugins is not allowed")
            case PluginInstallationScope.ALL:
                pass

    @staticmethod
    def get_debugging_key(tenant_id: str) -> str:
        """
        get the debugging key of the tenant
        """
        manager = PluginDebuggingClient()
        return manager.get_debugging_key(tenant_id)

    @staticmethod
    def list_latest_versions(plugin_ids: Sequence[str]) -> Mapping[str, LatestPluginCache | None]:
        """
        List the latest versions of the plugins
        """
        return PluginService.fetch_latest_plugin_version(plugin_ids)

    @staticmethod
    def list(tenant_id: str) -> list[PluginEntity]:
        """
        list all plugins of the tenant
        """
        manager = PluginInstaller()
        plugins = manager.list_plugins(tenant_id)
        return plugins

    @staticmethod
    def list_with_total(tenant_id: str, user_id: str, page: int, page_size: int) -> PluginListResponse:
        """List tenant plugins with endpoint counts reconciled from live records.

        The plugin daemon's ``management/list`` payload is tenant-scoped, but
        some daemon builds undercount or stale-cache plugin endpoint aggregates.
        The list response therefore refreshes counters from the daemon's
        tenant-scoped endpoint records before returning workspace plugin metadata.
        """
        manager = PluginInstaller()
        plugins = manager.list_plugins_with_total(tenant_id, page, page_size)
        PluginService._reconcile_endpoint_counts(tenant_id, user_id, plugins.list)
        return plugins

    @staticmethod
    def list_by_category(
        tenant_id: str, category: PluginCategory, page: int, page_size: int
    ) -> PluginListWithoutTotalResponse:
        """
        List plugins in one category with a has-more cursor signal and without calculating total.

        The daemon scans tenant installations in the existing list order and stops once it finds one extra match.
        This keeps pagination usable before category is persisted on installation rows.
        """
        manager = PluginInstaller()
        return manager.list_plugins_by_category(tenant_id, category, page, page_size)

    @staticmethod
    def _normalize_endpoint_count(value: object) -> int:
        """Convert daemon endpoint counters to safe non-negative integers.

        Some daemon builds use ``-1`` as an "unknown / not synced yet" sentinel
        for endpoint counters. That value is acceptable internally as a daemon
        transport detail, but it must never leak through the console API because
        the UI displays these counters directly.
        """
        if value is None:
            return 0

        if isinstance(value, bool):
            return int(value)

        if isinstance(value, int):
            return max(0, value)

        if isinstance(value, str):
            try:
                return max(0, int(value))
            except ValueError:
                return 0

        return 0

    @classmethod
    def _normalize_plugin_endpoint_counts(cls, plugin: PluginEntity) -> None:
        """Clamp endpoint counters on plugin entities before returning them."""
        plugin.endpoints_setups = cls._normalize_endpoint_count(plugin.endpoints_setups)
        plugin.endpoints_active = cls._normalize_endpoint_count(plugin.endpoints_active)

    @classmethod
    def _reconcile_endpoint_counts(cls, tenant_id: str, user_id: str, plugins: Sequence[PluginEntity]) -> None:
        """Refresh endpoint counters from live plugin endpoint records.

        ``management/list`` is the source of truth for plugin installations, but
        some daemon versions lag when populating ``endpoints_setups`` and
        ``endpoints_active``. The plugin-scoped endpoint listing is the same
        tenant-scoped source the console detail panel uses after reinstall flows,
        so the list view recomputes counts per plugin instead of trusting stale
        daemon aggregates.
        """
        endpoint_client = PluginEndpointClient()

        for plugin in plugins:
            cls._normalize_plugin_endpoint_counts(plugin)

            if plugin.declaration.endpoint is None:
                continue

            page = 1
            endpoints_setups = 0
            endpoints_active = 0

            try:
                while True:
                    endpoints = endpoint_client.list_endpoints_for_single_plugin(
                        tenant_id=tenant_id,
                        user_id=user_id,
                        plugin_id=plugin.plugin_id,
                        page=page,
                        page_size=cls.ENDPOINT_RECONCILIATION_PAGE_SIZE,
                    )
                    endpoints_setups += len(endpoints)
                    endpoints_active += sum(int(endpoint.enabled) for endpoint in endpoints)

                    if len(endpoints) < cls.ENDPOINT_RECONCILIATION_PAGE_SIZE:
                        break
                    page += 1
            except Exception:
                logger.warning(
                    (
                        "Failed to reconcile live endpoint counters for tenant %s plugin %s; "
                        "falling back to daemon plugin stats."
                    ),
                    tenant_id,
                    plugin.plugin_id,
                    exc_info=True,
                )
                continue

            plugin.endpoints_setups = cls._normalize_endpoint_count(endpoints_setups)
            plugin.endpoints_active = cls._normalize_endpoint_count(endpoints_active)

    @staticmethod
    def list_installations_from_ids(tenant_id: str, ids: Sequence[str]) -> Sequence[PluginInstallation]:
        """
        List plugin installations from ids
        """
        manager = PluginInstaller()
        return manager.fetch_plugin_installation_by_ids(tenant_id, ids)

    @classmethod
    def get_plugin_icon_url(cls, tenant_id: str, filename: str) -> str:
        url_prefix = (
            URL(dify_config.CONSOLE_API_URL or "/") / "console" / "api" / "workspaces" / "current" / "plugin" / "icon"
        )
        return str(url_prefix % {"tenant_id": tenant_id, "filename": filename})

    @staticmethod
    def get_asset(tenant_id: str, asset_file: str) -> tuple[bytes, str]:
        """
        get the asset file of the plugin
        """
        manager = PluginAssetManager()
        # guess mime type
        mime_type, _ = guess_type(asset_file)
        return manager.fetch_asset(tenant_id, asset_file), mime_type or "application/octet-stream"

    @staticmethod
    def extract_asset(tenant_id: str, plugin_unique_identifier: str, file_name: str) -> bytes:
        manager = PluginAssetManager()
        return manager.extract_asset(tenant_id, plugin_unique_identifier, file_name)

    @staticmethod
    def check_plugin_unique_identifier(tenant_id: str, plugin_unique_identifier: str) -> bool:
        """
        check if the plugin unique identifier is already installed by other tenant
        """
        manager = PluginInstaller()
        return manager.fetch_plugin_by_identifier(tenant_id, plugin_unique_identifier)

    @staticmethod
    def fetch_plugin_manifest(tenant_id: str, plugin_unique_identifier: str) -> PluginDeclaration:
        """
        Fetch plugin manifest
        """
        manager = PluginInstaller()
        return manager.fetch_plugin_manifest(tenant_id, plugin_unique_identifier)

    @staticmethod
    def is_plugin_verified(tenant_id: str, plugin_unique_identifier: str) -> bool:
        """
        Check if the plugin is verified
        """
        manager = PluginInstaller()
        try:
            return manager.fetch_plugin_manifest(tenant_id, plugin_unique_identifier).verified
        except Exception:
            return False

    @staticmethod
    def fetch_install_tasks(tenant_id: str, page: int, page_size: int) -> Sequence[PluginInstallTask]:
        """
        Fetch plugin installation tasks
        """
        manager = PluginInstaller()
        tasks = manager.fetch_plugin_installation_tasks(tenant_id, page, page_size)
        if any(task.status in PluginService.PLUGIN_INSTALL_TASK_TERMINAL_STATUSES for task in tasks):
            PluginService.invalidate_plugin_model_providers_cache(tenant_id)
        return tasks

    @staticmethod
    def fetch_install_task(tenant_id: str, task_id: str) -> PluginInstallTask:
        manager = PluginInstaller()
        task = manager.fetch_plugin_installation_task(tenant_id, task_id)
        if task.status in PluginService.PLUGIN_INSTALL_TASK_TERMINAL_STATUSES:
            PluginService.invalidate_plugin_model_providers_cache(tenant_id)
        return task

    @staticmethod
    def delete_install_task(tenant_id: str, task_id: str) -> bool:
        """
        Delete a plugin installation task
        """
        manager = PluginInstaller()
        return manager.delete_plugin_installation_task(tenant_id, task_id)

    @staticmethod
    def delete_all_install_task_items(
        tenant_id: str,
    ) -> bool:
        """
        Delete all plugin installation task items
        """
        manager = PluginInstaller()
        return manager.delete_all_plugin_installation_task_items(tenant_id)

    @staticmethod
    def delete_install_task_item(tenant_id: str, task_id: str, identifier: str) -> bool:
        """
        Delete a plugin installation task item
        """
        manager = PluginInstaller()
        return manager.delete_plugin_installation_task_item(tenant_id, task_id, identifier)

    @staticmethod
    def upgrade_plugin_with_marketplace(
        tenant_id: str, original_plugin_unique_identifier: str, new_plugin_unique_identifier: str
    ):
        """
        Upgrade plugin with marketplace
        """
        if not dify_config.MARKETPLACE_ENABLED:
            raise ValueError("marketplace is not enabled")

        if original_plugin_unique_identifier == new_plugin_unique_identifier:
            raise ValueError("you should not upgrade plugin with the same plugin")

        # check if plugin pkg is already downloaded
        manager = PluginInstaller()

        features = FeatureService.get_system_features()

        try:
            manager.fetch_plugin_manifest(tenant_id, new_plugin_unique_identifier)
            # already downloaded, skip, and record install event
            marketplace.record_install_plugin_event(new_plugin_unique_identifier)
        except Exception:
            # plugin not installed, download and upload pkg
            pkg = download_plugin_pkg(new_plugin_unique_identifier)
            response = manager.upload_pkg(
                tenant_id,
                pkg,
                verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only,
            )

            # check if the plugin is available to install
            PluginService._check_plugin_installation_scope(response.verification)

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
        return result

    @staticmethod
    def upgrade_plugin_with_github(
        tenant_id: str,
        original_plugin_unique_identifier: str,
        new_plugin_unique_identifier: str,
        repo: str,
        version: str,
        package: str,
    ):
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
        return result

    @staticmethod
    def upload_pkg(tenant_id: str, pkg: bytes, verify_signature: bool = False) -> PluginDecodeResponse:
        """
        Upload plugin package files

        returns: plugin_unique_identifier
        """
        PluginService._check_marketplace_only_permission()
        manager = PluginInstaller()
        features = FeatureService.get_system_features()
        response = manager.upload_pkg(
            tenant_id,
            pkg,
            verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only,
        )
        PluginService._check_plugin_installation_scope(response.verification)

        return response

    @staticmethod
    def upload_pkg_from_github(
        tenant_id: str, repo: str, version: str, package: str, verify_signature: bool = False
    ) -> PluginDecodeResponse:
        """
        Install plugin from github release package files,
        returns plugin_unique_identifier
        """
        PluginService._check_marketplace_only_permission()
        pkg = download_with_size_limit(
            f"https://github.com/{repo}/releases/download/{version}/{package}", dify_config.PLUGIN_MAX_PACKAGE_SIZE
        )
        features = FeatureService.get_system_features()

        manager = PluginInstaller()
        response = manager.upload_pkg(
            tenant_id,
            pkg,
            verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only,
        )
        PluginService._check_plugin_installation_scope(response.verification)

        return response

    @staticmethod
    def upload_bundle(
        tenant_id: str, bundle: bytes, verify_signature: bool = False
    ) -> Sequence[PluginBundleDependency]:
        """
        Upload a plugin bundle and return the dependencies.
        """
        manager = PluginInstaller()
        PluginService._check_marketplace_only_permission()
        return manager.upload_bundle(tenant_id, bundle, verify_signature)

    @staticmethod
    def install_from_local_pkg(tenant_id: str, plugin_unique_identifiers: Sequence[str]):
        PluginService._check_marketplace_only_permission()

        manager = PluginInstaller()

        for plugin_unique_identifier in plugin_unique_identifiers:
            resp = manager.decode_plugin_from_identifier(tenant_id, plugin_unique_identifier)
            PluginService._check_plugin_installation_scope(resp.verification)

        result = manager.install_from_identifiers(
            tenant_id,
            plugin_unique_identifiers,
            PluginInstallationSource.Package,
            [{}],
        )
        PluginService.invalidate_plugin_model_providers_cache(tenant_id)
        return result

    @staticmethod
    def install_from_github(tenant_id: str, plugin_unique_identifier: str, repo: str, version: str, package: str):
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
        return result

    @staticmethod
    def fetch_marketplace_pkg(tenant_id: str, plugin_unique_identifier: str) -> PluginDeclaration:
        """
        Fetch marketplace package
        """
        if not dify_config.MARKETPLACE_ENABLED:
            raise ValueError("marketplace is not enabled")

        features = FeatureService.get_system_features()

        manager = PluginInstaller()
        try:
            declaration = manager.fetch_plugin_manifest(tenant_id, plugin_unique_identifier)
        except Exception:
            pkg = download_plugin_pkg(plugin_unique_identifier)
            response = manager.upload_pkg(
                tenant_id,
                pkg,
                verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only,
            )
            # check if the plugin is available to install
            PluginService._check_plugin_installation_scope(response.verification)
            declaration = response.manifest

        return declaration

    @staticmethod
    def install_from_marketplace_pkg(tenant_id: str, plugin_unique_identifiers: Sequence[str]):
        """
        Install plugin from marketplace package files,
        returns installation task id
        """
        if not dify_config.MARKETPLACE_ENABLED:
            raise ValueError("marketplace is not enabled")

        manager = PluginInstaller()

        # collect actual plugin_unique_identifiers
        actual_plugin_unique_identifiers = []
        metas = []
        features = FeatureService.get_system_features()

        # check if already downloaded
        for plugin_unique_identifier in plugin_unique_identifiers:
            try:
                manager.fetch_plugin_manifest(tenant_id, plugin_unique_identifier)
                plugin_decode_response = manager.decode_plugin_from_identifier(tenant_id, plugin_unique_identifier)
                # check if the plugin is available to install
                PluginService._check_plugin_installation_scope(plugin_decode_response.verification)
                # already downloaded, skip
                actual_plugin_unique_identifiers.append(plugin_unique_identifier)
                metas.append({"plugin_unique_identifier": plugin_unique_identifier})
            except Exception:
                # plugin not installed, download and upload pkg
                pkg = download_plugin_pkg(plugin_unique_identifier)
                response = manager.upload_pkg(
                    tenant_id,
                    pkg,
                    verify_signature=features.plugin_installation_permission.restrict_to_marketplace_only,
                )
                # check if the plugin is available to install
                PluginService._check_plugin_installation_scope(response.verification)
                # use response plugin_unique_identifier
                actual_plugin_unique_identifiers.append(response.unique_identifier)
                metas.append({"plugin_unique_identifier": response.unique_identifier})

        result = manager.install_from_identifiers(
            tenant_id,
            actual_plugin_unique_identifiers,
            PluginInstallationSource.Marketplace,
            metas,
        )
        PluginService.invalidate_plugin_model_providers_cache(tenant_id)
        return result

    @staticmethod
    def uninstall(tenant_id: str, plugin_installation_id: str) -> bool:
        manager = PluginInstaller()

        # Get plugin info before uninstalling to delete associated credentials
        plugins = manager.list_plugins(tenant_id)
        plugin = next((p for p in plugins if p.installation_id == plugin_installation_id), None)

        if not plugin:
            result = manager.uninstall(tenant_id, plugin_installation_id)
            if result:
                PluginService.invalidate_plugin_model_providers_cache(tenant_id)
            return result

        if dify_config.ENTERPRISE_ENABLED:
            PluginManagerService.try_pre_uninstall_plugin(
                PreUninstallPluginRequest(
                    tenant_id=tenant_id,
                    plugin_unique_identifier=plugin.plugin_unique_identifier,
                )
            )
        with Session(db.engine) as session, session.begin():
            plugin_id = plugin.plugin_id
            logger.info("Deleting credentials for plugin: %s", plugin_id)

            session.execute(
                delete(TenantPreferredModelProvider).where(
                    TenantPreferredModelProvider.tenant_id == tenant_id,
                    TenantPreferredModelProvider.provider_name.like(f"{plugin_id}/%"),
                )
            )

            # Delete provider credentials that match this plugin
            credential_ids = session.scalars(
                select(ProviderCredential.id).where(
                    ProviderCredential.tenant_id == tenant_id,
                    ProviderCredential.provider_name.like(f"{plugin_id}/%"),
                )
            ).all()

            if not credential_ids:
                logger.info("No credentials found for plugin: %s", plugin_id)
            else:
                provider_ids = session.scalars(
                    select(Provider.id).where(
                        Provider.tenant_id == tenant_id,
                        Provider.provider_name.like(f"{plugin_id}/%"),
                        Provider.credential_id.in_(credential_ids),
                    )
                ).all()

                session.execute(update(Provider).where(Provider.id.in_(provider_ids)).values(credential_id=None))

                for provider_id in provider_ids:
                    ProviderCredentialsCache(
                        tenant_id=tenant_id,
                        identity_id=provider_id,
                        cache_type=ProviderCredentialsCacheType.PROVIDER,
                    ).delete()

                session.execute(
                    delete(ProviderCredential).where(
                        ProviderCredential.id.in_(credential_ids),
                    )
                )

                logger.info(
                    "Completed deleting credentials and cleaning provider associations for plugin: %s",
                    plugin_id,
                )

        result = manager.uninstall(tenant_id, plugin_installation_id)
        if result:
            PluginService.invalidate_plugin_model_providers_cache(tenant_id)
        return result

    @staticmethod
    def check_tools_existence(tenant_id: str, provider_ids: Sequence[GenericProviderID]) -> Sequence[bool]:
        """
        Check if the tools exist
        """
        manager = PluginInstaller()
        return manager.check_tools_existence(tenant_id, provider_ids)

    @staticmethod
    def fetch_plugin_readme(tenant_id: str, plugin_unique_identifier: str, language: str) -> str:
        """
        Fetch plugin readme
        """
        manager = PluginInstaller()
        return manager.fetch_plugin_readme(tenant_id, plugin_unique_identifier, language)
