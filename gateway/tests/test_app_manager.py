"""Tests for the lazy-build app manager."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock

import pytest

from gateway.dify.app_manager import AppManager
from gateway.dify.client import ConsoleSession, DifyClient
from gateway.errors import DifyUpstreamError, UnknownModelError
from gateway.registry import CustomerEntry, CustomerRegistry, DifyConnection, ModelEntry


def _make_customer(customer_id: str = "c-a", model_ids: tuple[str, ...] = ("m1",)) -> CustomerEntry:
    return CustomerEntry(
        sdk_key=f"bsa_{customer_id}",
        customer_id=customer_id,
        dify=DifyConnection(
            base_url=f"http://dify-{customer_id}",
            console_email="admin@x",
            console_password="pw",
            dataset_api_key="ds",
        ),
        models=[
            ModelEntry(id=mid, provider="prov", name="n", completion_params={}) for mid in model_ids
        ],
    )


class FakeDifyClient:
    """Hand-rolled async fake for DifyClient (uses ConsoleSession).

    Tracks all calls; ``script_*`` attrs control return values / failures.
    """

    def __init__(self) -> None:
        self.login_calls: list[tuple[str, str]] = []
        self.import_calls: list[tuple[ConsoleSession, str]] = []
        self.api_key_calls: list[tuple[ConsoleSession, str]] = []
        self.delete_calls: list[tuple[ConsoleSession, str]] = []

        self.session_seq = iter(
            [
                ConsoleSession(access_token="acc-1", csrf_token="csrf-1"),
                ConsoleSession(access_token="acc-2", csrf_token="csrf-2"),
                ConsoleSession(access_token="acc-3", csrf_token="csrf-3"),
            ]
        )
        self.app_id_seq = iter(["app-1", "app-2", "app-3", "app-4"])
        self.app_key_seq = iter(["app-key-1", "app-key-2", "app-key-3", "app-key-4"])

        # Scripted failures (one-shot). Set to True to make the next
        # ``console_import_app`` raise an auth-shaped error.
        self.fail_next_import_with_auth: bool = False

    async def console_login(self, email: str, password: str) -> ConsoleSession:
        self.login_calls.append((email, password))
        return next(self.session_seq)

    async def console_import_app(self, session: ConsoleSession, yaml_content: str) -> str:
        self.import_calls.append((session, yaml_content))
        if self.fail_next_import_with_auth:
            self.fail_next_import_with_auth = False
            raise DifyUpstreamError("Dify returned HTTP 401: token expired")
        return next(self.app_id_seq)

    async def console_create_app_api_key(self, session: ConsoleSession, app_id: str) -> str:
        self.api_key_calls.append((session, app_id))
        return next(self.app_key_seq)

    async def console_delete_app(self, session: ConsoleSession, app_id: str) -> None:
        self.delete_calls.append((session, app_id))


@pytest.fixture
def customer() -> CustomerEntry:
    return _make_customer()


@pytest.fixture
def registry(customer: CustomerEntry) -> CustomerRegistry:
    return CustomerRegistry.from_entries([customer])


@pytest.fixture
def fake_client() -> FakeDifyClient:
    return FakeDifyClient()


@pytest.fixture
def manager(registry: CustomerRegistry, fake_client: FakeDifyClient) -> AppManager:
    def factory(_: CustomerEntry) -> DifyClient:  # type: ignore[return-value]
        return fake_client  # type: ignore[return-value]

    return AppManager(
        registry=registry,
        client_factory=factory,
        ttl_s=60,
        gc_interval_s=3600,
    )


@pytest.mark.asyncio
async def test_first_call_builds_app(manager: AppManager, customer: CustomerEntry, fake_client: FakeDifyClient) -> None:
    key = await manager.get_app_key(customer, "m1")
    assert key == "app-key-1"
    assert len(fake_client.login_calls) == 1
    assert len(fake_client.import_calls) == 1
    assert len(fake_client.api_key_calls) == 1


@pytest.mark.asyncio
async def test_second_call_hits_cache(manager: AppManager, customer: CustomerEntry, fake_client: FakeDifyClient) -> None:
    k1 = await manager.get_app_key(customer, "m1")
    k2 = await manager.get_app_key(customer, "m1")
    assert k1 == k2 == "app-key-1"
    assert len(fake_client.import_calls) == 1  # not rebuilt


@pytest.mark.asyncio
async def test_unknown_model_raises(manager: AppManager, customer: CustomerEntry) -> None:
    with pytest.raises(UnknownModelError, match="m99"):
        await manager.get_app_key(customer, "m99")


@pytest.mark.asyncio
async def test_concurrent_first_calls_build_once(
    manager: AppManager, customer: CustomerEntry, fake_client: FakeDifyClient
) -> None:
    """Two coroutines racing for the same (customer, model) build a single App."""
    results = await asyncio.gather(
        manager.get_app_key(customer, "m1"),
        manager.get_app_key(customer, "m1"),
        manager.get_app_key(customer, "m1"),
    )
    assert results[0] == results[1] == results[2] == "app-key-1"
    assert len(fake_client.import_calls) == 1


@pytest.mark.asyncio
async def test_different_models_build_separate_apps(
    fake_client: FakeDifyClient,
) -> None:
    customer = _make_customer(model_ids=("ma", "mb"))
    registry = CustomerRegistry.from_entries([customer])

    def factory(_: CustomerEntry) -> DifyClient:  # type: ignore[return-value]
        return fake_client  # type: ignore[return-value]

    manager = AppManager(registry=registry, client_factory=factory, ttl_s=60, gc_interval_s=3600)

    ka = await manager.get_app_key(customer, "ma")
    kb = await manager.get_app_key(customer, "mb")
    assert ka != kb
    assert len(fake_client.import_calls) == 2


@pytest.mark.asyncio
async def test_session_refresh_on_auth_failure(
    manager: AppManager, customer: CustomerEntry, fake_client: FakeDifyClient
) -> None:
    """An auth-shaped error during build triggers re-login + retry."""
    fake_client.fail_next_import_with_auth = True

    key = await manager.get_app_key(customer, "m1")
    assert key == "app-key-1"
    # Two import attempts: one failed (raised before consuming app_id_seq),
    # one succeeded.
    assert len(fake_client.import_calls) == 2
    # Two logins: initial + refresh.
    assert len(fake_client.login_calls) == 2
    # First import used the initial session, second used the refreshed one.
    assert fake_client.import_calls[0][0].access_token == "acc-1"
    assert fake_client.import_calls[1][0].access_token == "acc-2"


@pytest.mark.asyncio
async def test_gc_evicts_idle_entries(
    registry: CustomerRegistry, customer: CustomerEntry, fake_client: FakeDifyClient
) -> None:
    """Entries idle longer than ttl_s get deleted from cache + Dify."""
    # Fake clock so we can advance time deterministically.
    now = [1000.0]

    def factory(_: CustomerEntry) -> DifyClient:  # type: ignore[return-value]
        return fake_client  # type: ignore[return-value]

    manager = AppManager(
        registry=registry,
        client_factory=factory,
        ttl_s=60,
        gc_interval_s=3600,
        clock=lambda: now[0],
    )

    await manager.get_app_key(customer, "m1")
    assert len(manager.cached_apps()) == 1

    # Advance past TTL and run a sweep.
    now[0] += 120.0
    await manager._gc_sweep()  # noqa: SLF001 (test-only)

    assert len(manager.cached_apps()) == 0
    assert len(fake_client.delete_calls) == 1
    deleted_session, deleted_app_id = fake_client.delete_calls[0]
    assert deleted_app_id == "app-1"
    assert deleted_session.access_token == "acc-1"


@pytest.mark.asyncio
async def test_gc_keeps_recently_used_entries(
    registry: CustomerRegistry, customer: CustomerEntry, fake_client: FakeDifyClient
) -> None:
    now = [1000.0]

    def factory(_: CustomerEntry) -> DifyClient:  # type: ignore[return-value]
        return fake_client  # type: ignore[return-value]

    manager = AppManager(
        registry=registry, client_factory=factory, ttl_s=60, gc_interval_s=3600, clock=lambda: now[0]
    )

    await manager.get_app_key(customer, "m1")
    now[0] += 30.0  # within TTL
    await manager._gc_sweep()  # noqa: SLF001

    assert len(manager.cached_apps()) == 1
    assert fake_client.delete_calls == []


@pytest.mark.asyncio
async def test_gc_swallows_delete_errors(
    registry: CustomerRegistry, customer: CustomerEntry
) -> None:
    """If Dify delete fails, GC still removes the cache entry (no crash)."""
    flaky = FakeDifyClient()

    async def boom(*_: Any, **__: Any) -> None:
        raise DifyUpstreamError("503 service unavailable")

    flaky.console_delete_app = boom  # type: ignore[assignment]

    now = [1000.0]

    def factory(_: CustomerEntry) -> DifyClient:  # type: ignore[return-value]
        return flaky  # type: ignore[return-value]

    manager = AppManager(
        registry=registry, client_factory=factory, ttl_s=60, gc_interval_s=3600, clock=lambda: now[0]
    )
    await manager.get_app_key(customer, "m1")
    now[0] += 120.0
    # Should NOT raise.
    await manager._gc_sweep()  # noqa: SLF001
    assert len(manager.cached_apps()) == 0
