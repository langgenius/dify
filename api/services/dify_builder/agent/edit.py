"""Real LLM cognition for Dify Builder's Edit mode.

Surgical config change on an existing graph. build_edit_intents follows the
Fix pattern: the LLM proposes targeted intents which are dry-run-validated
through graph_ops.filter_applicable before they can reach apply_repair.
Degrades to an honest result on model-None / provider-error / parse-fail."""

from typing import Any

from core.dify_builder.models import MutationIntent
from graphon.enums import BUILT_IN_NODE_TYPES
from services.dify_builder import graph_ops
from services.dify_builder.agent import llm

_ALLOWED_NODE_TYPES: set[str] = set(BUILT_IN_NODE_TYPES)

_OP_SCHEMA = (
    'Allowed ops (each as {"op": ..., "args": {...}}):\n'
    "- set_node_config: {node_id, path, value}\n"
    "- create_node: {node_type, config, node_id?}\n"
    "- delete_node: {node_id}\n"
    "- connect: {from_node, to_node}\n"
    "- insert_between: {edge: {source, target}, node_type, config}\n"
)


def _node_ids(graph: dict) -> set[str]:
    return {str(n.get("id")) for n in graph.get("nodes", []) if n.get("id") is not None}


def _graph_context(graph: dict) -> str:
    lines = ["NODES:"]
    for n in graph.get("nodes", []):
        d = n.get("data") or {}
        lines.append(f"  {n.get('id')} ({d.get('type', '?')}): {d.get('title', '')}")
    lines.append("EDGES:")
    for e in graph.get("edges", []):
        lines.append(f"  {e.get('source')} -> {e.get('target')}")
    return "\n".join(lines)


def _degraded_impact(goal_text: str) -> dict[str, Any]:
    return {"fields": [{"key": "change", "label": "Change", "type": "textarea", "options": []}],
            "values": {"change": goal_text}, "target_node_ids": []}


def analyze_impact(model, goal_text: str, graph: dict) -> dict[str, Any]:
    if model is None:
        return _degraded_impact(goal_text)
    system = (
        "You are a Dify workflow edit-impact analyst. Given an edit goal and the current graph, "
        "propose 2-5 goal-shaped edit-rule fields, sensible values, and which EXISTING node ids the "
        'change touches. Reply with ONLY JSON: {"fields": [{"key","label","type","options"}], '
        '"values": {...}, "target_node_ids": ["<existing id>", ...]}.'
    )
    try:
        data = llm.invoke_json(model, system=system, user=f"GOAL:\n{goal_text}\n\nGRAPH:\n{_graph_context(graph)}")
    except Exception:
        return _degraded_impact(goal_text)
    ids = _node_ids(graph)
    targets = [str(t) for t in (data.get("target_node_ids") or []) if str(t) in ids]
    fields = data.get("fields") if isinstance(data.get("fields"), list) else []
    values = data.get("values") if isinstance(data.get("values"), dict) else {}
    return {"fields": fields, "values": values, "target_node_ids": targets}


def propose_edit_plan(model, edit_rules: dict[str, Any], graph: dict) -> list[str]:
    if model is None:
        return ["Apply the requested edit"]
    system = 'You are a Dify workflow edit planner. Reply with ONLY JSON: {"plan": ["step", ...]}.'
    try:
        data = llm.invoke_json(
            model, system=system, user=f"EDIT RULES:\n{edit_rules}\n\nGRAPH:\n{_graph_context(graph)}"
        )
    except Exception:
        return ["Apply the requested edit"]
    plan = data.get("plan")
    return [str(p) for p in plan] if isinstance(plan, list) and plan else ["Apply the requested edit"]


def build_edit_intents(model, edit_rules: dict[str, Any], graph: dict) -> list[MutationIntent]:
    if model is None:
        return []
    system = (
        "You are a Dify workflow editor. Propose the minimal mutations that apply the edit rules to "
        "EXISTING nodes. Reference only node ids that exist and use only the listed node types. "
        'Reply with ONLY JSON: {"intents": [{"op": ..., "args": {...}}]}.\n' + _OP_SCHEMA
        + "Allowed node types: " + ", ".join(sorted(_ALLOWED_NODE_TYPES)) + ".\n"
    )
    user = f"EDIT RULES:\n{edit_rules}\n\nGRAPH:\n{_graph_context(graph)}"
    intents = _invoke_intents(model, system, user)
    if intents is None:
        return []
    applicable, rejected = graph_ops.filter_applicable(graph, intents, _ALLOWED_NODE_TYPES)
    # A partial reject still leaves usable intents -- keep them, no re-prompt needed. Only a
    # TOTAL reject (nothing survived the dry run) burns the one corrective re-prompt.
    if not applicable and rejected:
        reasons = "\n".join(f"- {i.op} {i.args}: {why}" for i, why in rejected)
        retry_user = f"{user}\n\nYour previous intents were invalid:\n{reasons}\nReturn corrected intents."
        intents = _invoke_intents(model, system, retry_user)
        if intents is None:
            return []
        applicable, _rejected = graph_ops.filter_applicable(graph, intents, _ALLOWED_NODE_TYPES)
    return applicable


def _invoke_intents(model, system: str, user: str) -> list[MutationIntent] | None:
    try:
        data = llm.invoke_json(model, system=system, user=user)
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
