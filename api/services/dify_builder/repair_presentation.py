"""Bounded repair replies; intentions never serve as evidence of committed changes.

Only native diff records in ApplyResult establish applied fields/connections.
Display projections neither mutate evidence nor grant execution authority.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from core.dify_builder.models import ApplyResult, Diagnosis, Graph, MutationIntent, Risk, Run
from services.dify_builder.build_presentation import _MARKDOWN, _NATIVE_NAMES
from services.dify_builder.diagnostic_context import redact_diagnostic_text


@dataclass
class _Display:
    """Per-reply redaction cache, never attached to the graph or persisted evidence."""

    graph: Graph
    cache: dict[str, str]


def _display(graph: Graph) -> _Display:
    """Build a private redaction projection without changing caller-owned evidence."""
    return _Display(graph={**graph, "credentials": _private_literals(graph)}, cache={})


def _literal(value: str, display: _Display, limit: int = 100) -> str:
    """Accept untrusted text; return bounded, redacted, single-line Markdown text."""
    if value not in display.cache:
        safe = redact_diagnostic_text(value, Run(), display.graph, [])
        safe = re.sub(r"https?://[^\s)]+", "[URL]", safe, flags=re.IGNORECASE)
        display.cache[value] = " ".join(safe.split())
    safe = display.cache[value]
    return _MARKDOWN.sub(r"\\\1", safe[:limit] + ("…" if len(safe) > limit else ""))


def _private_literals(value: Any) -> list[str]:
    """Collect opaque code/payload text so rationale cannot echo those literals."""
    if isinstance(value, dict):
        hidden: list[str] = []
        for key, child in value.items():
            if key in {"code", "inputs", "outputs", "prompt_template", "body"}:
                hidden.extend(_string_values(child))
            else:
                hidden.extend(_private_literals(child))
        return hidden
    if isinstance(value, list):
        return [text for child in value for text in _private_literals(child)]
    return []


def _string_values(value: Any) -> list[str]:
    """Collect opaque string values only; keys remain useful field evidence."""
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, dict):
        return [text for child in value.values() for text in _string_values(child)]
    if isinstance(value, list):
        return [text for child in value for text in _string_values(child)]
    return []


def _mutation_provenance(intent: MutationIntent) -> dict[str, Any]:
    """Reconstruct a set path only for redaction; never apply or alter the mutation.

    Existing credential and opaque-ancestor policies must see the destination
    field, including indexed/dotted paths. Other verbs retain their config tree.
    """
    path = intent.args.get("path")
    if intent.op != "set_node_config" or not isinstance(path, str):
        return intent.args
    segments = path.split(".")
    projection: dict[str, Any] = {segments[-1]: intent.args.get("value")}
    for segment in reversed(segments[:-1]):
        projection = {segment: projection}
    return projection


def _names(graph: _Display, chinese: bool) -> dict[str, str]:
    """Project existing identities without guessing names from identifier syntax."""
    names: dict[str, str] = {}
    for node in graph.graph.get("nodes", []):
        node_id, data = node.get("id"), node.get("data", {})
        if isinstance(node_id, str) and isinstance(data, dict):
            title, node_type = data.get("title"), data.get("type")
            label = title.strip() if isinstance(title, str) else ""
            if not label or label == node_id:
                native = _NATIVE_NAMES.get(node_type) if isinstance(node_type, str) else None
                label = native[int(chinese)] if native else node_id
            names[node_id] = _literal(label, graph)
    return names


def _groups(groups: dict[str, list[str]], names: dict[str, str], graph: _Display, chinese: bool) -> list[str]:
    """Render at most eight node groups and eight distinct details per group."""
    lines = []
    for node_id, details in list(groups.items())[:8]:
        label = names.get(node_id, _literal(node_id, graph))
        distinct = list(dict.fromkeys(details))
        more = "；另有变更" if chinese else "; additional changes omitted"
        body = "; ".join(distinct[:8])
        omitted = len(distinct) > 8 or len(body) > 280
        lines.append(f"- {label}: " + body[:280] + (more if omitted else ""))
    if len(groups) > 8:
        lines.append("- 其余节点变更已省略。" if chinese else "- Additional node changes omitted.")
    return lines


def _retest(chinese: bool) -> str:
    """Describe the unchanged verification boundary, never a successful test."""
    return (
        "尚未验证修复效果；需发起新的测试运行，检查受影响路径及最终输出。原运行记录保持不变。"
        if chinese
        else "The repair is not verified; start a new Test Run and check the affected paths and final output. "
        "The original Run remains unchanged."
    )


def repair_proposal(
    graph: Graph, intents: Sequence[MutationIntent], diagnosis: Diagnosis, risk: Risk, reply_language: str
) -> str:
    """Accept already-read graph/staged intents; return safe proposal text, with no I/O.

    Proposed fields and selectors are descriptive only. All arbitrary values,
    including code literals, remain outside this projection.
    """
    chinese = reply_language.lower().startswith("zh")
    # Include proposed credentials in provenance before rendering any free text.
    provenance = _display({**graph, "repair_values": [_mutation_provenance(intent) for intent in intents]})
    names = _names(provenance, chinese)
    groups: dict[str, list[str]] = {}
    for index, intent in enumerate(intents):
        args = intent.args
        node_id = str(args.get("node_id", args.get("from_node", "")))
        reuse_named_node = intent.op == "insert_between" and args.get("reuse_existing") is True and node_id in names
        if intent.op in {"create_node", "insert_between"} and not reuse_named_node:
            node_id = node_id or f"new:{index}"
            config = args.get("config", {})
            node_type = args.get("node_type")
            title = config.get("title") if isinstance(config, dict) else None
            native = _NATIVE_NAMES.get(node_type) if isinstance(node_type, str) else None
            names[node_id] = (
                _literal(title, provenance)
                if isinstance(title, str) and title.strip()
                else (native[int(chinese)] if native else _literal(node_id or "Node", provenance))
            )
        detail = "检查未支持的变更" if chinese else "Review unsupported change"
        if intent.op == "set_node_config":
            path = args.get("path", "")
            field = _literal(str(path), provenance, 120)
            detail = ("更新字段 " if chinese else "Update field ") + field
            value = args.get("value")
            if str(path).split(".")[0] in {"variables", "outputs", "value_selector"}:
                detail += _bindings(value, names, provenance, chinese)
        elif intent.op == "delete_node":
            detail = "删除节点" if chinese else "Delete node"
        elif intent.op == "create_node":
            detail = "创建节点" if chinese else "Create node"
        elif intent.op == "insert_between":
            edge = args.get("edge", {})
            source = str(edge.get("source", "")) if isinstance(edge, dict) else ""
            target = str(edge.get("target", "")) if isinstance(edge, dict) else ""
            detail = (
                ("插入至连接 " if chinese else "Insert between ")
                + names.get(source, _literal(source, provenance))
                + " → "
                + names.get(target, _literal(target, provenance))
            )
        elif intent.op == "connect":
            target = str(args.get("to_node", ""))
            detail = ("连接到 " if chinese else "Connect to ") + names.get(target, _literal(target, provenance))
        groups.setdefault(node_id, []).append(detail)
    lines = ["拟议修复：" if chinese else "Proposed fix:"]
    lines += _groups(groups, names, provenance, chinese)
    if diagnosis.root_cause:
        lines.append(("原因：" if chinese else "Cause: ") + _literal(diagnosis.root_cause, provenance, 600))
    if risk.reason:
        lines.append(
            ("修复理由与风险：" if chinese else "Rationale and risk: ") + _literal(risk.reason, provenance, 800)
        )
    if risk.has_external_side_effect:
        lines.append(
            "涉及外部副作用；测试前需检查目标和账号。"
            if chinese
            else "External side effects are involved; review the target and account before testing."
        )
    lines.append(
        "变更可能影响行为、绑定或权限；测试前请检查。"
        if chinese
        else "Changes may affect behavior, bindings or permissions; review them before testing."
    )
    lines.append(_retest(chinese))
    return "\n".join(lines)


def _bindings(value: Any, names: dict[str, str], graph: _Display, chinese: bool) -> str:
    """Expose selector identities only, never arbitrary nested configuration values."""
    selectors: list[list[Any]] = []
    if isinstance(value, list) and value and all(isinstance(part, str) for part in value):
        selectors = [value]
    elif isinstance(value, list):
        selectors = [
            entry["value_selector"]
            for entry in value
            if isinstance(entry, dict) and isinstance(entry.get("value_selector"), list)
        ]
    elif isinstance(value, dict) and isinstance(value.get("value_selector"), list):
        selectors = [value["value_selector"]]
    details = []
    for selector in selectors[:4]:
        if selector and isinstance(selector[0], str):
            details.append(
                names.get(selector[0], _literal(selector[0], graph))
                + "."
                + _literal(".".join(str(part) for part in selector[1:]), graph)
            )
    if isinstance(value, dict) and not selectors:
        fields = [_literal(str(key), graph, 40) for key in list(value)[:4]]
        return ("；字段 " if chinese else "; fields ") + ", ".join(fields) if fields else ""
    return ("；绑定来源 " if chinese else "; bind from ") + ", ".join(details) if details else ""


def applied_repair_summary(result: ApplyResult, before_graph: Graph, reply_language: str) -> str:
    """Accept actual ApplyResult; return only recognized committed diff facts.

    Unknown diff text is withheld. Identity-only results cannot establish fields.
    Before graph supplies removed-node labels; result titles take precedence.
    """
    chinese = reply_language.lower().startswith("zh")
    display = _display(before_graph)
    names = _names(display, chinese)
    for node in result.nodes:
        if node.title.strip() and node.title.strip() != node.node_id:
            names[node.node_id] = _literal(node.title, display)
    groups: dict[str, list[str]] = {}
    for change in result.changes:
        field = re.fullmatch(r"([^\s:]+): ([A-Za-z_][A-Za-z_0-9-]*)", change)
        structural = re.fullmatch(r"([＋−]) ([^\s]+)(?: → ([^\s]+))?", change)
        if field:
            node_id, key = field.groups()
            groups.setdefault(node_id, []).append(
                ("已更新字段 " if chinese else "Updated field ") + _literal(key, display)
            )
        elif structural:
            sign, node_id, target = structural.groups()
            detail = (
                ("已创建节点" if chinese else "Created node")
                if sign == "＋"
                else ("已删除节点" if chinese else "Deleted node")
            )
            if target:
                detail = (
                    ("已连接到 " if chinese else "Connected to ")
                    if sign == "＋"
                    else ("已移除连接到 " if chinese else "Removed connection to ")
                ) + names.get(target, _literal(target, display))
            groups.setdefault(node_id, []).append(detail)
    lines = _groups(groups, names, display, chinese)
    if not lines:
        if not result.scope and (result.changed_nodes or result.nodes):
            for node_id in list(dict.fromkeys([*result.changed_nodes, *(node.node_id for node in result.nodes)]))[:8]:
                lines.append(
                    "- "
                    + names.get(node_id, _literal(node_id, display))
                    + (
                        "：已报告节点变更；未提供字段明细。"
                        if chinese
                        else ": Node change reported; field details unavailable."
                    )
                )
        else:
            lines = ["没有可确认的变更。" if chinese else "No changes could be confirmed."]
    return "\n".join([*lines, _retest(chinese)])
