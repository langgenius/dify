"""Deterministic approval reasons for sensitive Fix configuration changes.

This judges the graph the native mutation helpers would write, independently
of the model's risk label. It does not authorize a mutation or replace native
preflight: malformed proposals still take Fix's corrective/refusal path.
"""

import re
from typing import Any

from core.dify_builder.models import Graph, MutationIntent
from graphon.enums import BuiltinNodeTypes
from services.dify_builder import graph_ops

# Whole model configuration includes cost-affecting completion parameters.
# These also occur nested in retrieval and legacy Agent configurations.
_MODEL_KEYS = frozenset({"model", "model_config", "metadata_model_config", "reranking_model", "embedding_model"})
_RESOURCE_KEYS = frozenset(
    {
        "credential_id",
        "provider_id",
        "provider_type",
        "provider_name",
        "tool_name",
        "plugin_unique_identifier",
        "resource_id",
        "resource_ids",
        "dataset_id",
        "dataset_ids",
        "app_id",
        "workflow_id",
        "data_source_id",
        "datasource_id",
        "agent_strategy_provider_name",
        "agent_strategy_name",
    }
)
_ACCESS_KEYS = frozenset(
    {
        "variable_selector",
        "value_selector",
        "query_variable_selector",
        "query_attachment_selector",
        "conversation_variables",
        "retrieval_mode",
        "single_retrieval_config",
        "multiple_retrieval_config",
        "metadata_filtering_mode",
        "metadata_filtering_conditions",
    }
)
_NODE_FIELDS: dict[str, dict[str, tuple[str, ...]]] = {
    BuiltinNodeTypes.START: {"input contract": ("variables",)},
    BuiltinNodeTypes.END: {"output contract": ("outputs",)},
    BuiltinNodeTypes.HTTP_REQUEST: {
        "HTTP target or authentication": ("url", "method", "authorization", "headers", "params", "ssl_verify"),
    },
    BuiltinNodeTypes.LLM: {"data access": ("context", "memory", "vision")},
    BuiltinNodeTypes.VARIABLE_ASSIGNER: {
        "conversation-variable write": ("items", "assigned_variable_selector", "input_variable_selector", "write_mode"),
    },
}
_TEMPLATE_BINDING = re.compile(r"\{\{#([^#]+)#\}\}")


def _sensitive_values(data: dict[str, Any]) -> dict[str, dict[tuple[str, ...], Any]]:
    """Project sensitive fields without returning their values in reason text.

    Recurse through objects and arrays so replacing a parent cannot hide a
    resource/credential removal, a model change, or a variable binding. Paths
    distinguish multiple models/resources; absence differs from a present
    null value. Ordinary prompt text is excluded while its data bindings stay
    visible to the policy.
    """
    result: dict[str, dict[tuple[str, ...], Any]] = {}

    def remember(category: str, path: tuple[str, ...], value: Any) -> None:
        result.setdefault(category, {})[path] = value

    for category, keys in _NODE_FIELDS.get(data.get("type", ""), {}).items():
        for key in keys:
            if key in data:
                remember(category, (key,), data[key])
    if "type" in data:
        remember("node type", ("type",), data["type"])

    def visit(value: Any, path: tuple[str, ...]) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                child_path = (*path, key)
                if key in _MODEL_KEYS:
                    remember("model configuration", child_path, item)
                if key in _RESOURCE_KEYS:
                    remember("resource or credential binding", child_path, item)
                if key in _ACCESS_KEYS:
                    remember("data access", child_path, item)
                visit(item, child_path)
        elif isinstance(value, list):
            # Tool/Agent variable inputs may store selectors under `value`
            # rather than a key named `variable_selector`.
            if value and value[0] == "conversation":
                remember("data access", path, value)
            for index, item in enumerate(value):
                visit(item, (*path, str(index)))
        elif isinstance(value, str):
            bindings = tuple(_TEMPLATE_BINDING.findall(value))
            if bindings:
                remember("data access", path, bindings)

    visit(data, ())
    return result


def sensitive_change_reasons(graph: Graph, intents: list[MutationIntent]) -> list[str]:
    """Compare the final native before/after effect and return safe review reasons.

    Fix calls this after native preflight accepts the complete batch. Reuse
    its dry-run owner (including idempotent operations and healing), rather
    than implementing a competing dotted-path writer. Normalize the baseline
    identically so native healing alone is not reported as a model change.
    Invalid batches are high risk here as well, without copying exception
    text or argument values into the reason shown to the human.
    """
    after = graph_ops.filter_applicable(graph, intents)
    if after.rejected:
        return ["Invalid mutation proposal — needs native preflight review."]
    before = graph_ops.filter_applicable(graph, []).graph
    before_by_id = {node.get("id"): node.get("data") or {} for node in before.get("nodes", [])}
    after_by_id = {node.get("id"): node.get("data") or {} for node in after.graph.get("nodes", [])}
    reasons: list[str] = []
    for node_id in dict.fromkeys(after.changed_nodes):
        # Structural changes already have their own mandatory approval guard.
        if node_id not in before_by_id or node_id not in after_by_id:
            continue
        old = _sensitive_values(before_by_id[node_id])
        new = _sensitive_values(after_by_id[node_id])
        for category in sorted(old.keys() | new.keys()):
            if old.get(category) != new.get(category):
                reasons.append(f"{node_id}: {category} changed — needs review.")
    return reasons
