"""Poll trigger debug inputs using injected event and schedule runtime stores."""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime
from typing import Any, Protocol

from pydantic import BaseModel

from constants.trigger import TRIGGER_PLUGIN_NODE_TYPE, TRIGGER_SCHEDULE_NODE_TYPE, TRIGGER_WEBHOOK_NODE_TYPE
from core.plugin.entities.request import TriggerInvokeEventResponse
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from graphon.entities.graph_config import NodeConfigDict
from libs.datetime_utils import ensure_naive_utc
from libs.schedule_utils import calculate_next_run_at
from models.provider_ids import TriggerProviderID
from services.trigger.debug_events import (
    PluginTriggerDebugEvent,
    WebhookDebugEvent,
    build_plugin_pool_key,
    build_webhook_pool_key,
)
from services.trigger.debug_store import ScheduleDebugRuntime, ScheduleDebugRuntimeStore, TriggerDebugEventStore
from services.trigger.schedule_service import ScheduleService
from services.trigger.webhook_service import build_webhook_workflow_inputs


class TriggerDebugEvent(BaseModel):
    workflow_args: Mapping[str, Any]
    node_id: str


class PluginTriggerEventInvoker(Protocol):
    def __call__(
        self, *, tenant_id: str, user_id: str, node_config: NodeConfigDict, event: PluginTriggerDebugEvent
    ) -> TriggerInvokeEventResponse: ...


class TriggerDebugService:
    """Route debug events and schedule ticks through injected runtime stores."""

    def __init__(
        self,
        *,
        events: TriggerDebugEventStore,
        schedules: ScheduleDebugRuntimeStore,
        invoke_plugin_event: PluginTriggerEventInvoker,
        now: Callable[[], datetime],
    ) -> None:
        self._events = events
        self._schedules = schedules
        self._invoke_plugin_event = invoke_plugin_event
        self._now = now

    def dispatch_webhook_debug(self, *, tenant_id: str, app_id: str, event: WebhookDebugEvent) -> int:
        """Deliver an event to waiting listeners for its tenant, app, and node."""
        pool_key = build_webhook_pool_key(tenant_id, app_id, event.node_id)
        return self._events.dispatch(tenant_id=tenant_id, event=event, pool_key=pool_key)

    def poll(
        self, *, node_config: NodeConfigDict, tenant_id: str, user_id: str, app_id: str
    ) -> TriggerDebugEvent | None:
        """Poll a supported trigger node for this user; return None when no event is ready.

        Unsupported node types raise ValueError; store and plugin errors propagate.
        """
        node_type = node_config["data"].type
        node_id = node_config["id"]
        if node_type == TRIGGER_PLUGIN_NODE_TYPE:
            return self._poll_plugin(node_config=node_config, tenant_id=tenant_id, user_id=user_id, app_id=app_id)
        if node_type == TRIGGER_WEBHOOK_NODE_TYPE:
            event = self._events.poll(
                event_type=WebhookDebugEvent,
                pool_key=build_webhook_pool_key(tenant_id, app_id, node_id),
                tenant_id=tenant_id,
                user_id=user_id,
                app_id=app_id,
                node_id=node_id,
            )
            if event is None:
                return None
            inputs = event.payload.get("inputs")
            if inputs is None:
                inputs = build_webhook_workflow_inputs(event.payload.get("webhook_data", {}))
            return TriggerDebugEvent(workflow_args={"inputs": inputs or {}, "files": []}, node_id=node_id)
        if node_type == TRIGGER_SCHEDULE_NODE_TYPE:
            return self._poll_schedule(node_config=node_config, tenant_id=tenant_id, user_id=user_id, app_id=app_id)
        raise ValueError(f"unable to create event poller for node type {node_type}")

    def select_events(
        self, *, node_configs: Iterable[NodeConfigDict], tenant_id: str, user_id: str, app_id: str
    ) -> TriggerDebugEvent | None:
        """Poll in graph-request order and stop after the first available event."""
        for node_config in node_configs:
            event = self.poll(node_config=node_config, tenant_id=tenant_id, user_id=user_id, app_id=app_id)
            if event is not None:
                return event
        return None

    def _poll_plugin(
        self, *, node_config: NodeConfigDict, tenant_id: str, user_id: str, app_id: str
    ) -> TriggerDebugEvent | None:
        """Consume and invoke a plugin event; cancelled or absent events return None."""
        node = TriggerEventNodeData.model_validate(node_config["data"], from_attributes=True)
        pool_key = build_plugin_pool_key(
            tenant_id, str(TriggerProviderID(node.provider_id)), node.subscription_id, node.event_name
        )
        event = self._events.poll(
            event_type=PluginTriggerDebugEvent,
            pool_key=pool_key,
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            node_id=node_config["id"],
        )
        if event is None:
            return None
        response = self._invoke_plugin_event(
            tenant_id=tenant_id, user_id=event.user_id, node_config=node_config, event=event
        )
        if response.cancelled:
            return None
        return TriggerDebugEvent(workflow_args={"inputs": response.variables, "files": []}, node_id=node_config["id"])

    def _poll_schedule(
        self, *, node_config: NodeConfigDict, tenant_id: str, user_id: str, app_id: str
    ) -> TriggerDebugEvent | None:
        """Initialize or consume a user's schedule tick according to its stored next run time."""
        config = ScheduleService.to_schedule_config(node_config)
        cron_hash = hashlib.sha256(config.cron_expression.encode()).hexdigest()
        cache_key = f"schedule_debug_runtime:{tenant_id}:{user_id}:{app_id}:{node_config['id']}:{cron_hash}"
        runtime = self._schedules.get_runtime(cache_key)
        now = self._now()
        if runtime is None:
            runtime = ScheduleDebugRuntime(
                cache_key=cache_key,
                timezone=config.timezone,
                cron_expression=config.cron_expression,
                next_run_at=ensure_naive_utc(calculate_next_run_at(config.cron_expression, config.timezone, now)),
            )
            self._schedules.save_runtime(runtime)
        if ensure_naive_utc(runtime.next_run_at) > ensure_naive_utc(now):
            return None
        self._schedules.delete_runtime(cache_key)
        return TriggerDebugEvent(workflow_args={"inputs": {}, "files": []}, node_id=node_config["id"])
