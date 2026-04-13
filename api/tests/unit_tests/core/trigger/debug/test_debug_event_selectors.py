"""
Tests for core.trigger.debug.event_selectors.

Covers: Plugin/Webhook/Schedule pollers, create_event_poller factory,
and select_trigger_debug_events orchestrator.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from graphon.enums import BuiltinNodeTypes, NodeType

from core.plugin.entities.request import TriggerInvokeEventResponse
from core.trigger.constants import (
    TRIGGER_PLUGIN_NODE_TYPE,
    TRIGGER_SCHEDULE_NODE_TYPE,
    TRIGGER_WEBHOOK_NODE_TYPE,
)
from core.trigger.debug.event_selectors import (
    PluginTriggerDebugEventPoller,
    ScheduleTriggerDebugEventPoller,
    WebhookTriggerDebugEventPoller,
    create_event_poller,
    select_trigger_debug_events,
)
from core.trigger.debug.events import PluginTriggerDebugEvent, WebhookDebugEvent
from tests.unit_tests.core.trigger.conftest import VALID_PROVIDER_ID


def _make_poller_args(node_config: dict | None = None) -> dict:
    return {
        "tenant_id": "t1",
        "user_id": "u1",
        "app_id": "a1",
        "node_config": node_config or {"data": {}},
        "node_id": "n1",
    }


def _plugin_node_config(provider_id: str = VALID_PROVIDER_ID) -> dict:
    """Valid node config for TriggerEventNodeData.model_validate."""
    return {
        "data": {
            "title": "test",
            "plugin_id": "org/testplugin",
            "provider_id": provider_id,
            "event_name": "push",
            "subscription_id": "s1",
            "plugin_unique_identifier": "uid-1",
        }
    }


class TestPluginTriggerDebugEventPoller:
    @patch("core.trigger.debug.event_selectors.TriggerDebugEventBus")
    def test_returns_workflow_args_on_success(self, mock_bus):
        event = PluginTriggerDebugEvent(
            timestamp=100,
            name="push",
            user_id="u1",
            request_id="r1",
            subscription_id="s1",
            provider_id="p1",
        )
        mock_bus.poll.return_value = event

        with patch("services.trigger.trigger_service.TriggerService") as mock_trigger_svc:
            mock_trigger_svc.invoke_trigger_event.return_value = TriggerInvokeEventResponse(
                variables={"repo": "dify"},
                cancelled=False,
            )

            poller = PluginTriggerDebugEventPoller(**_make_poller_args(_plugin_node_config()))
            result = poller.poll()

        assert result is not None
        assert result.workflow_args["inputs"] == {"repo": "dify"}

    @patch("core.trigger.debug.event_selectors.TriggerDebugEventBus")
    def test_returns_none_when_no_event(self, mock_bus):
        mock_bus.poll.return_value = None

        poller = PluginTriggerDebugEventPoller(**_make_poller_args(_plugin_node_config()))

        assert poller.poll() is None

    @patch("core.trigger.debug.event_selectors.TriggerDebugEventBus")
    def test_returns_none_when_invoke_cancelled(self, mock_bus):
        event = PluginTriggerDebugEvent(
            timestamp=100,
            name="push",
            user_id="u1",
            request_id="r1",
            subscription_id="s1",
            provider_id="p1",
        )
        mock_bus.poll.return_value = event

        with patch("services.trigger.trigger_service.TriggerService") as mock_trigger_svc:
            mock_trigger_svc.invoke_trigger_event.return_value = TriggerInvokeEventResponse(
                variables={},
                cancelled=True,
            )

            poller = PluginTriggerDebugEventPoller(**_make_poller_args(_plugin_node_config()))

            assert poller.poll() is None


class TestWebhookTriggerDebugEventPoller:
    @patch("core.trigger.debug.event_selectors.TriggerDebugEventBus")
    def test_uses_inputs_directly_when_present(self, mock_bus):
        event = WebhookDebugEvent(
            timestamp=100,
            request_id="r1",
            node_id="n1",
            payload={"inputs": {"key": "val"}, "webhook_data": {}},
        )
        mock_bus.poll.return_value = event

        poller = WebhookTriggerDebugEventPoller(**_make_poller_args())
        result = poller.poll()

        assert result is not None
        assert result.workflow_args["inputs"] == {"key": "val"}

    @patch("core.trigger.debug.event_selectors.TriggerDebugEventBus")
    def test_falls_back_to_webhook_data(self, mock_bus):
        event = WebhookDebugEvent(
            timestamp=100,
            request_id="r1",
            node_id="n1",
            payload={"webhook_data": {"body": "raw"}},
        )
        mock_bus.poll.return_value = event

        with patch("services.trigger.webhook_service.WebhookService") as mock_webhook_svc:
            mock_webhook_svc.build_workflow_inputs.return_value = {"parsed": "data"}

            poller = WebhookTriggerDebugEventPoller(**_make_poller_args())
            result = poller.poll()

        assert result is not None
        assert result.workflow_args["inputs"] == {"parsed": "data"}
        mock_webhook_svc.build_workflow_inputs.assert_called_once_with({"body": "raw"})

    @patch("core.trigger.debug.event_selectors.TriggerDebugEventBus")
    def test_returns_none_when_no_event(self, mock_bus):
        mock_bus.poll.return_value = None
        poller = WebhookTriggerDebugEventPoller(**_make_poller_args())

        assert poller.poll() is None


class TestScheduleTriggerDebugEventPoller:
    def _make_schedule_poller(self, mock_redis, mock_schedule_svc, next_run_at: datetime):
        """Set up mocks and create a schedule poller."""
        mock_redis.get.return_value = None
        mock_schedule_config = MagicMock()
        mock_schedule_config.cron_expression = "0 * * * *"
        mock_schedule_config.timezone = "UTC"
        mock_schedule_svc.to_schedule_config.return_value = mock_schedule_config
        return ScheduleTriggerDebugEventPoller(**_make_poller_args())

    @patch("core.trigger.debug.event_selectors.redis_client")
    @patch("core.trigger.debug.event_selectors.naive_utc_now")
    @patch("core.trigger.debug.event_selectors.calculate_next_run_at")
    @patch("core.trigger.debug.event_selectors.ensure_naive_utc")
    def test_returns_none_when_not_yet_due(self, mock_ensure, mock_calc, mock_now, mock_redis):
        now = datetime(2025, 1, 1, 12, 0, 0)
        next_run = datetime(2025, 1, 1, 13, 0, 0)  # future
        mock_now.return_value = now
        mock_calc.return_value = next_run
        mock_ensure.return_value = next_run
        mock_redis.get.return_value = None

        with patch("services.trigger.schedule_service.ScheduleService") as mock_schedule_svc:
            mock_schedule_config = MagicMock()
            mock_schedule_config.cron_expression = "0 * * * *"
            mock_schedule_config.timezone = "UTC"
            mock_schedule_svc.to_schedule_config.return_value = mock_schedule_config

            poller = ScheduleTriggerDebugEventPoller(**_make_poller_args())

            assert poller.poll() is None

    @patch("core.trigger.debug.event_selectors.redis_client")
    @patch("core.trigger.debug.event_selectors.naive_utc_now")
    @patch("core.trigger.debug.event_selectors.calculate_next_run_at")
    @patch("core.trigger.debug.event_selectors.ensure_naive_utc")
    def test_fires_event_when_due(self, mock_ensure, mock_calc, mock_now, mock_redis):
        now = datetime(2025, 1, 1, 14, 0, 0)
        next_run = datetime(2025, 1, 1, 12, 0, 0)  # past
        mock_now.return_value = now
        mock_calc.return_value = next_run
        mock_ensure.return_value = next_run
        mock_redis.get.return_value = None

        with patch("services.trigger.schedule_service.ScheduleService") as mock_schedule_svc:
            mock_schedule_config = MagicMock()
            mock_schedule_config.cron_expression = "0 * * * *"
            mock_schedule_config.timezone = "UTC"
            mock_schedule_svc.to_schedule_config.return_value = mock_schedule_config

            poller = ScheduleTriggerDebugEventPoller(**_make_poller_args())
            result = poller.poll()

        assert result is not None
        mock_redis.delete.assert_called_once()


class TestCreateEventPoller:
    def _workflow_with_node(self, node_type: NodeType):
        wf = MagicMock()
        wf.get_node_config_by_id.return_value = {"data": {}}
        wf.get_node_type_from_node_config.return_value = node_type
        return wf

    def test_creates_plugin_poller(self):
        wf = self._workflow_with_node(TRIGGER_PLUGIN_NODE_TYPE)
        poller = create_event_poller(wf, "t1", "u1", "a1", "n1")
        assert isinstance(poller, PluginTriggerDebugEventPoller)

    def test_creates_webhook_poller(self):
        wf = self._workflow_with_node(TRIGGER_WEBHOOK_NODE_TYPE)
        poller = create_event_poller(wf, "t1", "u1", "a1", "n1")
        assert isinstance(poller, WebhookTriggerDebugEventPoller)

    def test_creates_schedule_poller(self):
        wf = self._workflow_with_node(TRIGGER_SCHEDULE_NODE_TYPE)
        poller = create_event_poller(wf, "t1", "u1", "a1", "n1")
        assert isinstance(poller, ScheduleTriggerDebugEventPoller)

    def test_raises_for_unknown_type(self):
        wf = MagicMock()
        wf.get_node_config_by_id.return_value = {"data": {}}
        wf.get_node_type_from_node_config.return_value = BuiltinNodeTypes.START

        with pytest.raises(ValueError):
            create_event_poller(wf, "t1", "u1", "a1", "n1")

    def test_raises_when_node_config_missing(self):
        wf = MagicMock()
        wf.get_node_config_by_id.return_value = None

        with pytest.raises(ValueError):
            create_event_poller(wf, "t1", "u1", "a1", "n1")


class TestSelectTriggerDebugEvents:
    def test_returns_first_non_none_event(self):
        wf = MagicMock()
        wf.get_node_config_by_id.return_value = {"data": {}}
        wf.get_node_type_from_node_config.return_value = TRIGGER_WEBHOOK_NODE_TYPE
        app_model = MagicMock()
        app_model.tenant_id = "t1"
        app_model.id = "a1"

        with patch.object(WebhookTriggerDebugEventPoller, "poll") as mock_poll:
            expected = MagicMock()
            mock_poll.return_value = expected

            result = select_trigger_debug_events(wf, app_model, "u1", ["n1", "n2"])

            assert result is expected

    def test_returns_none_when_no_events(self):
        wf = MagicMock()
        wf.get_node_config_by_id.return_value = {"data": {}}
        wf.get_node_type_from_node_config.return_value = TRIGGER_WEBHOOK_NODE_TYPE
        app_model = MagicMock()
        app_model.tenant_id = "t1"
        app_model.id = "a1"

        with patch.object(WebhookTriggerDebugEventPoller, "poll", return_value=None):
            result = select_trigger_debug_events(wf, app_model, "u1", ["n1"])

            assert result is None
