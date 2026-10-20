"""Workflow I/O facts for plan summaries, independent of edit-target distance.

Keep field definitions complete instead of applying the mutation prompt's
per-node config limit. Trigger bindings disclose their structure only, never
subscription identifiers or parameter values.
"""

import json
from collections.abc import Mapping, Sequence

from core.dify_builder.models import Graph
from core.trigger.constants import (
    TRIGGER_NODE_TYPES,
    TRIGGER_PLUGIN_NODE_TYPE,
    TRIGGER_SCHEDULE_NODE_TYPE,
    TRIGGER_WEBHOOK_NODE_TYPE,
)

_BOUNDARY_TYPES = TRIGGER_NODE_TYPES | {"start", "end", "answer"}
_FIELD_KEYS = ("name", "variable", "label", "type", "required", "description")


def _pick(data: Mapping[str, object], keys: Sequence[str]) -> dict[str, object]:
    return {key: data[key] for key in keys if key in data}


def _fields(definitions: Sequence[Mapping[str, object]]) -> list[dict[str, object]]:
    return [_pick(definition, _FIELD_KEYS) for definition in definitions]


def workflow_io_context(graph: Graph) -> str:
    """Describe every declared input and output without copying full configs."""
    boundaries: list[dict[str, object]] = []
    for node in graph.get("nodes", []):
        data = node.get("data") or {}
        node_type = data.get("type")
        if node_type not in _BOUNDARY_TYPES:
            continue
        boundary = {"id": node["id"], **_pick(data, ("type", "title"))}
        if node_type == "start":
            boundary["variables"] = _fields(data.get("variables") or [])
        elif node_type == TRIGGER_WEBHOOK_NODE_TYPE:
            boundary.update(_pick(data, ("method", "content_type")))
            for key in ("headers", "params", "body"):
                boundary[key] = _fields(data.get(key) or [])
        elif node_type == TRIGGER_SCHEDULE_NODE_TYPE:
            boundary.update(_pick(data, ("mode", "frequency", "cron_expression", "timezone")))
            if data.get("visual_config") is not None:
                boundary["visual_config"] = _pick(
                    data["visual_config"], ("on_minute", "time", "weekdays", "monthly_days")
                )
        elif node_type == TRIGGER_PLUGIN_NODE_TYPE:
            boundary.update(_pick(data, ("plugin_id", "provider_id", "event_name")))
            boundary["event_parameters"] = {
                name: _pick(binding, ("type",)) for name, binding in (data.get("event_parameters") or {}).items()
            }
        elif node_type == "end":
            boundary["outputs"] = [
                _pick(output, ("variable", "value_type", "value_selector")) for output in data.get("outputs") or []
            ]
        elif node_type == "answer":
            boundary.update(_pick(data, ("answer",)))
        boundaries.append(boundary)
    return json.dumps(boundaries, ensure_ascii=False)
