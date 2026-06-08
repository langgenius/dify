"""
Tests for core.trigger.trigger_manager.TriggerManager.

Covers: icon URL construction, provider listing with error resilience,
double-check lock caching, error translation, EventIgnoreError -> cancelled,
and delegation to provider controller.
"""

from __future__ import annotations

from threading import Lock
from unittest.mock import MagicMock, patch

import pytest

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.entities.request import TriggerInvokeEventResponse
from core.plugin.impl.exc import PluginDaemonError, PluginNotFoundError
from core.trigger.errors import EventIgnoreError
from core.trigger.trigger_manager import TriggerManager
from models.provider_ids import TriggerProviderID
from tests.unit_tests.core.trigger.conftest import (
    VALID_PROVIDER_ID,
    make_controller,
    make_provider_entity,
    make_subscription,
)

PID = TriggerProviderID(VALID_PROVIDER_ID)
PID_STR = str(PID)


class TestGetTriggerPluginIcon:
    @patch("core.trigger.trigger_manager.dify_config")
    @patch("core.trigger.trigger_manager.PluginTriggerClient")
    def test_builds_correct_url(self, mock_client, mock_config):
        mock_config.CONSOLE_API_URL = "https://console.example.com"
        provider = MagicMock()
        provider.declaration.identity.icon = "my-icon.svg"
        mock_client.return_value.fetch_trigger_provider.return_value = provider

        url = TriggerManager.get_trigger_plugin_icon("tenant-1", VALID_PROVIDER_ID)

        assert "tenant_id=tenant-1" in url
        assert "filename=my-icon.svg" in url
        assert url.startswith("https://console.example.com/console/api/workspaces/current/plugin/icon")


class TestListPluginTriggerProviders:
    @patch("core.trigger.trigger_manager.PluginTriggerClient")
    def test_wraps_entities_into_controllers(self, mock_client):
        entity = MagicMock()
        entity.declaration = make_provider_entity("p1")
        entity.plugin_id = "plugin-1"
        entity.plugin_unique_identifier = "uid-1"
        entity.provider = VALID_PROVIDER_ID
        mock_client.return_value.fetch_trigger_providers.return_value = [entity]

        controllers = TriggerManager.list_plugin_trigger_providers("tenant-1")

        assert len(controllers) == 1
        assert controllers[0].plugin_id == "plugin-1"

    @patch("core.trigger.trigger_manager.PluginTriggerClient")
    def test_skips_failing_providers(self, mock_client):
        good = MagicMock()
        good.declaration = make_provider_entity("good")
        good.plugin_id = "good-plugin"
        good.plugin_unique_identifier = "uid-good"
        good.provider = VALID_PROVIDER_ID

        bad = MagicMock()
        bad.declaration = make_provider_entity("bad")
        bad.plugin_id = "bad-plugin"
        bad.plugin_unique_identifier = "uid-bad"
        bad.provider = "bad/format"  # 2-part: fails TriggerProviderID validation

        mock_client.return_value.fetch_trigger_providers.return_value = [bad, good]

        controllers = TriggerManager.list_plugin_trigger_providers("tenant-1")

        assert len(controllers) == 1
        assert controllers[0].plugin_id == "good-plugin"


class TestGetTriggerProvider:
    @patch("core.trigger.trigger_manager.PluginTriggerClient")
    @patch("core.trigger.trigger_manager.contexts")
    def test_initializes_context_on_first_call(self, mock_ctx, mock_client):
        # get() called 3 times: (1) try block, (2) after set, (3) under lock
        mock_ctx.plugin_trigger_providers.get.side_effect = [LookupError, {}, {}]
        mock_ctx.plugin_trigger_providers_lock.get.return_value = Lock()
        provider = MagicMock()
        provider.declaration = make_provider_entity()
        provider.plugin_id = "p1"
        provider.plugin_unique_identifier = "uid-1"
        mock_client.return_value.fetch_trigger_provider.return_value = provider

        result = TriggerManager.get_trigger_provider("t1", PID)

        mock_ctx.plugin_trigger_providers.set.assert_called_once_with({})
        mock_ctx.plugin_trigger_providers_lock.set.assert_called_once()
        assert result is not None

    @patch("core.trigger.trigger_manager.PluginTriggerClient")
    @patch("core.trigger.trigger_manager.contexts")
    def test_returns_cached_without_fetch(self, mock_ctx, mock_client):
        cached = make_controller()
        mock_ctx.plugin_trigger_providers.get.return_value = {PID_STR: cached}

        result = TriggerManager.get_trigger_provider("t1", PID)

        assert result is cached
        mock_client.return_value.fetch_trigger_provider.assert_not_called()

    @patch("core.trigger.trigger_manager.PluginTriggerClient")
    @patch("core.trigger.trigger_manager.contexts")
    def test_double_check_lock_uses_cached_from_other_thread(self, mock_ctx, mock_client):
        cached = make_controller()
        mock_ctx.plugin_trigger_providers.get.side_effect = [
            {},  # first check misses
            {PID_STR: cached},  # under-lock check hits
        ]
        mock_ctx.plugin_trigger_providers_lock.get.return_value = Lock()

        result = TriggerManager.get_trigger_provider("t1", PID)

        assert result is cached
        mock_client.return_value.fetch_trigger_provider.assert_not_called()

    @patch("core.trigger.trigger_manager.PluginTriggerClient")
    @patch("core.trigger.trigger_manager.contexts")
    def test_fetches_and_caches_on_miss(self, mock_ctx, mock_client):
        cache: dict = {}
        mock_ctx.plugin_trigger_providers.get.return_value = cache
        mock_ctx.plugin_trigger_providers_lock.get.return_value = Lock()
        provider = MagicMock()
        provider.declaration = make_provider_entity()
        provider.plugin_id = "p1"
        provider.plugin_unique_identifier = "uid-1"
        mock_client.return_value.fetch_trigger_provider.return_value = provider

        result = TriggerManager.get_trigger_provider("t1", PID)

        assert result is not None
        assert PID_STR in cache

    @patch("core.trigger.trigger_manager.PluginTriggerClient")
    @patch("core.trigger.trigger_manager.contexts")
    def test_none_fetch_raises_value_error(self, mock_ctx, mock_client):
        mock_ctx.plugin_trigger_providers.get.return_value = {}
        mock_ctx.plugin_trigger_providers_lock.get.return_value = Lock()
        mock_client.return_value.fetch_trigger_provider.return_value = None

        with pytest.raises(ValueError):
            TriggerManager.get_trigger_provider("t1", TriggerProviderID("org/plug/missing"))

    @patch("core.trigger.trigger_manager.PluginTriggerClient")
    @patch("core.trigger.trigger_manager.contexts")
    def test_plugin_not_found_becomes_value_error(self, mock_ctx, mock_client):
        mock_ctx.plugin_trigger_providers.get.return_value = {}
        mock_ctx.plugin_trigger_providers_lock.get.return_value = Lock()
        mock_client.return_value.fetch_trigger_provider.side_effect = PluginNotFoundError("gone")

        with pytest.raises(ValueError):
            TriggerManager.get_trigger_provider("t1", TriggerProviderID("org/plug/miss"))

    @patch("core.trigger.trigger_manager.PluginTriggerClient")
    @patch("core.trigger.trigger_manager.contexts")
    def test_plugin_daemon_error_propagates(self, mock_ctx, mock_client):
        mock_ctx.plugin_trigger_providers.get.return_value = {}
        mock_ctx.plugin_trigger_providers_lock.get.return_value = Lock()
        mock_client.return_value.fetch_trigger_provider.side_effect = PluginDaemonError("test error")

        with pytest.raises(PluginDaemonError):
            TriggerManager.get_trigger_provider("t1", TriggerProviderID("org/plug/miss"))


class TestListAllTriggerProviders:
    @patch.object(TriggerManager, "list_plugin_trigger_providers")
    def test_delegates_to_list_plugin(self, mock_list):
        expected = [make_controller()]
        mock_list.return_value = expected

        assert TriggerManager.list_all_trigger_providers("t1") is expected
        mock_list.assert_called_once_with("t1")


class TestListTriggersByProvider:
    @patch.object(TriggerManager, "get_trigger_provider")
    def test_returns_provider_events(self, mock_get):
        ctrl = make_controller()
        mock_get.return_value = ctrl

        result = TriggerManager.list_triggers_by_provider("t1", PID)

        assert result == ctrl.get_events()


class TestInvokeTriggerEvent:
    def _args(self):
        return {
            "tenant_id": "t1",
            "user_id": "u1",
            "provider_id": PID,
            "event_name": "on_push",
            "parameters": {"branch": "main"},
            "credentials": {"token": "abc"},
            "credential_type": CredentialType.API_KEY,
            "subscription": make_subscription(),
            "request": MagicMock(),
            "payload": {"action": "push"},
        }

    @patch.object(TriggerManager, "get_trigger_provider")
    def test_returns_invoke_response(self, mock_get):
        ctrl = MagicMock()
        expected = TriggerInvokeEventResponse(variables={"v": "1"}, cancelled=False)
        ctrl.invoke_trigger_event.return_value = expected
        mock_get.return_value = ctrl

        result = TriggerManager.invoke_trigger_event(**self._args())

        assert result is expected
        assert result.cancelled is False

    @patch.object(TriggerManager, "get_trigger_provider")
    def test_event_ignore_returns_cancelled(self, mock_get):
        ctrl = MagicMock()
        ctrl.invoke_trigger_event.side_effect = EventIgnoreError("skip")
        mock_get.return_value = ctrl

        result = TriggerManager.invoke_trigger_event(**self._args())

        assert result.cancelled is True
        assert result.variables == {}

    @patch.object(TriggerManager, "get_trigger_provider")
    def test_other_errors_propagate(self, mock_get):
        ctrl = MagicMock()
        ctrl.invoke_trigger_event.side_effect = RuntimeError("boom")
        mock_get.return_value = ctrl

        with pytest.raises(RuntimeError, match="boom"):
            TriggerManager.invoke_trigger_event(**self._args())


class TestSubscribeTrigger:
    @patch.object(TriggerManager, "get_trigger_provider")
    def test_delegates_with_correct_args(self, mock_get):
        ctrl = MagicMock()
        expected = make_subscription()
        ctrl.subscribe_trigger.return_value = expected
        mock_get.return_value = ctrl

        result = TriggerManager.subscribe_trigger(
            tenant_id="t1",
            user_id="u1",
            provider_id=PID,
            endpoint="https://hook.test",
            parameters={"f": "all"},
            credentials={"token": "x"},
            credential_type=CredentialType.API_KEY,
        )

        assert result is expected
        ctrl.subscribe_trigger.assert_called_once()


class TestUnsubscribeTrigger:
    @patch.object(TriggerManager, "get_trigger_provider")
    def test_delegates_with_correct_args(self, mock_get):
        ctrl = MagicMock()
        expected = MagicMock()
        ctrl.unsubscribe_trigger.return_value = expected
        mock_get.return_value = ctrl
        sub = make_subscription()

        result = TriggerManager.unsubscribe_trigger(
            tenant_id="t1",
            user_id="u1",
            provider_id=PID,
            subscription=sub,
            credentials={"token": "x"},
            credential_type=CredentialType.API_KEY,
        )

        assert result is expected


class TestRefreshTrigger:
    @patch.object(TriggerManager, "get_trigger_provider")
    def test_delegates_with_correct_args(self, mock_get):
        ctrl = MagicMock()
        expected = make_subscription()
        ctrl.refresh_trigger.return_value = expected
        mock_get.return_value = ctrl

        result = TriggerManager.refresh_trigger(
            tenant_id="t1",
            provider_id=PID,
            subscription=make_subscription(),
            credentials={"token": "x"},
            credential_type=CredentialType.API_KEY,
        )

        assert result is expected
