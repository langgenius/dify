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
    BuiltinNodeTypes.LIST_OPERATOR: {"data access": ("variable",)},
    BuiltinNodeTypes.ITERATION: {"data access": ("iterator_selector", "output_selector")},
    BuiltinNodeTypes.AGENT: {"data access": ("memory",)},
    # Native aggregator selectors are list[list[str]], rooted at arbitrary
    # upstream node IDs. Group settings choose which selector lists are read.
    BuiltinNodeTypes.VARIABLE_AGGREGATOR: {"data access": ("variables", "advanced_settings")},
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

    if data.get("type") == BuiltinNodeTypes.AGENT:
        parameters = data.get("agent_parameters")
        if isinstance(parameters, dict):
            for name, parameter in parameters.items():
                if not isinstance(parameter, dict):
                    continue
                path = ("agent_parameters", name, "value")
                value = parameter.get("value")
                if parameter.get("type") == "variable":
                    # The discriminator activates variable_pool.get even if
                    # the selector-looking value itself did not change.
                    remember("data access", path, value)
                elif parameter.get("type") in ("constant", "mixed"):
                    # Native MODEL_SELECTOR values use dynamic parameter names,
                    # not necessarily a key named `model`. Protect the known
                    # provider/model descriptor, including completion params.
                    if isinstance(value, dict) and "provider" in value and "model" in value:
                        remember("model configuration", path, value)
                    if not isinstance(value, list):
                        continue
                    for index, tool in enumerate(value):
                        if not isinstance(tool, dict) or not {"provider_name", "tool_name"} <= tool.keys():
                            continue
                        tool_path = (*path, str(index))
                        enabled = bool(tool.get("enabled", False))
                        remember("resource or credential binding", (*tool_path, "enabled"), enabled)
                        tool_parameters = tool.get("parameters", {})
                        if not enabled or not isinstance(tool_parameters, dict):
                            continue
                        # Native Agent runtime only decodes typed tool inputs
                        # when every parameter has the new dictionary shape.
                        if not all(isinstance(item, dict) for item in tool_parameters.values()):
                            continue
                        for key, item in tool_parameters.items():
                            binding = item.get("value")
                            if (
                                item.get("auto", 1) == 0
                                and isinstance(binding, dict)
                                and binding.get("type") == "variable"
                            ):
                                remember("data access", (*tool_path, "parameters", key, "value"), binding.get("value"))

    def visit(value: Any, path: tuple[str, ...], *, unnamed_selectors: bool = True) -> None:
        if isinstance(value, dict):
            literal_agent_input = (
                data.get("type") == BuiltinNodeTypes.AGENT
                and len(path) == 2
                and path[0] == "agent_parameters"
                and value.get("type") in ("constant", "mixed")
            )
            for key, item in value.items():
                child_path = (*path, key)
                if key in _MODEL_KEYS:
                    remember("model configuration", child_path, item)
                if key in _RESOURCE_KEYS:
                    remember("resource or credential binding", child_path, item)
                if key in _ACCESS_KEYS:
                    remember("data access", child_path, item)
                visit(
                    item,
                    child_path,
                    unnamed_selectors=unnamed_selectors and not (literal_agent_input and key == "value"),
                )
        elif isinstance(value, list):
            # Tool/Agent variable inputs may store selectors under `value`
            # rather than a key named `variable_selector`.
            if unnamed_selectors and value and value[0] == "conversation":
                remember("data access", path, value)
            for index, item in enumerate(value):
                visit(item, (*path, str(index)), unnamed_selectors=unnamed_selectors)
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
