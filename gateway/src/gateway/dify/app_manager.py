"""Lazy-build + cache + GC for per-(customer, model) Dify Apps.

The gateway routes each chat request to a Dify App that bakes in the chosen
LLM model. Because Dify's ``chat-messages`` API does not accept runtime model
overrides, we materialize one App per ``(customer_id, model_id)`` on first use
and cache the resulting App API key.

Lifecycle:
    1. ``get_app_key(customer, model)`` returns the cached App key, or…
    2. …acquires a per-key asyncio lock and builds a fresh App (login →
       DSL import → api-key creation), caches it, and returns the key.
    3. A background sweep evicts entries idle for ``ttl_s`` seconds, deleting
       the corresponding Dify Apps. Errors during GC are logged and swallowed.

JWT lifecycle:
    Console JWTs expire (Dify default ~30 min). We re-login lazily when an
    operation raises a 401-shaped DifyUpstreamError; ``_with_jwt`` wraps each
    console call with one retry-on-auth-failure.

Concurrency notes:
    * Per-key locks prevent duplicate Apps when two requests race for the same
      ``(customer, model)`` pair.
    * The cache is a plain dict guarded by per-key locks; reads are atomic in
      CPython but writes go through the lock to avoid lost updates.
    * The GC task is cooperative: it walks a snapshot of keys, then locks each
      individually before evicting.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Awaitable, Callable

import structlog

from gateway.dify.client import DifyClient
from gateway.dify.dsl import build_chat_app_dsl
from gateway.errors import DifyUpstreamError, UnknownModelError
from gateway.registry import CustomerEntry, CustomerRegistry, ModelEntry

logger = structlog.get_logger(__name__)


# Substring used to recognise JWT-expiry style upstream errors. Dify replies
# 401 with ``{"code":"unauthorized",...}``; we are tolerant about exact shape.
_AUTH_FAILURE_HINTS: tuple[str, ...] = ("401", "unauthorized", "expired")


@dataclass
class CachedApp:
    """One Dify App provisioned for a ``(customer_id, model_id)`` pair."""

    customer_id: str
    model_id: str
    app_id: str
    app_key: str
    created_at: float = field(default_factory=time.time)
    last_used_at: float = field(default_factory=time.time)


@dataclass
class _CachedJwt:
    token: str
    obtained_at: float = field(default_factory=time.time)


# Type alias for the dependency-injected client factory used by the manager.
ClientFactory = Callable[[CustomerEntry], DifyClient]


class AppManager:
    """Manages per-(customer, model) Dify Apps with lazy build + GC.

    Tests inject a ``client_factory`` to swap in fakes; production wires it to
    a function that returns a singleton :class:`DifyClient` per ``base_url``.
    """

    def __init__(
        self,
        *,
        registry: CustomerRegistry,
        client_factory: ClientFactory,
        ttl_s: int,
        gc_interval_s: int,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._registry = registry
        self._client_factory = client_factory
        self._ttl_s = ttl_s
        self._gc_interval_s = gc_interval_s
        self._clock = clock

        self._apps: dict[tuple[str, str], CachedApp] = {}
        self._jwts: dict[str, _CachedJwt] = {}

        # Per-key locks; defaultdict keeps the wiring trivial.
        self._app_locks: dict[tuple[str, str], asyncio.Lock] = defaultdict(asyncio.Lock)
        self._jwt_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

        self._gc_task: asyncio.Task[None] | None = None
        self._stopped = False

    # ------------------------------------------------------------------ #
    # Public API                                                         #
    # ------------------------------------------------------------------ #

    async def get_app_key(self, customer: CustomerEntry, model_id: str) -> str:
        """Return an App key for ``(customer, model_id)``, building if needed.

        Raises:
            UnknownModelError: ``model_id`` is not declared for the customer.
            DifyUpstreamError: build failed.
        """
        model = customer.find_model(model_id)
        if model is None:
            raise UnknownModelError(f"model '{model_id}' is not enabled for this customer")

        cache_key = (customer.customer_id, model.id)

        # Fast path: cached.
        cached = self._apps.get(cache_key)
        if cached is not None:
            cached.last_used_at = self._clock()
            return cached.app_key

        # Slow path: build under a lock.
        async with self._app_locks[cache_key]:
            # Re-check after acquiring lock (another task may have built it).
            cached = self._apps.get(cache_key)
            if cached is not None:
                cached.last_used_at = self._clock()
                return cached.app_key

            cached = await self._build_app(customer, model)
            self._apps[cache_key] = cached
            return cached.app_key

    async def start(self) -> None:
        """Launch the background GC task. Call after asyncio loop is running."""
        if self._gc_task is None:
            self._gc_task = asyncio.create_task(self._gc_loop(), name="app-manager-gc")

    async def stop(self) -> None:
        """Cancel GC and best-effort shut everything down."""
        self._stopped = True
        if self._gc_task is not None:
            self._gc_task.cancel()
            try:
                await self._gc_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._gc_task = None

    def cached_apps(self) -> dict[tuple[str, str], CachedApp]:
        """Return a *copy* of the cache (for diagnostics / metrics)."""
        return dict(self._apps)

    # ------------------------------------------------------------------ #
    # Internals                                                          #
    # ------------------------------------------------------------------ #

    async def _build_app(self, customer: CustomerEntry, model: ModelEntry) -> CachedApp:
        client = self._client_factory(customer)
        dsl = build_chat_app_dsl(
            name=f"auto:{customer.customer_id}:{model.id}",
            description=f"Auto-built by AI SDK Gateway for customer={customer.customer_id} model={model.id}",
            provider=model.provider,
            model_name=model.name,
            completion_params=model.completion_params,
            knowledge_base_ids=customer.knowledge_bases,
        )

        # Login (or refresh) → import → key
        async def import_app(jwt: str) -> str:
            return await client.console_import_app(jwt, dsl)

        app_id = await self._with_jwt(customer, client, import_app)

        async def make_key(jwt: str) -> str:
            return await client.console_create_app_api_key(jwt, app_id)

        app_key = await self._with_jwt(customer, client, make_key)

        logger.info(
            "app_manager.built",
            customer_id=customer.customer_id,
            model_id=model.id,
            app_id=app_id,
        )
        return CachedApp(
            customer_id=customer.customer_id,
            model_id=model.id,
            app_id=app_id,
            app_key=app_key,
        )

    async def _with_jwt(
        self,
        customer: CustomerEntry,
        client: DifyClient,
        op: Callable[[str], Awaitable[str]],
    ) -> str:
        """Run ``op(jwt)``; on auth-shaped failure, refresh JWT and retry once."""
        jwt = await self._get_jwt(customer, client)
        try:
            return await op(jwt)
        except DifyUpstreamError as e:
            msg = str(e).lower()
            if not any(hint in msg for hint in _AUTH_FAILURE_HINTS):
                raise
            # JWT likely expired; refresh and retry.
            jwt = await self._refresh_jwt(customer, client)
            return await op(jwt)

    async def _get_jwt(self, customer: CustomerEntry, client: DifyClient) -> str:
        cached = self._jwts.get(customer.customer_id)
        if cached is not None:
            return cached.token
        return await self._refresh_jwt(customer, client)

    async def _refresh_jwt(self, customer: CustomerEntry, client: DifyClient) -> str:
        async with self._jwt_locks[customer.customer_id]:
            # Another concurrent caller may have refreshed already.
            cached = self._jwts.get(customer.customer_id)
            if cached is not None and self._clock() - cached.obtained_at < 60:
                return cached.token
            token = await client.console_login(
                customer.dify.console_email,
                customer.dify.console_password,
            )
            self._jwts[customer.customer_id] = _CachedJwt(token=token)
            return token

    # ------------------------------------------------------------------ #
    # GC                                                                 #
    # ------------------------------------------------------------------ #

    async def _gc_loop(self) -> None:
        while not self._stopped:
            try:
                await asyncio.sleep(self._gc_interval_s)
            except asyncio.CancelledError:
                return
            try:
                await self._gc_sweep()
            except Exception:  # noqa: BLE001
                logger.exception("app_manager.gc_failed")

    async def _gc_sweep(self) -> None:
        now = self._clock()
        # Snapshot keys to avoid mutating during iteration.
        keys = list(self._apps.keys())
        for key in keys:
            cached = self._apps.get(key)
            if cached is None:
                continue
            if now - cached.last_used_at < self._ttl_s:
                continue
            await self._evict(key, cached)

    async def _evict(self, key: tuple[str, str], cached: CachedApp) -> None:
        # Lock the per-(customer,model) entry so we don't race with a builder.
        async with self._app_locks[key]:
            current = self._apps.get(key)
            if current is None or current.app_id != cached.app_id:
                return

            customer = self._registry.find_by_customer_id(cached.customer_id)
            deleted = False
            if customer is not None:
                try:
                    client = self._client_factory(customer)

                    async def delete(jwt: str) -> str:
                        await client.console_delete_app(jwt, cached.app_id)
                        return ""

                    await self._with_jwt(customer, client, delete)
                    deleted = True
                except Exception:  # noqa: BLE001
                    # GC must never crash the loop. Log and proceed to evict
                    # the cache entry anyway so the next request re-builds.
                    logger.warning(
                        "app_manager.delete_failed",
                        customer_id=cached.customer_id,
                        model_id=cached.model_id,
                        app_id=cached.app_id,
                        exc_info=True,
                    )

            logger.info(
                "app_manager.evicted",
                customer_id=cached.customer_id,
                model_id=cached.model_id,
                app_id=cached.app_id,
                age_s=round(self._clock() - cached.created_at, 1),
                dify_deleted=deleted,
            )
            self._apps.pop(key, None)

