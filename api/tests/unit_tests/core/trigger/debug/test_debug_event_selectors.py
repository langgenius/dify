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
from sqlalchemy.orm import Session, sessionmaker
from typing_extensions import TypedDict

from core.trigger.constants import (
    TRIGGER_PLUGIN_NODE_TYPE,
    TRIGGER_SCHEDULE_NODE_TYPE,
    TRIGGER_WEBHOOK_NODE_TYPE,
)
from core.trigger.debug.event_selectors import (
    PluginTriggerDebugEventPoller,
    PluginTriggerEventInvoker,
    ScheduleTriggerDebugEventPoller,
    WebhookTriggerDebugEventPoller,
    create_event_poller,
    select_trigger_debug_events,
)
from core.trigger.debug.events import WebhookDebugEvent
from graphon.entities.graph_config import NodeConfigDict
from graphon.enums import BuiltinNodeTypes, NodeType, WorkflowType
from models.model import App, AppMode
from models.workflow import Workflow
from repositories.credentials.query_repository import CredentialQueryRepository
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from services.trigger.event_gateway import PluginTriggerEventGateway
from services.trigger.event_service import TriggerEventService
from services.trigger.provider_gateway import PluginTriggerProviderQuery
from services.trigger.subscription_query_service import TriggerSubscriptionQueryService
from services.trigger.trigger_request_service import TriggerHttpRequestCachingService
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


@pytest.fixture
def invoke_plugin_event(sqlite_session_factory: sessionmaker[Session]) -> PluginTriggerEventInvoker:
    subscriptions = TriggerSubscriptionQueryService(
        credentials=CredentialQueryRepository(session_factory=sqlite_session_factory),
        schemas=PluginTriggerProviderQuery(),
        subscriptions=TriggerSubscriptionRepository(session_factory=sqlite_session_factory),
    )
    return TriggerEventService(
        subscriptions=subscriptions, plugins=PluginTriggerEventGateway(), requests=TriggerHttpRequestCachingService
    ).invoke_debug


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
    def test_creates_plugin_poller(self, invoke_plugin_event: PluginTriggerEventInvoker) -> None:
        wf = _workflow_with_node(TRIGGER_PLUGIN_NODE_TYPE)
        poller = create_event_poller(wf, "t1", "u1", "a1", "n1", invoke_plugin_event=invoke_plugin_event)
        assert isinstance(poller, PluginTriggerDebugEventPoller)

    def test_creates_webhook_poller(self, invoke_plugin_event: PluginTriggerEventInvoker) -> None:
        wf = _workflow_with_node(TRIGGER_WEBHOOK_NODE_TYPE)
        poller = create_event_poller(wf, "t1", "u1", "a1", "n1", invoke_plugin_event=invoke_plugin_event)
        assert isinstance(poller, WebhookTriggerDebugEventPoller)

    def test_creates_schedule_poller(self, invoke_plugin_event: PluginTriggerEventInvoker) -> None:
        wf = _workflow_with_node(TRIGGER_SCHEDULE_NODE_TYPE)
        poller = create_event_poller(wf, "t1", "u1", "a1", "n1", invoke_plugin_event=invoke_plugin_event)
        assert isinstance(poller, ScheduleTriggerDebugEventPoller)

    def test_raises_for_unknown_type(self, invoke_plugin_event: PluginTriggerEventInvoker) -> None:
        wf = _workflow_with_node(BuiltinNodeTypes.START)

        with pytest.raises(ValueError, match="unable to create event poller for node type start") as exc_info:
            create_event_poller(wf, "t1", "u1", "a1", "n1", invoke_plugin_event=invoke_plugin_event)

        assert str(exc_info.value) == "unable to create event poller for node type start"

    def test_raises_when_node_config_missing(self, invoke_plugin_event: PluginTriggerEventInvoker) -> None:
        wf = _workflow_with_node(None)

        with (
            patch.object(Workflow, "get_node_config_by_id", return_value=None),
            pytest.raises(ValueError, match="\\('Node data not found for node %s', 'n1'\\)"),
        ):
            create_event_poller(wf, "t1", "u1", "a1", "n1", invoke_plugin_event=invoke_plugin_event)


class TestSelectTriggerDebugEvents:
    def test_returns_first_non_none_event(self, invoke_plugin_event: PluginTriggerEventInvoker) -> None:
        wf = _workflow_with_node(TRIGGER_WEBHOOK_NODE_TYPE)
        app_model = _app()

        with patch.object(WebhookTriggerDebugEventPoller, "poll") as mock_poll:
            expected = MagicMock()
            mock_poll.return_value = expected

            result = select_trigger_debug_events(
                wf, app_model, "u1", ["n1", "n2"], invoke_plugin_event=invoke_plugin_event
            )

            assert result is expected

    def test_returns_none_when_no_events(self, invoke_plugin_event: PluginTriggerEventInvoker) -> None:
        wf = _workflow_with_node(TRIGGER_WEBHOOK_NODE_TYPE)
        app_model = _app()

        with patch.object(WebhookTriggerDebugEventPoller, "poll", return_value=None):
            result = select_trigger_debug_events(wf, app_model, "u1", ["n1"], invoke_plugin_event=invoke_plugin_event)

            assert result is None
