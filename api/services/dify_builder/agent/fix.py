"""Real LLM cognition for Dify Builder's Fix mode.

Pure functions called by LlmBuilderAgent when DIFY_BUILDER_AGENT_MODE=llm.
On any dead-end (no model, unparseable output, or -- for propose_repair -- no
valid repair) they DEGRADE to an honest, surface-to-human result rather than
crashing the advance or applying a canned guess.
"""

from typing import Any

from core.dify_builder.models import (
    ChecklistError,
    Diagnosis,
    Graph,
    NodeOutput,
    Run,
)
from core.model_manager import ModelInstance
from services.dify_builder.agent import llm

_SEVERITIES = {"low", "medium", "high"}


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


def diagnose(model: ModelInstance | None, failed_run: Run, graph: Graph, node_outputs: list[NodeOutput]) -> Diagnosis:
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
        data = llm.invoke_json(model, system=system, user=user)
    except Exception:  # any LLM/provider failure degrades to a surfaced result, never crashes the advance
        return _degraded_diagnosis(failed)
    fallback = failed[0].node_id if failed else ""
    return _diagnosis_from_json(data, graph, fallback_node=fallback)


def diagnose_checklist(model: ModelInstance | None, errors: list[ChecklistError], graph: Graph) -> Diagnosis:
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
        data = llm.invoke_json(model, system=system, user=user)
    except Exception:  # degrade to a surfaced result, never crash the advance
        return _degraded_checklist(errors)
    fallback = next((e.node_id for e in errors if e.node_id), "")
    return _diagnosis_from_json(data, graph, fallback_node=fallback)
