"""Attribute a fixed native plugin-service failure using its executed graph.

This is presentation evidence, never a grant or proof that earlier nodes had no
effects. Ambiguous failures and arbitrary Code exception text are not classified.
"""

import re
from collections.abc import Mapping
from typing import Literal

from core.dify_builder.models import Run
from services.dify_builder.native_launch_observation import FailureResource, _public_id


def plugin_service_failure(run: Run, graph: Mapping) -> tuple[FailureResource, tuple[str, ...]] | None:
    if run.status != "failed" or not run.dify_run_id:
        return None
    failed = [node for node in run.per_node if node.status in {"failed", "exception"}]
    if len(failed) != 1:
        return None
    failure = failed[0]
    if not _public_id(failure.node_id) or not re.fullmatch(
        r"Request to Plugin Daemon Service failed-(?:500|502|503|504)", failure.error.strip()
    ):
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
    return (kind, provider, name), (failure.node_id,)
