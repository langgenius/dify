"""Load real plugin declarations over HTTP and exercise the actual context cache."""

import json
from concurrent.futures import ThreadPoolExecutor
from contextvars import Context
from http import HTTPStatus
from threading import Lock
from urllib.parse import urlsplit

import pytest
from pydantic import ValidationError

import contexts
from core.plugin.impl.exc import PluginDaemonInternalServerError, PluginNotFoundError
from core.plugin.impl.trigger import PluginTriggerClient
from models.provider_ids import TriggerProviderID
from services.trigger.provider_loader import PluginTriggerProviderLoader
from tests.unit_tests.controllers.console.workspace import (
    test_trigger_oauth_client,
    test_trigger_provider_query,
    test_trigger_subscription_builder,
)
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _PROVIDER, _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_provider_query import _Daemon, _provider
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon as _PausingDaemon

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness
daemon = test_trigger_provider_query.daemon
pausing_daemon = test_trigger_subscription_builder.daemon


def test_context_cache_reuses_provider_only_within_its_tenant(harness: _Harness, daemon: _Daemon) -> None:
    loader = PluginTriggerProviderLoader(client=PluginTriggerClient())
    context = Context()
    provider_id = TriggerProviderID(_PROVIDER)

    first = context.run(loader.get_trigger_provider, harness.tenant_id, provider_id)
    repeated = context.run(loader.get_trigger_provider, harness.tenant_id, provider_id)
    other = context.run(loader.get_trigger_provider, "another-workspace", provider_id)

    assert repeated is first
    assert other is not first
    assert first.tenant_id == harness.tenant_id
    assert other.tenant_id == "another-workspace"
    assert [urlsplit(request.path).path for request in daemon.requests] == [
        f"/plugin/{harness.tenant_id}/management/trigger",
        "/plugin/another-workspace/management/trigger",
    ]


def test_separate_contexts_reload_provider_packages(harness: _Harness, daemon: _Daemon) -> None:
    loader = PluginTriggerProviderLoader(client=PluginTriggerClient())
    provider_id = TriggerProviderID(_PROVIDER)
    first = Context().run(loader.get_trigger_provider, harness.tenant_id, provider_id)
    replacement = _provider()
    replacement["plugin_unique_identifier"] = "langgenius/github:2.0.0@replacement"
    daemon.response = replacement

    second = Context().run(loader.get_trigger_provider, harness.tenant_id, provider_id)

    assert first is not second
    assert first.plugin_unique_identifier != second.plugin_unique_identifier
    assert second.plugin_unique_identifier == replacement["plugin_unique_identifier"]
    assert len(daemon.requests) == 2


def test_concurrent_lookups_share_one_fetch(harness: _Harness, pausing_daemon: _PausingDaemon) -> None:
    loader = PluginTriggerProviderLoader(client=PluginTriggerClient())
    provider_id = TriggerProviderID(_PROVIDER)
    context = Context()
    context.run(contexts.plugin_trigger_providers.set, {})
    context.run(contexts.plugin_trigger_providers_lock.set, Lock())
    pausing_daemon.pause_path = (
        f"/plugin/{harness.tenant_id}/management/trigger?provider=github&plugin_id=langgenius%2Fgithub"
    )

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(context.copy().run, loader.get_trigger_provider, harness.tenant_id, provider_id)
        try:
            assert pausing_daemon.request_started.wait(timeout=5)
            second = executor.submit(context.copy().run, loader.get_trigger_provider, harness.tenant_id, provider_id)
        finally:
            pausing_daemon.resume_response.set()
        assert first.result(timeout=5) is second.result(timeout=5)

    assert len(pausing_daemon.requests) == 1


def test_list_skips_invalid_provider_ids_without_losing_valid_providers(harness: _Harness, daemon: _Daemon) -> None:
    invalid = _provider()
    invalid["provider"] = "invalid/provider/id/parts"
    daemon.response = [invalid, _provider()]

    providers = PluginTriggerProviderLoader(client=PluginTriggerClient()).list_plugin_trigger_providers(
        harness.tenant_id
    )

    assert len(providers) == 1
    assert str(providers[0].provider_id) == _PROVIDER
    assert len(daemon.requests) == 1


def test_missing_plugin_preserves_cause_and_retries_after_failure(
    harness: _Harness, pausing_daemon: _PausingDaemon
) -> None:
    loader = PluginTriggerProviderLoader(client=PluginTriggerClient())
    context = Context()
    pausing_daemon.get_response_code = -500
    pausing_daemon.get_response_message = json.dumps({"error_type": "PluginNotFoundError", "message": "removed"})

    with pytest.raises(ValueError, match="not found") as error:
        context.run(loader.get_trigger_provider, harness.tenant_id, TriggerProviderID(_PROVIDER))
    assert isinstance(error.value.__cause__, PluginNotFoundError)

    pausing_daemon.get_response_code = 0
    provider = context.run(loader.get_trigger_provider, harness.tenant_id, TriggerProviderID(_PROVIDER))
    assert str(provider.provider_id) == _PROVIDER
    assert len(pausing_daemon.requests) == 2


def test_daemon_failure_is_not_replaced_by_not_found(harness: _Harness, daemon: _Daemon) -> None:
    daemon.status = HTTPStatus.SERVICE_UNAVAILABLE

    with pytest.raises(PluginDaemonInternalServerError):
        Context().run(
            PluginTriggerProviderLoader(client=PluginTriggerClient()).get_trigger_provider,
            harness.tenant_id,
            TriggerProviderID(_PROVIDER),
        )


def test_malformed_declaration_preserves_transport_error_and_validation_cause(
    harness: _Harness, daemon: _Daemon
) -> None:
    daemon.response = {"declaration": {}}

    with pytest.raises(ValueError, match="Failed to parse response") as error:
        Context().run(
            PluginTriggerProviderLoader(client=PluginTriggerClient()).get_trigger_provider,
            harness.tenant_id,
            TriggerProviderID(_PROVIDER),
        )
    assert isinstance(error.value.__cause__, ValidationError)
