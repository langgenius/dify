"""Attribute bounded native resource failures using their executed graph.

This is presentation evidence, never a grant or proof that earlier nodes had no
effects. Ambiguous failures and arbitrary Code exception text are not classified.
"""

import json
import re
from collections.abc import Mapping
from typing import Literal

from core.dify_builder.models import Run
from services.dify_builder.native_launch_observation import FailureResource, _public_id

NativeResourceReason = Literal["service_unavailable", "authentication", "permission_denied"]


def native_resource_failure(
    run: Run, graph: Mapping
) -> tuple[FailureResource, tuple[str, ...], NativeResourceReason] | None:
    if run.status != "failed" or not run.dify_run_id:
        return None
    failed = [node for node in run.per_node if node.status in {"failed", "exception"}]
    if len(failed) != 1:
        return None
    failure = failed[0]
    if not _public_id(failure.node_id):
        return None
    graph_nodes = graph.get("nodes")
    if not isinstance(graph_nodes, list):
        return None
    nodes = [node for node in graph_nodes if isinstance(node, dict) and node.get("id") == failure.node_id]
    if len(nodes) != 1 or not isinstance(data := nodes[0].get("data"), dict):
        return None
    kind: Literal["model", "tool"]
    if data.get("type") == "llm" and isinstance(model := data.get("model"), dict):
        kind, provider, name = "model", model.get("provider"), model.get("name")
    elif data.get("type") == "tool" and data.get("provider_type") in {"builtin", "plugin"}:
        kind, provider, name = "tool", data.get("provider_id"), data.get("tool_name")
    else:
        return None
    if not isinstance(provider, str) or not isinstance(name, str) or not _public_id(provider) or not _public_id(name):
        return None
    reason = _native_reason(failure.error, kind)
    return ((kind, provider, name), (failure.node_id,), reason) if reason is not None else None


def _native_reason(error: str, kind: Literal["model", "tool"]) -> NativeResourceReason | None:
    if re.fullmatch(r"Request to Plugin Daemon Service failed-(?:500|502|503|504)", error.strip()):
        return "service_unavailable"
    if len(error) > 32768:
        return None
    envelope = re.fullmatch(r"(?:Run failed: |req_id: [A-Za-z0-9-]{1,128} )?PluginInvokeError: (.+)", error, re.DOTALL)
    if envelope is None:
        return None
    try:
        payload = json.loads(envelope[1])
        args = payload.get("args") if isinstance(payload, dict) else None
        description = args.get("description") if isinstance(args, dict) else None
        if not isinstance(description, str):
            return None
        prefix = "models" if kind == "model" else "tools"
        match = re.fullmatch(
            r"\[" + prefix + r"\] Error: [^\n]*?status code (401|403): (\{.+\})", description, re.DOTALL
        )
        if match is None:
            return None
        body = json.loads(match[2])
        detail = body.get("error") if isinstance(body, dict) else None
        category = detail.get("type") if isinstance(detail, dict) else None
    except (ValueError, TypeError, RecursionError):
        return None
    if (match[1], category) == ("401", "authentication_error"):
        return "authentication"
    if (match[1], category) == ("403", "permission_denied"):
        return "permission_denied"
    return None


def plugin_service_failure(run: Run, graph: Mapping) -> tuple[FailureResource, tuple[str, ...]] | None:
    """Retain the outage-only adapter contract for existing consumers."""
    failure = native_resource_failure(run, graph)
    return (failure[0], failure[1]) if failure is not None and failure[2] == "service_unavailable" else None
