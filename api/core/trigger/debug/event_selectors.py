"""Trigger debug service supporting plugin and webhook debugging in draft workflows."""

import hashlib
import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from core.plugin.entities.request import TriggerInvokeEventResponse
from core.trigger.debug.event_bus import TriggerDebugEventBus
from core.trigger.debug.events import (
    PluginTriggerDebugEvent,
    ScheduleDebugEvent,
    WebhookDebugEvent,
    build_plugin_pool_key,
    build_webhook_pool_key,
)
from core.workflow.enums import NodeType
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig
from extensions.ext_redis import redis_client
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from libs.schedule_utils import calculate_next_run_at
from models.model import App
from models.provider_ids import TriggerProviderID
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class TriggerDebugEvent(BaseModel):
    workflow_args: Mapping[str, Any]
    node_id: str


class TriggerDebugEventPoller(ABC):
    app_id: str
    user_id: str
    tenant_id: str
    node_config: Mapping[str, Any]
    node_id: str

    def __init__(self, tenant_id: str, user_id: str, app_id: str, node_config: Mapping[str, Any], node_id: str):
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.app_id = app_id
        self.node_config = node_config
        self.node_id = node_id

    @abstractmethod
    def poll(self) -> TriggerDebugEvent | None:
        raise NotImplementedError


class PluginTriggerDebugEventPoller(TriggerDebugEventPoller):
    def poll(self) -> TriggerDebugEvent | None:
        from services.trigger.trigger_service import TriggerService

        plugin_trigger_data = TriggerEventNodeData.model_validate(self.node_config.get("data", {}))
        provider_id = TriggerProviderID(plugin_trigger_data.provider_id)
        pool_key: str = build_plugin_pool_key(
            name=plugin_trigger_data.event_name,
            provider_id=str(provider_id),
            tenant_id=self.tenant_id,
            subscription_id=plugin_trigger_data.subscription_id,
        )
        plugin_trigger_event: PluginTriggerDebugEvent | None = TriggerDebugEventBus.poll(
            event_type=PluginTriggerDebugEvent,
            pool_key=pool_key,
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            app_id=self.app_id,
            node_id=self.node_id,
        )
        if not plugin_trigger_event:
            return None
        trigger_event_response: TriggerInvokeEventResponse = TriggerService.invoke_trigger_event(
            event=plugin_trigger_event,
            user_id=plugin_trigger_event.user_id,
            tenant_id=self.tenant_id,
            node_config=self.node_config,
        )

        if trigger_event_response.cancelled:
            return None

        return TriggerDebugEvent(
            workflow_args={
                "inputs": trigger_event_response.variables,
                "files": [],
            },
            node_id=self.node_id,
        )


class WebhookTriggerDebugEventPoller(TriggerDebugEventPoller):
    def poll(self) -> TriggerDebugEvent | None:
        pool_key = build_webhook_pool_key(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            node_id=self.node_id,
        )
        webhook_event: WebhookDebugEvent | None = TriggerDebugEventBus.poll(
            event_type=WebhookDebugEvent,
            pool_key=pool_key,
            tenant_id=self.tenant_id,
            user_id=self.user_id,
            app_id=self.app_id,
            node_id=self.node_id,
        )
        if not webhook_event:
            return None

        from services.trigger.webhook_service import WebhookService

        payload = webhook_event.payload or {}
        workflow_inputs = payload.get("inputs")
        if workflow_inputs is None:
            webhook_data = payload.get("webhook_data", {})
            workflow_inputs = WebhookService.build_workflow_inputs(webhook_data)

        workflow_args: Mapping[str, Any] = {
            "inputs": workflow_inputs or {},
            "files": [],
        }
        return TriggerDebugEvent(workflow_args=workflow_args, node_id=self.node_id)


class ScheduleTriggerDebugEventPoller(TriggerDebugEventPoller):
    """
    Poller for schedule trigger debug events.

    This poller will simulate the schedule trigger event by creating a schedule debug runtime cache
    and calculating the next run at.
    """

    RUNTIME_CACHE_TTL = 60 * 5

    class ScheduleDebugRuntime(BaseModel):
        cache_key: str
        timezone: str
        cron_expression: str
        next_run_at: datetime

    def schedule_debug_runtime_key(self, cron_hash: str) -> str:
        return f"schedule_debug_runtime:{self.tenant_id}:{self.user_id}:{self.app_id}:{self.node_id}:{cron_hash}"

    def get_or_create_schedule_debug_runtime(self):
        from services.trigger.schedule_service import ScheduleService

        schedule_config: ScheduleConfig = ScheduleService.to_schedule_config(self.node_config)
        cron_hash = hashlib.sha256(schedule_config.cron_expression.encode()).hexdigest()
        cache_key = self.schedule_debug_runtime_key(cron_hash)
        runtime_cache = redis_client.get(cache_key)
        if runtime_cache is None:
            schedule_debug_runtime = self.ScheduleDebugRuntime(
                cron_expression=schedule_config.cron_expression,
                timezone=schedule_config.timezone,
                cache_key=cache_key,
                next_run_at=ensure_naive_utc(
                    calculate_next_run_at(schedule_config.cron_expression, schedule_config.timezone)
                ),
            )
            redis_client.setex(
                name=self.schedule_debug_runtime_key(cron_hash),
                time=self.RUNTIME_CACHE_TTL,
                value=schedule_debug_runtime.model_dump_json(),
            )
            return schedule_debug_runtime
        else:
            redis_client.expire(cache_key, self.RUNTIME_CACHE_TTL)
            runtime = self.ScheduleDebugRuntime.model_validate_json(runtime_cache)
            runtime.next_run_at = ensure_naive_utc(runtime.next_run_at)
            return runtime

    def create_schedule_event(self, schedule_debug_runtime: ScheduleDebugRuntime) -> ScheduleDebugEvent:
        redis_client.delete(schedule_debug_runtime.cache_key)
        return ScheduleDebugEvent(
            timestamp=int(time.time()),
            node_id=self.node_id,
            inputs={},
        )

    def poll(self) -> TriggerDebugEvent | None:
        schedule_debug_runtime = self.get_or_create_schedule_debug_runtime()
        if schedule_debug_runtime.next_run_at > naive_utc_now():
            return None

        schedule_event: ScheduleDebugEvent = self.create_schedule_event(schedule_debug_runtime)
        workflow_args: Mapping[str, Any] = {
            "inputs": schedule_event.inputs or {},
            "files": [],
        }
        return TriggerDebugEvent(workflow_args=workflow_args, node_id=self.node_id)


def create_event_poller(
    draft_workflow: Workflow, tenant_id: str, user_id: str, app_id: str, node_id: str
) -> TriggerDebugEventPoller:
    node_config = draft_workflow.get_node_config_by_id(node_id=node_id)
    if not node_config:
        raise ValueError("Node data not found for node %s", node_id)
    node_type = draft_workflow.get_node_type_from_node_config(node_config)
    match node_type:
        case NodeType.TRIGGER_PLUGIN:
            return PluginTriggerDebugEventPoller(
                tenant_id=tenant_id, user_id=user_id, app_id=app_id, node_config=node_config, node_id=node_id
            )
        case NodeType.TRIGGER_WEBHOOK:
            return WebhookTriggerDebugEventPoller(
                tenant_id=tenant_id, user_id=user_id, app_id=app_id, node_config=node_config, node_id=node_id
            )
        case NodeType.TRIGGER_SCHEDULE:
            return ScheduleTriggerDebugEventPoller(
                tenant_id=tenant_id, user_id=user_id, app_id=app_id, node_config=node_config, node_id=node_id
            )
        case _:
            raise ValueError("unable to create event poller for node type %s", node_type)


def select_trigger_debug_events(
    draft_workflow: Workflow, app_model: App, user_id: str, node_ids: list[str]
) -> TriggerDebugEvent | None:
    event: TriggerDebugEvent | None = None
    for node_id in node_ids:
        node_config = draft_workflow.get_node_config_by_id(node_id=node_id)
        if not node_config:
            raise ValueError("Node data not found for node %s", node_id)
        poller: TriggerDebugEventPoller = create_event_poller(
            draft_workflow=draft_workflow,
            tenant_id=app_model.tenant_id,
            user_id=user_id,
            app_id=app_model.id,
            node_id=node_id,
        )
        event = poller.poll()
        if event is not None:
            return event
    return None
