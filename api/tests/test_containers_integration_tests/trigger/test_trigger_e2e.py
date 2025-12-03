from __future__ import annotations

import importlib
import json
import time
from datetime import timedelta
from types import SimpleNamespace

import pytest
from flask import Response
from sqlalchemy.orm import Session

from configs import dify_config
from core.trigger.debug import event_selectors
from core.trigger.debug.event_bus import TriggerDebugEventBus
from core.trigger.debug.event_selectors import PluginTriggerDebugEventPoller, WebhookTriggerDebugEventPoller
from core.trigger.debug.events import PluginTriggerDebugEvent
from core.workflow.enums import NodeType
from libs.datetime_utils import naive_utc_now
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import AppTriggerStatus, AppTriggerType, CreatorUserRole, WorkflowTriggerStatus
from models.model import App
from models.trigger import AppTrigger, WorkflowSchedulePlan, WorkflowTriggerLog, WorkflowWebhookTrigger
from models.workflow import Workflow
from schedule import workflow_schedule_task
from schedule.workflow_schedule_task import poll_workflow_schedules
from services.workflow_service import WorkflowService
from tasks import trigger_processing_tasks


def _create_tenant_and_account(session: Session) -> tuple[Tenant, Account]:
    tenant = Tenant(name="trigger-e2e")
    account = Account(name="tester", email="tester@example.com", interface_language="en-US")
    session.add_all([tenant, account])
    session.commit()

    join = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER.value)
    session.add(join)
    session.commit()
    return tenant, account


def _create_app(session: Session, tenant: Tenant, account: Account) -> App:
    app = App(
        tenant_id=tenant.id,
        name="trigger-app",
        description="trigger e2e",
        mode="workflow",
        icon_type="emoji",
        icon="🤖",
        icon_background="#FFEAD5",
        enable_site=True,
        enable_api=True,
        api_rpm=100,
        api_rph=1000,
        is_demo=False,
        is_public=False,
        is_universal=False,
        created_by=account.id,
    )
    session.add(app)
    session.commit()
    return app


def _build_workflow_graph(root_node_id: str, trigger_type: NodeType) -> str:
    node_data: dict[str, object] = {"type": trigger_type.value, "title": "trigger"}
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
    monkeypatch: pytest.MonkeyPatch
):
    """发布时包含 start 与 trigger 节点应直接报错。"""
    tenant, account = _create_tenant_and_account(db_session_with_containers)
    app = _create_app(db_session_with_containers, tenant, account)

    graph = {
        "nodes": [
            {"id": "start", "data": {"type": NodeType.START.value}},
            {"id": "trig", "data": {"type": NodeType.TRIGGER_WEBHOOK.value}},
        ],
        "edges": [],
    }
    draft_workflow = Workflow.new(
        tenant_id=tenant.id,
        app_id=app.id,
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
    from services import feature_service as feature_service_module

    monkeypatch.setattr(
        feature_service_module.FeatureService,
        "get_system_features",
        classmethod(lambda _cls: SimpleNamespace(plugin_manager=SimpleNamespace(enabled=False))),
    )
    monkeypatch.setattr("services.workflow_service.dify_config", SimpleNamespace(BILLING_ENABLED=False))

    with pytest.raises(ValueError, match="Start node and trigger nodes cannot coexist"):
        workflow_service.publish_workflow(session=db_session_with_containers, app_model=app, account=account)


def test_trigger_url_uses_config_base(monkeypatch: pytest.MonkeyPatch):
    """TRIGGER_URL 配置应体现在生成的 webhook 与 plugin endpoint 上。"""
    monkeypatch.setattr(dify_config, "TRIGGER_URL", "https://trigger.example.com/base")
    endpoint_module = importlib.reload(importlib.import_module("core.trigger.utils.endpoint"))

    assert (
        endpoint_module.generate_webhook_trigger_endpoint("wh1234567890123456789012")
        == "https://trigger.example.com/base/triggers/webhook/wh1234567890123456789012"
    )
    assert (
        endpoint_module.generate_webhook_trigger_endpoint("wh1234567890123456789012", True)
        == "https://trigger.example.com/base/triggers/webhook-debug/wh1234567890123456789012"
    )
    assert (
        endpoint_module.generate_plugin_trigger_endpoint_url("end-1")
        == "https://trigger.example.com/base/triggers/plugin/end-1"
    )
    importlib.reload(importlib.import_module("core.trigger.utils.endpoint"))


def test_webhook_trigger_creates_trigger_log(
    test_client_with_containers, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
):
    """生产 webhook 触发应落库触发日志。"""
    tenant, account = _create_tenant_and_account(db_session_with_containers)
    app = _create_app(db_session_with_containers, tenant, account)

    webhook_node_id = "webhook-node"
    graph_json = _build_workflow_graph(webhook_node_id, NodeType.TRIGGER_WEBHOOK)
    published_workflow = Workflow.new(
        tenant_id=tenant.id,
        app_id=app.id,
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
    app.workflow_id = published_workflow.id
    db_session_with_containers.commit()

    webhook_trigger = WorkflowWebhookTrigger(
        app_id=app.id,
        node_id=webhook_node_id,
        tenant_id=tenant.id,
        webhook_id="wh1234567890123456789012",
        created_by=account.id,
    )
    app_trigger = AppTrigger(
        tenant_id=tenant.id,
        app_id=app.id,
        node_id=webhook_node_id,
        trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
        status=AppTriggerStatus.ENABLED,
        title="webhook",
    )

    db_session_with_containers.add_all([webhook_trigger, app_trigger])
    db_session_with_containers.commit()

    def _fake_trigger_workflow_async(session, user, trigger_data):
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

    monkeypatch.setattr("services.trigger.webhook_service.AsyncWorkflowService.trigger_workflow_async", _fake_trigger_workflow_async)

    response = test_client_with_containers.post(f"/triggers/webhook/{webhook_trigger.webhook_id}", json={"foo": "bar"})

    assert response.status_code == 200

    db_session_with_containers.expire_all()
    logs = db_session_with_containers.query(WorkflowTriggerLog).filter_by(app_id=app.id).all()
    assert logs, "Webhook trigger should create trigger log"


def test_schedule_poll_dispatches_due_plans(
    db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
):
    """schedule 两种配置均应被轮询并派发。"""
    tenant, account = _create_tenant_and_account(db_session_with_containers)
    app = _create_app(db_session_with_containers, tenant, account)

    for idx in ("visual", "cron"):
        app_trigger = AppTrigger(
            tenant_id=tenant.id,
            app_id=app.id,
            node_id=f"schedule-{idx}",
            trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
            status=AppTriggerStatus.ENABLED,
            title=f"schedule-{idx}",
        )
        plan = WorkflowSchedulePlan(
            app_id=app.id,
            node_id=f"schedule-{idx}",
            tenant_id=tenant.id,
            cron_expression="* * * * *",
            timezone="UTC",
            next_run_at=naive_utc_now() - timedelta(minutes=1),
        )
        db_session_with_containers.add_all([app_trigger, plan])
    db_session_with_containers.commit()

    dispatched_batches: list[list[dict] | str] = []
    next_time = naive_utc_now() + timedelta(hours=1)

    monkeypatch.setattr(workflow_schedule_task, "calculate_next_run_at", lambda *_args, **_kwargs: next_time)

    class _DummyGroup:
        def __init__(self, sink: list[list[dict] | str]):
            self.sink = sink

        def __call__(self, items):
            collected = list(items)
            self.sink.append(collected)
            return self

        def apply_async(self):
            self.sink.append("applied")

    class _DummySignature:
        def s(self, schedule_id: str) -> dict:
            return {"schedule_id": schedule_id}

    monkeypatch.setattr(workflow_schedule_task, "group", _DummyGroup(dispatched_batches))
    monkeypatch.setattr(workflow_schedule_task, "run_schedule_trigger", _DummySignature())

    poll_workflow_schedules()

    dispatched = [item for item in dispatched_batches if isinstance(item, list)]
    assert dispatched, "should dispatch signatures for due schedules"
    scheduled_ids = {sig["schedule_id"] for sig in dispatched[0]}
    assert scheduled_ids == {plan.id for plan in db_session_with_containers.query(WorkflowSchedulePlan).all()}


def test_schedule_visual_debug_poll_generates_event(monkeypatch: pytest.MonkeyPatch):
    """可视化配置的 schedule 节点应能在单步调试中产出事件。"""
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
    test_client_with_containers, monkeypatch: pytest.MonkeyPatch
):
    """插件 trigger 端点应派发事件并产生调试事件。"""
    endpoint_id = "1cc7fa12-3f7b-4f6a-9c8d-1234567890ab"

    class _FakeSubscription:
        def __init__(self):
            self.id = "sub-1"
            self.tenant_id = "tenant-1"
            self.provider_id = "provider-1"
            self.credentials = {"token": "secret"}
            self.credential_type = "api-key"

        def to_entity(self):
            return self

    subscription = _FakeSubscription()
    debug_events: list[dict] = []
    dispatched_payloads: list[dict] = []

    # 简化 process_endpoint，仍走实际路由但不依赖真实插件
    def _fake_process_endpoint(_endpoint_id: str, _request):
        dispatch_data = {
            "user_id": "end-user",
            "tenant_id": subscription.tenant_id,
            "endpoint_id": _endpoint_id,
            "provider_id": subscription.provider_id,
            "subscription_id": subscription.id,
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

    def _fake_delay(dispatch_data: dict):
        dispatched_payloads.append(dispatch_data)
        trigger_processing_tasks.dispatch_trigger_debug_event(
            events=dispatch_data["events"],
            user_id=dispatch_data["user_id"],
            timestamp=dispatch_data["timestamp"],
            request_id=dispatch_data["request_id"],
            subscription=subscription,
        )

    monkeypatch.setattr(
        trigger_processing_tasks.dispatch_triggered_workflows_async,
        "delay",
        staticmethod(_fake_delay),
    )

    response = test_client_with_containers.post(f"/triggers/plugin/{endpoint_id}", json={"hello": "world"})

    assert response.status_code == 202
    assert dispatched_payloads, "plugin trigger should enqueue workflow dispatch payload"
    assert debug_events, "plugin trigger should dispatch debug events"
    dispatched_events = {event["event"].name for event in debug_events}
    assert dispatched_events == {"created", "updated"}


def test_webhook_debug_dispatches_event(
    test_client_with_containers, db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
):
    """webhook 单步调试应派发调试事件，并可被轮询拿到。"""
    tenant, account = _create_tenant_and_account(db_session_with_containers)
    app = _create_app(db_session_with_containers, tenant, account)
    webhook_node_id = "webhook-debug-node"
    graph_json = _build_workflow_graph(webhook_node_id, NodeType.TRIGGER_WEBHOOK)
    draft_workflow = Workflow.new(
        tenant_id=tenant.id,
        app_id=app.id,
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
        app_id=app.id,
        node_id=webhook_node_id,
        tenant_id=tenant.id,
        webhook_id="whdebug1234567890123456",
        created_by=account.id,
    )
    db_session_with_containers.add(webhook_trigger)
    db_session_with_containers.commit()

    debug_events: list[dict] = []
    original_dispatch = TriggerDebugEventBus.dispatch
    monkeypatch.setattr(
        "controllers.trigger.webhook.TriggerDebugEventBus.dispatch",
        lambda **kwargs: (debug_events.append(kwargs), original_dispatch(**kwargs))[1],
    )

    # listener 预先轮询一次，进入等待池
    poller = WebhookTriggerDebugEventPoller(
        tenant_id=tenant.id,
        user_id=account.id,
        app_id=app.id,
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
    assert debug_events, "debug event should be sent to event bus"
    # 第二次轮询应拿到事件
    event = poller.poll()
    assert event is not None
    assert event.workflow_args["inputs"]["webhook_body"]["foo"] == "bar"
    assert debug_events[0]["pool_key"].endswith(f":{app.id}:{webhook_node_id}")


def test_plugin_single_step_debug_flow(flask_app_with_containers, monkeypatch: pytest.MonkeyPatch):
    """插件单步调试：监听 -> 派发事件 -> poller 收到并返回变量。"""
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
    # 监听
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
