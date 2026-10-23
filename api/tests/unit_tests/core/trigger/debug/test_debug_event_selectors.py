"""
Tests for core.trigger.debug.event_selectors.

Covers: Plugin/Webhook/Schedule pollers, create_event_poller factory,
and select_trigger_debug_events orchestrator.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from typing_extensions import TypedDict

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
from graphon.entities.graph_config import NodeConfigDict
from graphon.enums import BuiltinNodeTypes, NodeType, WorkflowType
from models.model import App, AppMode
from models.workflow import Workflow
from tests.unit_tests.core.trigger.conftest import VALID_PROVIDER_ID
from tests.unit_tests.model_factories import make_app


class _PollerArgs(TypedDict, closed=True):
    tenant_id: str
    user_id: str
    app_id: str
    node_config: NodeConfigDict
    node_id: str


def _make_poller_args(node_config: dict[str, object] | None = None) -> _PollerArgs:
    return {
        "tenant_id": "t1",
        "user_id": "u1",
        "app_id": "a1",
        # The pollers only read node_config["data"]; the tests do not build a full graph node config.
        "node_config": cast(NodeConfigDict, node_config or {"data": {}}),
        "node_id": "n1",
    }


def _plugin_node_config(provider_id: str = VALID_PROVIDER_ID) -> dict[str, object]:
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


def _workflow_with_node(node_type: NodeType | None) -> Workflow:
    nodes: list[dict[str, object]] = (
        [] if node_type is None else [{"id": "n1", "data": {"type": node_type, "title": "Trigger"}}]
    )
    return Workflow.new(
        tenant_id="t1",
        app_id="a1",
        type=WorkflowType.WORKFLOW.value,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"nodes": nodes, "edges": []}),
        features="{}",
        created_by="u1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _app() -> App:
    return make_app(
        app_id="a1",
        tenant_id="t1",
        name="Trigger App",
        mode=AppMode.WORKFLOW,
        icon_type=None,
        max_active_requests=0,
    )


class TestPluginTriggerDebugEventPoller:
    @patch("core.trigger.debug.event_selectors.TriggerDebugEventBus")
    def test_returns_workflow_args_on_success(self, mock_bus: MagicMock) -> None:
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
    def test_returns_none_when_no_event(self, mock_bus: MagicMock) -> None:
        mock_bus.poll.return_value = None

        poller = PluginTriggerDebugEventPoller(**_make_poller_args(_plugin_node_config()))

        assert poller.poll() is None

    @patch("core.trigger.debug.event_selectors.TriggerDebugEventBus")
    def test_returns_none_when_invoke_cancelled(self, mock_bus: MagicMock) -> None:
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
    def test_uses_inputs_directly_when_present(self, mock_bus: MagicMock) -> None:
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
    def test_falls_back_to_webhook_data(self, mock_bus: MagicMock) -> None:
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
    def test_returns_none_when_no_event(self, mock_bus: MagicMock) -> None:
        mock_bus.poll.return_value = None
        poller = WebhookTriggerDebugEventPoller(**_make_poller_args())

        assert poller.poll() is None


class TestScheduleTriggerDebugEventPoller:
    @patch("core.trigger.debug.event_selectors.redis_client")
    @patch("core.trigger.debug.event_selectors.naive_utc_now")
    @patch("core.trigger.debug.event_selectors.calculate_next_run_at")
    @patch("core.trigger.debug.event_selectors.ensure_naive_utc")
    def test_returns_none_when_not_yet_due(
        self, mock_ensure: MagicMock, mock_calc: MagicMock, mock_now: MagicMock, mock_redis: MagicMock
    ) -> None:
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
    def test_fires_event_when_due(
        self, mock_ensure: MagicMock, mock_calc: MagicMock, mock_now: MagicMock, mock_redis: MagicMock
    ) -> None:
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
    def test_creates_plugin_poller(self) -> None:
        wf = _workflow_with_node(TRIGGER_PLUGIN_NODE_TYPE)
        poller = create_event_poller(wf, "t1", "u1", "a1", "n1")
        assert isinstance(poller, PluginTriggerDebugEventPoller)

    def test_creates_webhook_poller(self) -> None:
        wf = _workflow_with_node(TRIGGER_WEBHOOK_NODE_TYPE)
        poller = create_event_poller(wf, "t1", "u1", "a1", "n1")
        assert isinstance(poller, WebhookTriggerDebugEventPoller)

    def test_creates_schedule_poller(self) -> None:
        wf = _workflow_with_node(TRIGGER_SCHEDULE_NODE_TYPE)
        poller = create_event_poller(wf, "t1", "u1", "a1", "n1")
        assert isinstance(poller, ScheduleTriggerDebugEventPoller)

    def test_raises_for_unknown_type(self) -> None:
        wf = _workflow_with_node(BuiltinNodeTypes.START)

        with pytest.raises(ValueError, match="unable to create event poller for node type start") as exc_info:
            create_event_poller(wf, "t1", "u1", "a1", "n1")

        assert str(exc_info.value) == "unable to create event poller for node type start"

    def test_raises_when_node_config_missing(self) -> None:
        wf = _workflow_with_node(None)

        with (
            patch.object(Workflow, "get_node_config_by_id", return_value=None),
            pytest.raises(ValueError, match="\\('Node data not found for node %s', 'n1'\\)"),
        ):
            create_event_poller(wf, "t1", "u1", "a1", "n1")


class TestSelectTriggerDebugEvents:
    def test_returns_first_non_none_event(self) -> None:
        wf = _workflow_with_node(TRIGGER_WEBHOOK_NODE_TYPE)
        app_model = _app()

        with patch.object(WebhookTriggerDebugEventPoller, "poll") as mock_poll:
            expected = MagicMock()
            mock_poll.return_value = expected

            result = select_trigger_debug_events(wf, app_model, "u1", ["n1", "n2"])

            assert result is expected

    def test_returns_none_when_no_events(self) -> None:
        wf = _workflow_with_node(TRIGGER_WEBHOOK_NODE_TYPE)
        app_model = _app()

        with patch.object(WebhookTriggerDebugEventPoller, "poll", return_value=None):
            result = select_trigger_debug_events(wf, app_model, "u1", ["n1"])

            assert result is None
