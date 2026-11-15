from __future__ import annotations

import importlib
import json
import time
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from kombu.simple import SimpleQueue
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from constants.trigger import (
    TRIGGER_SCHEDULE_NODE_TYPE,
    TRIGGER_WEBHOOK_NODE_TYPE,
)
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import Subscription
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from graphon.entities.graph_config import NodeConfigDictAdapter
from graphon.enums import BuiltinNodeTypes
from libs.datetime_utils import naive_utc_now
from models.account import Account, Tenant
from models.enums import AppTriggerStatus, AppTriggerType, WorkflowTriggerStatus
from models.model import App
from models.trigger import (
    AppTrigger,
    WorkflowTriggerLog,
    WorkflowWebhookTrigger,
)
from models.workflow import Workflow
from services.system_feature_service import SystemFeatureService
from services.trigger.debug_events import PluginTriggerDebugEvent, build_plugin_pool_key
from services.trigger.schedule_service import ScheduleService
from services.trigger.subscription_query_service import TriggerSubscriptionRuntime
from services.workflow_service import WorkflowService
from tasks import trigger_processing_tasks
from tests.helpers.unit.config_override import config_overrides_context
from tests.unit_tests.controllers.trigger import test_webhook as native_webhook_tests

# Test constants
WEBHOOK_ID_PRODUCTION = "wh1234567890123456789012"
WEBHOOK_ID_DEBUG = "whdebug1234567890123456"
TEST_TRIGGER_URL = "https://trigger.example.com/base"

broker = native_webhook_tests.broker


def _build_workflow_graph(root_node_id: str, trigger_type: str) -> str:
    """Build a minimal workflow graph JSON for testing."""
    node_data: dict[str, Any] = {"type": trigger_type, "title": "trigger"}
    if trigger_type == TRIGGER_WEBHOOK_NODE_TYPE:
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
            {"id": "answer-1", "data": {"type": BuiltinNodeTypes.ANSWER, "title": "answer"}},
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
            {"id": "start", "data": {"type": BuiltinNodeTypes.START}},
            {"id": "trig", "data": {"type": TRIGGER_WEBHOOK_NODE_TYPE}},
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
        SystemFeatureService,
        "is_plugin_manager_enabled",
        classmethod(lambda _cls: False),
    )
    monkeypatch.setattr(
        "services.workflow_service.dify_config", SimpleNamespace(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    )

    with pytest.raises(ValueError, match="Start node and trigger nodes cannot coexist"):
        workflow_service.publish_workflow(session=db_session_with_containers, app_model=app_model, account=account)


def test_trigger_url_uses_config_base(monkeypatch: pytest.MonkeyPatch) -> None:
    """TRIGGER_URL config should be reflected in generated webhook and plugin endpoints."""
    original_url = getattr(dify_config, "TRIGGER_URL", None)

    try:
        monkeypatch.setattr(dify_config, "TRIGGER_URL", TEST_TRIGGER_URL)
        endpoint_module = importlib.reload(importlib.import_module("models.utils.trigger_endpoint"))

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
        importlib.reload(importlib.import_module("models.utils.trigger_endpoint"))


def test_webhook_trigger_creates_trigger_log(
    test_client_with_containers: FlaskClient,
    db_session_with_containers: Session,
    tenant_and_account: tuple[Tenant, Account],
    app_model: App,
    broker: SimpleQueue,
) -> None:
    """Production webhook trigger should create a trigger log in the database."""
    tenant, account = tenant_and_account

    webhook_node_id = "webhook-node"
    graph_json = _build_workflow_graph(webhook_node_id, TRIGGER_WEBHOOK_NODE_TYPE)
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

    with config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY):
        response = test_client_with_containers.post(
            f"/triggers/webhook/{webhook_trigger.webhook_id}", json={"foo": "bar"}
        )

    assert response.status_code == 200

    db_session_with_containers.expire_all()
    logs = db_session_with_containers.scalars(
        select(WorkflowTriggerLog).where(WorkflowTriggerLog.app_id == app_model.id)
    ).all()
    assert len(logs) == 1
    assert logs[0].status == WorkflowTriggerStatus.QUEUED
    assert logs[0].root_node_id == webhook_node_id
    assert json.loads(logs[0].inputs)["webhook_body"] == {"foo": "bar"}
    message = broker.get(block=False)
    assert message.payload[0] == [{"workflow_trigger_log_id": logs[0].id}]
    assert message.headers["id"] == logs[0].celery_task_id
    message.ack()


def test_plugin_dispatch_delivers_each_debug_event_to_its_waiting_pool(
    tenant_and_account: tuple[Tenant, Account],
    app_model: App,
) -> None:
    """The real task helper preserves dispatch identity through the Redis event bus."""
    tenant, account = tenant_and_account
    subscription = TriggerSubscriptionRuntime(
        id=str(uuid4()),
        tenant_id=tenant.id,
        user_id=account.id,
        provider_id="langgenius/test-provider/test-provider",
        endpoint_id="1cc7fa12-3f7b-4f6a-9c8d-1234567890ab",
        credentials={},
        credential_type=CredentialType.UNAUTHORIZED,
        subscription=Subscription(
            expires_at=-1, endpoint="https://trigger.example.com/endpoint", parameters={}, properties={}
        ),
    )
    event_names = ["created", "updated"]
    pools = {
        name: build_plugin_pool_key(
            tenant_id=tenant.id,
            provider_id=subscription.provider_id,
            subscription_id=subscription.id,
            name=name,
        )
        for name in event_names
    }
    for name, pool_key in pools.items():
        assert (
            application_services().triggers.debug_events.poll(
                event_type=PluginTriggerDebugEvent,
                pool_key=pool_key,
                tenant_id=tenant.id,
                user_id=account.id,
                app_id=app_model.id,
                node_id=f"plugin-{name}",
            )
            is None
        )

    timestamp = int(time.time())
    dispatched = trigger_processing_tasks.dispatch_trigger_debug_event(
        events=event_names,
        user_id="external-user",
        timestamp=timestamp,
        request_id="request-with-two-events",
        subscription=subscription,
        debug_events=application_services().triggers.debug_events,
    )

    assert dispatched == 2
    for name, pool_key in pools.items():
        event = application_services().triggers.debug_events.poll(
            event_type=PluginTriggerDebugEvent,
            pool_key=pool_key,
            tenant_id=tenant.id,
            user_id=account.id,
            app_id=app_model.id,
            node_id=f"plugin-{name}",
        )
        assert event == PluginTriggerDebugEvent(
            timestamp=timestamp,
            user_id="external-user",
            name=name,
            request_id="request-with-two-events",
            subscription_id=subscription.id,
            provider_id=subscription.provider_id,
        )


def test_webhook_debug_dispatches_event(
    test_client_with_containers: FlaskClient,
    db_session_with_containers: Session,
    tenant_and_account: tuple[Tenant, Account],
    app_model: App,
) -> None:
    """Webhook single-step debug should dispatch debug event and be pollable."""
    tenant, account = tenant_and_account
    webhook_node_id = "webhook-debug-node"
    graph_json = _build_workflow_graph(webhook_node_id, TRIGGER_WEBHOOK_NODE_TYPE)
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

    debug = application_services().triggers.debug
    node_config = draft_workflow.get_node_config_by_id(webhook_node_id)
    assert debug.poll(node_config=node_config, tenant_id=tenant.id, user_id=account.id, app_id=app_model.id) is None

    response = test_client_with_containers.post(
        f"/triggers/webhook-debug/{webhook_trigger.webhook_id}",
        json={"foo": "bar"},
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 200
    # Second poll should get the event
    event = debug.poll(node_config=node_config, tenant_id=tenant.id, user_id=account.id, app_id=app_model.id)
    assert event is not None
    assert event.workflow_args["inputs"]["webhook_body"]["foo"] == "bar"
    assert (
        db_session_with_containers.scalar(select(WorkflowTriggerLog).where(WorkflowTriggerLog.app_id == app_model.id))
        is None
    )


@pytest.mark.parametrize(
    ("mode", "frequency", "visual_config", "cron_expression", "expected_cron"),
    [
        # Visual mode: hourly
        ("visual", "hourly", {"on_minute": 30}, None, "30 * * * *"),
        # Visual mode: daily
        ("visual", "daily", {"time": "3:00 PM"}, None, "0 15 * * *"),
        # Visual mode: weekly
        ("visual", "weekly", {"time": "9:00 AM", "weekdays": ["mon", "wed", "fri"]}, None, "0 9 * * 1,3,5"),
        # Visual mode: monthly
        ("visual", "monthly", {"time": "10:30 AM", "monthly_days": [1, 15]}, None, "30 10 1,15 * *"),
        # Cron mode: direct expression
        ("cron", None, None, "*/5 * * * *", "*/5 * * * *"),
    ],
)
def test_schedule_visual_cron_conversion(
    mode: str,
    frequency: str | None,
    visual_config: dict[str, Any] | None,
    cron_expression: str | None,
    expected_cron: str,
) -> None:
    """Schedule visual config should correctly convert to cron expression."""

    node_config: dict[str, Any] = {
        "id": "schedule-node",
        "data": {
            "type": TRIGGER_SCHEDULE_NODE_TYPE,
            "mode": mode,
            "timezone": "UTC",
        },
    }

    if mode == "visual":
        node_config["data"]["frequency"] = frequency
        node_config["data"]["visual_config"] = visual_config
    else:
        node_config["data"]["cron_expression"] = cron_expression

    config = ScheduleService.to_schedule_config(NodeConfigDictAdapter.validate_python(node_config))

    assert config.cron_expression == expected_cron, f"Expected {expected_cron}, got {config.cron_expression}"
    assert config.timezone == "UTC"
    assert config.node_id == "schedule-node"
