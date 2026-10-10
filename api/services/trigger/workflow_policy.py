"""Validate and prepare trigger relationships from a workflow graph."""

from collections.abc import Mapping, Sequence
from typing import Any

from core.trigger.constants import TRIGGER_PLUGIN_NODE_TYPE, TRIGGER_SCHEDULE_NODE_TYPE, TRIGGER_WEBHOOK_NODE_TYPE
from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig, TriggerScheduleNodeData, VisualConfig
from core.workflow.nodes.trigger_schedule.exc import ScheduleConfigError
from services.trigger.schedule_policy import visual_to_cron

MAX_WEBHOOK_NODES_PER_WORKFLOW = 5
MAX_PLUGIN_TRIGGER_NODES_PER_WORKFLOW = 5


def webhook_node_ids(nodes: Sequence[Mapping[str, Any]]) -> list[str]:
    node_ids = [node["id"] for node in nodes if node.get("data", {}).get("type") == TRIGGER_WEBHOOK_NODE_TYPE]
    if len(node_ids) > MAX_WEBHOOK_NODES_PER_WORKFLOW:
        raise ValueError(
            f"Workflow exceeds maximum webhook node limit. Found {len(node_ids)} webhook nodes, "
            f"maximum allowed is {MAX_WEBHOOK_NODES_PER_WORKFLOW}"
        )
    return node_ids


def plugin_relationships(nodes: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    relationships: list[Mapping[str, Any]] = []
    for node in nodes:
        data = node.get("data", {})
        if data.get("type") != TRIGGER_PLUGIN_NODE_TYPE or not data.get("subscription_id"):
            continue
        relationships.append(
            {
                "node_id": node["id"],
                "plugin_id": data.get("plugin_id", ""),
                "provider_id": data.get("provider_id", ""),
                "event_name": data.get("event_name", ""),
                "subscription_id": data["subscription_id"],
            }
        )
    if len(relationships) > MAX_PLUGIN_TRIGGER_NODES_PER_WORKFLOW:
        raise ValueError(
            f"Workflow exceeds maximum plugin trigger node limit. Found {len(relationships)} plugin trigger nodes, "
            f"maximum allowed is {MAX_PLUGIN_TRIGGER_NODES_PER_WORKFLOW}"
        )
    return relationships


def schedule_config(graph_data: Mapping[str, Any]) -> ScheduleConfig | None:
    """Normalize the first schedule trigger; multiple schedules are unsupported."""
    if not graph_data:
        raise ScheduleConfigError("Workflow graph is empty")

    nodes = graph_data.get("nodes", [])
    for node in nodes:
        node_data = node.get("data", {})

        if node_data.get("type") != TRIGGER_SCHEDULE_NODE_TYPE:
            continue

        node_id = node.get("id", "start")
        trigger_data = TriggerScheduleNodeData.model_validate(node_data)
        mode = trigger_data.mode
        timezone = trigger_data.timezone

        cron_expression = None
        if mode == "cron":
            cron_expression = trigger_data.cron_expression
            if not cron_expression:
                raise ScheduleConfigError("Cron expression is required for cron mode")
        elif mode == "visual":
            frequency = trigger_data.frequency
            if not frequency:
                raise ScheduleConfigError("Frequency is required for visual mode")
            visual_config = VisualConfig.model_validate(trigger_data.visual_config or {})
            cron_expression = visual_to_cron(frequency, visual_config)
        else:
            raise ScheduleConfigError(f"Invalid schedule mode: {mode}")

        return ScheduleConfig(node_id=node_id, cron_expression=cron_expression, timezone=timezone)

    return None
