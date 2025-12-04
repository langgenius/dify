from __future__ import annotations

import importlib
import json
import time
from datetime import timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from flask import Flask, Response
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from configs import dify_config
from core.trigger.debug import event_selectors
from core.trigger.debug.event_bus import TriggerDebugEventBus
from core.trigger.debug.event_selectors import PluginTriggerDebugEventPoller, WebhookTriggerDebugEventPoller
from core.trigger.debug.events import PluginTriggerDebugEvent
from core.workflow.enums import NodeType
from libs.datetime_utils import naive_utc_now
from models.account import Account, Tenant
from models.enums import AppTriggerStatus, AppTriggerType, CreatorUserRole, WorkflowTriggerStatus
from models.model import App
from models.trigger import AppTrigger, WorkflowSchedulePlan, WorkflowTriggerLog, WorkflowWebhookTrigger
from models.workflow import Workflow
from schedule import workflow_schedule_task
from schedule.workflow_schedule_task import poll_workflow_schedules
from services import feature_service as feature_service_module
from services.trigger import webhook_service
from services.workflow_service import WorkflowService
from tasks import trigger_processing_tasks

from .conftest import MockCeleryGroup, MockCelerySignature, MockPluginSubscription

# Test constants
WEBHOOK_ID_PRODUCTION = "wh1234567890123456789012"
WEBHOOK_ID_DEBUG = "whdebug1234567890123456"
TEST_TRIGGER_URL = "https://trigger.example.com/base"


def _build_workflow_graph(root_node_id: str, trigger_type: NodeType) -> str:
    """Build a minimal workflow graph JSON for testing."""
    node_data: dict[str, Any] = {"type": trigger_type.value, "title": "trigger"}
    if trigger_type == NodeType.TRIGGER_WEBHOOK:
        node_data.update(
            {
                "method": "POST",
                "content_type": "application/json",
                "headers": [],
                "params": [],
                "body": [],
            }
        )
    graph = {
        "nodes": [
            {"id": root_node_id, "data": node_data},
            {"id": "answer-1", "data": {"type": NodeType.ANSWER.value, "title": "answer"}},
        ],
        "edges": [{"source": root_node_id, "target": "answer-1", "sourceHandle": "success"}],
    }
    return json.dumps(graph)


def test_publish_blocks_start_and_trigger_coexistence(
    db_session_with_containers: Session,
    tenant_and_account: tuple[Tenant, Account],
    app_model: App,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Publishing should fail when both start and trigger nodes coexist."""
    tenant, account = tenant_and_account

    graph = {
        "nodes": [
            {"id": "start", "data": {"type": NodeType.START.value}},
            {"id": "trig", "data": {"type": NodeType.TRIGGER_WEBHOOK.value}},
        ],
        "edges": [],
    }
    draft_workflow = Workflow.new(
        tenant_id=tenant.id,
        app_id=app_model.id,
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(graph),
        features=json.dumps({}),
        created_by=account.id,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    db_session_with_containers.add(draft_workflow)
    db_session_with_containers.commit()

    workflow_service = WorkflowService()

    monkeypatch.setattr(
        feature_service_module.FeatureService,
        "get_system_features",
        classmethod(lambda _cls: SimpleNamespace(plugin_manager=SimpleNamespace(enabled=False))),
    )
    monkeypatch.setattr("services.workflow_service.dify_config", SimpleNamespace(BILLING_ENABLED=False))

    with pytest.raises(ValueError, match="Start node and trigger nodes cannot coexist"):
        workflow_service.publish_workflow(session=db_session_with_containers, app_model=app_model, account=account)


def test_trigger_url_uses_config_base(monkeypatch: pytest.MonkeyPatch) -> None:
    """TRIGGER_URL config should be reflected in generated webhook and plugin endpoints."""
    original_url = getattr(dify_config, "TRIGGER_URL", None)

    try:
        monkeypatch.setattr(dify_config, "TRIGGER_URL", TEST_TRIGGER_URL)
        endpoint_module = importlib.reload(importlib.import_module("core.trigger.utils.endpoint"))

        assert (
            endpoint_module.generate_webhook_trigger_endpoint(WEBHOOK_ID_PRODUCTION)
            == f"{TEST_TRIGGER_URL}/triggers/webhook/{WEBHOOK_ID_PRODUCTION}"
        )
        assert (
            endpoint_module.generate_webhook_trigger_endpoint(WEBHOOK_ID_PRODUCTION, True)
            == f"{TEST_TRIGGER_URL}/triggers/webhook-debug/{WEBHOOK_ID_PRODUCTION}"
        )
        assert (
            endpoint_module.generate_plugin_trigger_endpoint_url("end-1") == f"{TEST_TRIGGER_URL}/triggers/plugin/end-1"
        )
    finally:
        # Restore original config and reload module
        if original_url is not None:
            monkeypatch.setattr(dify_config, "TRIGGER_URL", original_url)
        importlib.reload(importlib.import_module("core.trigger.utils.endpoint"))


def test_webhook_trigger_creates_trigger_log(
    test_client_with_containers: FlaskClient,
    db_session_with_containers: Session,
    tenant_and_account: tuple[Tenant, Account],
    app_model: App,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Production webhook trigger should create a trigger log in the database."""
    tenant, account = tenant_and_account

    webhook_node_id = "webhook-node"
    graph_json = _build_workflow_graph(webhook_node_id, NodeType.TRIGGER_WEBHOOK)
    published_workflow = Workflow.new(
        tenant_id=tenant.id,
        app_id=app_model.id,
        type="workflow",
        version=Workflow.version_from_datetime(naive_utc_now()),
        graph=graph_json,
        features=json.dumps({}),
        created_by=account.id,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    db_session_with_containers.add(published_workflow)
    app_model.workflow_id = published_workflow.id
    db_session_with_containers.commit()

    webhook_trigger = WorkflowWebhookTrigger(
        app_id=app_model.id,
        node_id=webhook_node_id,
        tenant_id=tenant.id,
        webhook_id=WEBHOOK_ID_PRODUCTION,
        created_by=account.id,
    )
    app_trigger = AppTrigger(
        tenant_id=tenant.id,
        app_id=app_model.id,
        node_id=webhook_node_id,
        trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
        status=AppTriggerStatus.ENABLED,
        title="webhook",
    )

    db_session_with_containers.add_all([webhook_trigger, app_trigger])
    db_session_with_containers.commit()

    def _fake_trigger_workflow_async(session: Session, user: Any, trigger_data: Any) -> SimpleNamespace:
        log = WorkflowTriggerLog(
            tenant_id=trigger_data.tenant_id,
            app_id=trigger_data.app_id,
            workflow_id=trigger_data.workflow_id,
            root_node_id=trigger_data.root_node_id,
            trigger_metadata=trigger_data.trigger_metadata.model_dump_json() if trigger_data.trigger_metadata else "{}",
            trigger_type=trigger_data.trigger_type,
            workflow_run_id=None,
            outputs=None,
            trigger_data=trigger_data.model_dump_json(),
            inputs=json.dumps(dict(trigger_data.inputs)),
            status=WorkflowTriggerStatus.SUCCEEDED,
            error="",
            queue_name="triggered_workflow_dispatcher",
            celery_task_id="celery-test",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
        )
        session.add(log)
        session.commit()
        return SimpleNamespace(workflow_trigger_log_id=log.id, task_id=None, status="queued", queue="test")

    monkeypatch.setattr(
        webhook_service.AsyncWorkflowService,
        "trigger_workflow_async",
        _fake_trigger_workflow_async,
    )

    response = test_client_with_containers.post(f"/triggers/webhook/{webhook_trigger.webhook_id}", json={"foo": "bar"})

    assert response.status_code == 200

    db_session_with_containers.expire_all()
    logs = db_session_with_containers.query(WorkflowTriggerLog).filter_by(app_id=app_model.id).all()
    assert logs, "Webhook trigger should create trigger log"


@pytest.mark.parametrize("schedule_type", ["visual", "cron"])
def test_schedule_poll_dispatches_due_plan(
    db_session_with_containers: Session,
    tenant_and_account: tuple[Tenant, Account],
    app_model: App,
    mock_celery_group: MockCeleryGroup,
    mock_celery_signature: MockCelerySignature,
    monkeypatch: pytest.MonkeyPatch,
    schedule_type: str,
) -> None:
    """Schedule plans (both visual and cron) should be polled and dispatched when due."""
    tenant, _ = tenant_and_account

    app_trigger = AppTrigger(
        tenant_id=tenant.id,
        app_id=app_model.id,
        node_id=f"schedule-{schedule_type}",
        trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
        status=AppTriggerStatus.ENABLED,
        title=f"schedule-{schedule_type}",
    )
    plan = WorkflowSchedulePlan(
        app_id=app_model.id,
        node_id=f"schedule-{schedule_type}",
        tenant_id=tenant.id,
        cron_expression="* * * * *",
        timezone="UTC",
        next_run_at=naive_utc_now() - timedelta(minutes=1),
    )
    db_session_with_containers.add_all([app_trigger, plan])
    db_session_with_containers.commit()

    next_time = naive_utc_now() + timedelta(hours=1)
    monkeypatch.setattr(workflow_schedule_task, "calculate_next_run_at", lambda *_args, **_kwargs: next_time)
    monkeypatch.setattr(workflow_schedule_task, "group", mock_celery_group)
    monkeypatch.setattr(workflow_schedule_task, "run_schedule_trigger", mock_celery_signature)

    poll_workflow_schedules()

    assert mock_celery_group.collected, f"Should dispatch signatures for due {schedule_type} schedules"
    scheduled_ids = {sig["schedule_id"] for sig in mock_celery_group.collected}
    assert plan.id in scheduled_ids


def test_schedule_visual_debug_poll_generates_event(monkeypatch: pytest.MonkeyPatch) -> None:
    """Visual mode schedule node should generate event in single-step debug."""
    base_now = naive_utc_now()
    monkeypatch.setattr(event_selectors, "naive_utc_now", lambda: base_now)
    monkeypatch.setattr(
        event_selectors,
        "calculate_next_run_at",
        lambda *_args, **_kwargs: base_now - timedelta(minutes=1),
    )
    node_config = {
        "id": "schedule-visual",
        "data": {
            "type": NodeType.TRIGGER_SCHEDULE.value,
            "mode": "visual",
            "frequency": "daily",
            "visual_config": {"time": "3:00 PM"},
            "timezone": "UTC",
        },
    }
    poller = event_selectors.ScheduleTriggerDebugEventPoller(
        tenant_id="tenant",
        user_id="user",
        app_id="app",
        node_config=node_config,
        node_id="schedule-visual",
    )
    event = poller.poll()
    assert event is not None
    assert event.workflow_args["inputs"] == {}


def test_plugin_trigger_dispatches_and_debug_events(
    test_client_with_containers: FlaskClient,
    mock_plugin_subscription: MockPluginSubscription,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Plugin trigger endpoint should dispatch events and generate debug events."""
    endpoint_id = "1cc7fa12-3f7b-4f6a-9c8d-1234567890ab"

    debug_events: list[dict[str, Any]] = []
    dispatched_payloads: list[dict[str, Any]] = []

    def _fake_process_endpoint(_endpoint_id: str, _request: Any) -> Response:
        dispatch_data = {
            "user_id": "end-user",
            "tenant_id": mock_plugin_subscription.tenant_id,
            "endpoint_id": _endpoint_id,
            "provider_id": mock_plugin_subscription.provider_id,
            "subscription_id": mock_plugin_subscription.id,
            "timestamp": int(time.time()),
            "events": ["created", "updated"],
            "request_id": f"req-{_endpoint_id}",
        }
        trigger_processing_tasks.dispatch_triggered_workflows_async.delay(dispatch_data)
        return Response("ok", status=202)

    monkeypatch.setattr(
        "services.trigger.trigger_service.TriggerService.process_endpoint",
        staticmethod(_fake_process_endpoint),
    )

    monkeypatch.setattr(
        trigger_processing_tasks.TriggerDebugEventBus,
        "dispatch",
        staticmethod(lambda **kwargs: debug_events.append(kwargs) or 1),
    )

    def _fake_delay(dispatch_data: dict[str, Any]) -> None:
        dispatched_payloads.append(dispatch_data)
        trigger_processing_tasks.dispatch_trigger_debug_event(
            events=dispatch_data["events"],
            user_id=dispatch_data["user_id"],
            timestamp=dispatch_data["timestamp"],
            request_id=dispatch_data["request_id"],
            subscription=mock_plugin_subscription,
        )

    monkeypatch.setattr(
        trigger_processing_tasks.dispatch_triggered_workflows_async,
        "delay",
        staticmethod(_fake_delay),
    )

    response = test_client_with_containers.post(f"/triggers/plugin/{endpoint_id}", json={"hello": "world"})

    assert response.status_code == 202
    assert dispatched_payloads, "Plugin trigger should enqueue workflow dispatch payload"
    assert debug_events, "Plugin trigger should dispatch debug events"
    dispatched_event_names = {event["event"].name for event in debug_events}
    assert dispatched_event_names == {"created", "updated"}


def test_webhook_debug_dispatches_event(
    test_client_with_containers: FlaskClient,
    db_session_with_containers: Session,
    tenant_and_account: tuple[Tenant, Account],
    app_model: App,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Webhook single-step debug should dispatch debug event and be pollable."""
    tenant, account = tenant_and_account
    webhook_node_id = "webhook-debug-node"
    graph_json = _build_workflow_graph(webhook_node_id, NodeType.TRIGGER_WEBHOOK)
    draft_workflow = Workflow.new(
        tenant_id=tenant.id,
        app_id=app_model.id,
        type="workflow",
        version=Workflow.VERSION_DRAFT,
        graph=graph_json,
        features=json.dumps({}),
        created_by=account.id,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    db_session_with_containers.add(draft_workflow)
    db_session_with_containers.commit()

    webhook_trigger = WorkflowWebhookTrigger(
        app_id=app_model.id,
        node_id=webhook_node_id,
        tenant_id=tenant.id,
        webhook_id=WEBHOOK_ID_DEBUG,
        created_by=account.id,
    )
    db_session_with_containers.add(webhook_trigger)
    db_session_with_containers.commit()

    debug_events: list[dict[str, Any]] = []
    original_dispatch = TriggerDebugEventBus.dispatch
    monkeypatch.setattr(
        "controllers.trigger.webhook.TriggerDebugEventBus.dispatch",
        lambda **kwargs: (debug_events.append(kwargs), original_dispatch(**kwargs))[1],
    )

    # Listener polls first to enter waiting pool
    poller = WebhookTriggerDebugEventPoller(
        tenant_id=tenant.id,
        user_id=account.id,
        app_id=app_model.id,
        node_config=draft_workflow.get_node_config_by_id(webhook_node_id),
        node_id=webhook_node_id,
    )
    assert poller.poll() is None

    response = test_client_with_containers.post(
        f"/triggers/webhook-debug/{webhook_trigger.webhook_id}",
        json={"foo": "bar"},
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 200
    assert debug_events, "Debug event should be sent to event bus"
    # Second poll should get the event
    event = poller.poll()
    assert event is not None
    assert event.workflow_args["inputs"]["webhook_body"]["foo"] == "bar"
    assert debug_events[0]["pool_key"].endswith(f":{app_model.id}:{webhook_node_id}")


def test_plugin_single_step_debug_flow(
    flask_app_with_containers: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Plugin single-step debug: listen -> dispatch event -> poller receives and returns variables."""
    tenant_id = "tenant-1"
    app_id = "app-1"
    user_id = "user-1"
    node_id = "plugin-node"
    provider_id = "langgenius/provider-1/provider-1"
    node_config = {
        "id": node_id,
        "data": {
            "type": NodeType.TRIGGER_PLUGIN.value,
            "title": "plugin",
            "plugin_id": "plugin-1",
            "plugin_unique_identifier": "plugin-1",
            "provider_id": provider_id,
            "event_name": "created",
            "subscription_id": "sub-1",
            "parameters": {},
        },
    }
    # Start listening
    poller = PluginTriggerDebugEventPoller(
        tenant_id=tenant_id,
        user_id=user_id,
        app_id=app_id,
        node_config=node_config,
        node_id=node_id,
    )
    assert poller.poll() is None

    from core.trigger.debug.events import build_plugin_pool_key

    pool_key = build_plugin_pool_key(
        tenant_id=tenant_id,
        provider_id=provider_id,
        subscription_id="sub-1",
        name="created",
    )
    TriggerDebugEventBus.dispatch(
        tenant_id=tenant_id,
        event=PluginTriggerDebugEvent(
            timestamp=int(time.time()),
            user_id=user_id,
            name="created",
            request_id="req-1",
            subscription_id="sub-1",
            provider_id="provider-1",
        ),
        pool_key=pool_key,
    )

    from core.plugin.entities.request import TriggerInvokeEventResponse

    monkeypatch.setattr(
        "services.trigger.trigger_service.TriggerService.invoke_trigger_event",
        staticmethod(
            lambda **_kwargs: TriggerInvokeEventResponse(
                variables={"echo": "pong"},
                cancelled=False,
            )
        ),
    )

    event = poller.poll()
    assert event is not None
    assert event.workflow_args["inputs"]["echo"] == "pong"
