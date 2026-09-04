"""Real LLM cognition for Dify Builder's Fix mode.

Pure functions called by ``LlmBuilderAgent`` for Fix cognition.
On any dead-end (no model, unparseable output, or -- for propose_repair -- no
valid repair) they DEGRADE to an honest, surface-to-human result rather than
crashing the advance or applying a canned guess.
"""

from collections.abc import Callable
from typing import Any

from core.dify_builder.models import (
    ChecklistError,
    Diagnosis,
    Graph,
    MutationIntent,
    NodeOutput,
    Risk,
    Run,
)
from core.model_manager import ModelInstance
from graphon.enums import BUILT_IN_NODE_TYPES, BuiltinNodeTypes
from services.dify_builder import graph_ops
from services.dify_builder.agent import llm

_SEVERITIES = {"low", "medium", "high"}

# `BuiltinNodeTypes` is a plain namespace class of string ClassVars (not a StrEnum/Enum
# in this graphon version) so it isn't iterable itself; `BUILT_IN_NODE_TYPES` is the
# tuple of every member's value and is what we iterate to build the allow-list.
_ALLOWED_NODE_TYPES: set[str] = set(BUILT_IN_NODE_TYPES)

# Node types whose execution has effects OUTSIDE the workflow (network / tool calls).
# A Code node is treated as sandboxed compute (NOT external) in v1 so a config/code fix
# can auto-apply.
_EXTERNAL_SIDE_EFFECT_TYPES: set[str] = {str(BuiltinNodeTypes.HTTP_REQUEST), str(BuiltinNodeTypes.TOOL)}

_OP_SCHEMA = (
    'Allowed ops (each as {"op": ..., "args": {...}}):\n'
    "- set_node_config: {node_id, path, value}\n"
    "- create_node: {node_type, config, node_id?}\n"
    "- delete_node: {node_id}\n"
    "- connect: {from_node, to_node}\n"
    "- insert_between: {edge: {source, target}, node_type, config}\n"
)


def _truncate(value: Any, limit: int = 300) -> str:
    text = str(value)
    return text if len(text) <= limit else text[:limit] + "…"


def _graph_context(graph: Graph) -> str:
    """Compact LLM-readable view: each node as 'id (type): title' + edges."""
    lines = ["NODES:"]
    for node in graph.get("nodes", []):
        data = node.get("data") or {}
        lines.append(f"  {node.get('id')} ({data.get('type', '?')}): {data.get('title', '')}")
    lines.append("EDGES:")
    for edge in graph.get("edges", []):
        lines.append(f"  {edge.get('source')} -> {edge.get('target')}")
    return "\n".join(lines)


def _node_ids(graph: Graph) -> set[str]:
    return {str(n.get("id")) for n in graph.get("nodes", []) if n.get("id") is not None}


def _coerce_severity(value: Any) -> str:
    text = str(value or "").lower()
    return text if text in _SEVERITIES else "medium"


def _failed_nodes(node_outputs: list[NodeOutput]) -> list[NodeOutput]:
    return [o for o in node_outputs if o.status in ("failed", "exception")]


def _diagnosis_from_json(
    data: dict[str, Any],
    graph: Graph,
    *,
    fallback_node: str = "",
) -> Diagnosis:
    culprit = str(data.get("culprit_node_id") or "")
    if culprit not in _node_ids(graph):
        culprit = fallback_node
    root_cause = str(data.get("root_cause") or "") or "Diagnosis produced no explanation."
    return Diagnosis(culprit_node_id=culprit, root_cause=root_cause, severity=_coerce_severity(data.get("severity")))


def _degraded_diagnosis(failed: list[NodeOutput]) -> Diagnosis:
    if failed:
        node = failed[0]
        return Diagnosis(
            culprit_node_id=node.node_id,
            root_cause=f"Automatic diagnosis unavailable — node error: {node.error or '(none)'}",
            severity="high",
        )
    return Diagnosis(culprit_node_id="", root_cause="Automatic diagnosis unavailable.", severity="medium")


def _degraded_checklist(errors: list[ChecklistError]) -> Diagnosis:
    for error in errors:
        if error.messages:
            return Diagnosis(culprit_node_id=error.node_id, root_cause=error.messages[0], severity="medium")
    return Diagnosis(culprit_node_id="", root_cause="Checklist error", severity="medium")


def diagnose(
    model: ModelInstance | None,
    failed_run: Run,
    graph: Graph,
    node_outputs: list[NodeOutput],
    on_reasoning: Callable[[str], None] | None = None,
) -> Diagnosis:
    failed = _failed_nodes(node_outputs)
    if model is None:
        return _degraded_diagnosis(failed)
    system = (
        "You are a Dify workflow debugging assistant. Given a failed workflow run, identify the "
        "single node that caused the failure and the root cause. Reply with ONLY a JSON object: "
        '{"culprit_node_id": "<an existing node id>", "root_cause": "<concise explanation>", '
        '"severity": "low|medium|high"}.'
    )
    failed_desc = (
        "\n".join(
            f"- {o.node_id} ({o.title}) status={o.status} error={o.error!r} "
            f"inputs={_truncate(o.inputs)} outputs={_truncate(o.outputs)}"
            for o in failed
        )
        or "(no per-node failure recorded)"
    )
    user = f"FAILED NODES:\n{failed_desc}\n\nGRAPH:\n{_graph_context(graph)}"
    try:
        data = llm.invoke_json(model, system=system, user=user, on_reasoning=on_reasoning)
    except Exception:  # any LLM/provider failure degrades to a surfaced result, never crashes the advance
        return _degraded_diagnosis(failed)
    fallback = failed[0].node_id if failed else ""
    return _diagnosis_from_json(data, graph, fallback_node=fallback)


def diagnose_checklist(
    model: ModelInstance | None,
    errors: list[ChecklistError],
    graph: Graph,
    on_reasoning: Callable[[str], None] | None = None,
) -> Diagnosis:
    if model is None:
        return _degraded_checklist(errors)
    system = (
        "You are a Dify workflow pre-publish checker. Given checklist errors, identify the single "
        "most important node to fix and the root cause. Reply with ONLY a JSON object: "
        '{"culprit_node_id": "<an existing node id>", "root_cause": "<concise explanation>", '
        '"severity": "low|medium|high"}.'
    )
    errs = (
        "\n".join(
            f"- {e.node_id} ({e.node_type}) {e.title}: {'; '.join(e.messages)} "
            f"unconnected={e.unconnected} plugin_missing={e.plugin_missing}"
            for e in errors
        )
        or "(no checklist errors)"
    )
    user = f"CHECKLIST ERRORS:\n{errs}\n\nGRAPH:\n{_graph_context(graph)}"
    try:
        data = llm.invoke_json(model, system=system, user=user, on_reasoning=on_reasoning)
    except Exception:  # degrade to a surfaced result, never crash the advance
        return _degraded_checklist(errors)
    fallback = next((e.node_id for e in errors if e.node_id), "")
    return _diagnosis_from_json(data, graph, fallback_node=fallback)


def _no_fix() -> tuple[list[MutationIntent], Risk]:
    return [], Risk(
        level="high",
        reason="No safe automatic fix found — please review the diagnosis and edit the canvas manually, or reject.",
        has_external_side_effect=False,
    )


def _culprit_config(node_id: str, graph: Graph) -> str:
    for node in graph.get("nodes", []):
        if node.get("id") == node_id:
            return _truncate(node.get("data") or {}, limit=1500)
    return "(culprit node not found in graph)"


def _parse_repair(data: dict[str, Any]) -> tuple[list[MutationIntent] | None, Risk]:
    raw = data.get("intents")
    if not isinstance(raw, list):
        return None, _no_fix()[1]
    intents: list[MutationIntent] = []
    for item in raw:
        if isinstance(item, dict) and isinstance(item.get("op"), str) and isinstance(item.get("args"), dict):
            intents.append(MutationIntent(op=item["op"], args=item["args"]))
        else:
            return None, _no_fix()[1]
    risk_raw = data.get("risk") if isinstance(data.get("risk"), dict) else {}
    risk = Risk(
        level="high" if str(risk_raw.get("level", "")).lower() == "high" else "low",
        reason=str(risk_raw.get("reason", "")),
        has_external_side_effect=bool(risk_raw.get("has_external_side_effect", False)),
    )
    return intents, risk


def _touched_node_types(intents: list[MutationIntent], graph: Graph) -> set[str]:
    by_id = {n.get("id"): str((n.get("data") or {}).get("type", "")) for n in graph.get("nodes", [])}
    types: set[str] = set()
    for intent in intents:
        if intent.op in ("create_node", "insert_between"):
            types.add(str(intent.args.get("node_type", "")))
        elif intent.op == "connect":
            types.update(by_id.get(intent.args.get(key), "") for key in ("from_node", "to_node"))
        else:  # set_node_config / delete_node -> node_id
            types.add(by_id.get(intent.args.get("node_id"), ""))
    return types


def _shape_risk(intents: list[MutationIntent], graph: Graph, llm_risk: Risk) -> Risk:
    structural = any(i.op in graph_ops.STRUCTURAL_OPS for i in intents)
    touched_external = bool(_touched_node_types(intents, graph) & _EXTERNAL_SIDE_EFFECT_TYPES)
    external = touched_external or llm_risk.has_external_side_effect
    if structural or external:
        return Risk(
            level="high",
            reason=llm_risk.reason or "Structural or side-effecting change — needs review.",
            has_external_side_effect=external,
        )
    return Risk(
        level=llm_risk.level or "low",
        reason=llm_risk.reason or "Config-only fix.",
        has_external_side_effect=False,
    )


def _invoke_repair(
    model: ModelInstance,
    system: str,
    user: str,
    on_reasoning: Callable[[str], None] | None,
) -> tuple[list[MutationIntent] | None, Risk]:
    try:
        data = llm.invoke_json(model, system=system, user=user, on_reasoning=on_reasoning)
    except Exception:  # degrade to a surfaced result, never crash the advance
        return None, _no_fix()[1]
    return _parse_repair(data)


def propose_repair(
    model: ModelInstance | None,
    diagnosis: Diagnosis,
    graph: Graph,
    on_reasoning: Callable[[str], None] | None = None,
) -> tuple[list[MutationIntent], Risk]:
    if model is None:
        return _no_fix()
    system = (
        "You are a Dify workflow repair assistant. Propose the minimal set of mutations that fix "
        "the diagnosed problem. Reference only node ids that exist in the graph, and use only the "
        "listed node types. Reply with ONLY a JSON object: "
        '{"intents": [{"op": ..., "args": {...}}], '
        '"risk": {"level": "low|high", "reason": "...", "has_external_side_effect": true|false}}.\n'
        + _OP_SCHEMA
        + "Allowed node types: "
        + ", ".join(sorted(_ALLOWED_NODE_TYPES))
        + ".\n"
    )
    user = (
        f"DIAGNOSIS:\n culprit={diagnosis.culprit_node_id}\n root_cause={diagnosis.root_cause}\n"
        f" severity={diagnosis.severity}\n\nCULPRIT NODE CONFIG:\n{_culprit_config(diagnosis.culprit_node_id, graph)}"
        f"\n\nGRAPH:\n{_graph_context(graph)}"
    )
    intents, risk = _invoke_repair(model, system, user, on_reasoning)
    if intents is None:
        return _no_fix()
    applicable, rejected = graph_ops.filter_applicable(graph, intents, _ALLOWED_NODE_TYPES)
    if rejected:
        reasons = "\n".join(f"- {i.op} {i.args}: {why}" for i, why in rejected)
        retry_user = f"{user}\n\nYour previous intents were invalid:\n{reasons}\nReturn corrected intents."
        intents, risk = _invoke_repair(model, system, retry_user, on_reasoning)
        if intents is None:
            return _no_fix()
        applicable, rejected = graph_ops.filter_applicable(graph, intents, _ALLOWED_NODE_TYPES)
        if rejected:
            return _no_fix()
    if not applicable:
        return _no_fix()
    return applicable, _shape_risk(applicable, graph, risk)
