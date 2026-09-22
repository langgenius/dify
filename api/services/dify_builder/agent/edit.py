"""Real LLM cognition for Dify Builder's Edit mode.

Surgical config change on an existing graph. build_edit_intents follows the
Fix pattern: the LLM proposes targeted intents which are dry-run-validated
through graph_ops.filter_applicable before they can reach apply_repair.
Degrades to an honest result on model-None / provider-error / parse-fail."""

from collections.abc import Callable
from typing import Any

from core.dify_builder.models import MutationIntent
from core.workflow.graph_normalizers import declared_branch_handles
from graphon.enums import BUILT_IN_NODE_TYPES
from services.dify_builder import graph_ops
from services.dify_builder.agent import form_schema, llm

_ALLOWED_NODE_TYPES: set[str] = set(BUILT_IN_NODE_TYPES)

_OP_SCHEMA = (
    'Allowed ops (each as {"op": ..., "args": {...}}):\n'
    "- set_node_config: {node_id, path, value}\n"
    "- create_node: {node_type, config, node_id?}\n"
    "- delete_node: {node_id}\n"
    "- connect: {from_node, to_node, source_handle?}\n"
    "  When from_node is an if-else, question-classifier or human-input node (or a node with "
    "error_strategy fail-branch), source_handle is required and must be one of the handles "
    "listed for that node in GRAPH.\n"
    "- insert_between: {edge: {source, target}, node_type, config}\n"
)


def _node_ids(graph: dict) -> set[str]:
    return {str(n.get("id")) for n in graph.get("nodes", []) if n.get("id") is not None}


def _graph_context(graph: dict) -> str:
    lines = ["NODES:"]
    for n in graph.get("nodes", []):
        d = n.get("data") or {}
        line = f"  {n.get('id')} ({d.get('type', '?')}): {d.get('title', '')}"
        handles = declared_branch_handles(n)
        if handles:
            line += f" handles={handles}"
        lines.append(line)
    lines.append("EDGES:")
    for e in graph.get("edges", []):
        handle = e.get("sourceHandle")
        if handle and handle != "source":
            lines.append(f"  {e.get('source')} -[{handle}]-> {e.get('target')}")
        else:
            lines.append(f"  {e.get('source')} -> {e.get('target')}")
    return "\n".join(lines)


def _degraded_impact(goal_text: str) -> dict[str, Any]:
    return {
        "fields": [{"key": "change", "label": "Change", "type": "textarea", "options": []}],
        "values": {"change": goal_text},
        "target_node_ids": [],
    }


def analyze_impact(
    model,
    goal_text: str,
    graph: dict,
    on_reasoning: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    if model is None:
        return _degraded_impact(goal_text)
    system = (
        "You are a Dify workflow edit-impact analyst. Given an edit goal and the current graph, "
        "propose 2-5 goal-shaped edit-rule fields, sensible values, and which EXISTING node ids the "
        f"change touches. {form_schema.FORM_FIELD_TYPE_GUIDANCE}"
        'Reply with ONLY JSON: {"fields": [{"key","label","type","options"}], '
        '"values": {...}, "target_node_ids": ["<existing id>", ...]}.'
    ) + llm.json_language_instruction("field labels and values")
    try:
        data = llm.invoke_json(
            model,
            system=system,
            user=f"GOAL:\n{goal_text}\n\nGRAPH:\n{_graph_context(graph)}",
            on_reasoning=on_reasoning,
        )
    except Exception:
        return _degraded_impact(goal_text)
    ids = _node_ids(graph)
    raw_targets = data.get("target_node_ids")
    targets = [str(t) for t in raw_targets if str(t) in ids] if isinstance(raw_targets, list) else []
    fields = data.get("fields") if isinstance(data.get("fields"), list) else []
    values = data.get("values") if isinstance(data.get("values"), dict) else {}
    return {
        "fields": form_schema.reconcile_form_fields(fields, values),
        "values": values,
        "target_node_ids": targets,
    }


def propose_edit_plan(
    model,
    edit_rules: dict[str, Any],
    graph: dict,
    on_reasoning: Callable[[str], None] | None = None,
) -> list[str]:
    if model is None:
        return ["Apply the requested edit"]
    system = (
        'You are a Dify workflow edit planner. Reply with ONLY JSON: {"plan": ["step", ...]}.'
        + llm.json_language_instruction("plan steps")
    )
    try:
        data = llm.invoke_json(
            model,
            system=system,
            user=f"EDIT RULES:\n{edit_rules}\n\nGRAPH:\n{_graph_context(graph)}",
            on_reasoning=on_reasoning,
        )
    except Exception:
        return ["Apply the requested edit"]
    plan = data.get("plan")
    return [str(p) for p in plan] if isinstance(plan, list) and plan else ["Apply the requested edit"]


def build_edit_intents(
    model,
    edit_rules: dict[str, Any],
    graph: dict,
    on_reasoning: Callable[[str], None] | None = None,
) -> list[MutationIntent]:
    if model is None:
        return []
    system = (
        "You are a Dify workflow editor. Propose the minimal mutations that apply the edit rules to "
        "EXISTING nodes. Reference only node ids that exist and use only the listed node types. "
        'Reply with ONLY JSON: {"intents": [{"op": ..., "args": {...}}]}.\n'
        + _OP_SCHEMA
        + "Allowed node types: "
        + ", ".join(sorted(_ALLOWED_NODE_TYPES))
        + ".\n"
    )
    user = f"EDIT RULES:\n{edit_rules}\n\nGRAPH:\n{_graph_context(graph)}"
    intents = _invoke_intents(model, system, user, on_reasoning)
    if intents is None:
        return []
    applicable, rejected = graph_ops.filter_applicable(graph, intents, _ALLOWED_NODE_TYPES)
    # ANY rejection -- partial or total -- burns the one corrective re-prompt: a
    # partial reject can silently drop the one intent that mattered (e.g. a connect
    # from a branch node missing its required source_handle), so it is not safe to
    # just keep what survived without giving the model a chance to supply the rest.
    # If the retry itself yields nothing usable, fall back to the first attempt's
    # applicable intents rather than losing them.
    if rejected:
        first_applicable = applicable
        reasons = "\n".join(f"- {i.op} {i.args}: {why}" for i, why in rejected)
        retry_user = f"{user}\n\nYour previous intents were invalid:\n{reasons}\nReturn corrected intents."
        intents = _invoke_intents(model, system, retry_user, on_reasoning)
        if intents is None:
            return first_applicable
        applicable, _rejected = graph_ops.filter_applicable(graph, intents, _ALLOWED_NODE_TYPES)
        if not applicable:
            return first_applicable
    return applicable


def _invoke_intents(
    model,
    system: str,
    user: str,
    on_reasoning: Callable[[str], None] | None,
) -> list[MutationIntent] | None:
    try:
        data = llm.invoke_json(model, system=system, user=user, on_reasoning=on_reasoning)
    except Exception:
        return None
    raw = data.get("intents")
    if not isinstance(raw, list):
        return None
    out: list[MutationIntent] = []
    for item in raw:
        if isinstance(item, dict) and isinstance(item.get("op"), str) and isinstance(item.get("args"), dict):
            out.append(MutationIntent(op=item["op"], args=item["args"]))
        else:
            return None
    return out
