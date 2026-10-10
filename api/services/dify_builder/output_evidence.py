"""Conservative selector facts from the executed native graph and persisted node rows."""

from core.dify_builder.models import Graph, NodeOutput, OutputFinding

_ORDINARY_PRODUCERS = {"start", "code", "llm", "tool"}
_SPECIAL_NAMESPACES = {"sys", "env", "conversation"}


def collect_output_findings(graph: Graph, per_node: list[NodeOutput]) -> list[OutputFinding]:
    """Only complete, single ordinary producer rows prove presence or absence.

    Nested/container/retry/assignment provenance is deliberately unverified.
    In particular a present null is not evidence of a missing reference.
    """
    nodes = {n.get("id"): n for n in graph.get("nodes", [])}
    rows: dict[str, list[NodeOutput]] = {}
    for row in per_node:
        rows.setdefault(row.node_id, []).append(row)
    findings = []
    for node_id, node in nodes.items():
        data = node.get("data", {})
        if data.get("type") != "end" or not any(r.status == "succeeded" for r in rows.get(node_id, [])):
            continue
        for output in data.get("outputs", []):
            selector = output.get("value_selector")
            state, reason = "unknown", "insufficient_provenance"
            if (
                not isinstance(selector, list)
                or len(selector) < 2
                or not all(isinstance(s, str) and s for s in selector)
            ):
                state, reason = "unresolved", "invalid_selector"
                selector = selector if isinstance(selector, list) and all(isinstance(s, str) for s in selector) else []
            elif selector[0] in _SPECIAL_NAMESPACES:
                reason = "special_namespace"
            elif selector[0] not in nodes:
                state, reason = "unresolved", "producer_absent"
            else:
                source = nodes[selector[0]]
                config = source.get("data", {})
                source_rows = rows.get(selector[0], [])
                ambiguous = (
                    source.get("parentId")
                    or source.get("parent_id")
                    or any(config.get(k) for k in ("isInIteration", "isInLoop", "iteration_id", "loop_id"))
                    or config.get("retry_config", {}).get("retry_enabled")
                    or config.get("error_strategy")
                )
                if (
                    len(selector) == 2
                    and config.get("type") in _ORDINARY_PRODUCERS
                    and not ambiguous
                    and len(source_rows) == 1
                ):
                    row = source_rows[0]
                    if row.status == "succeeded" and row.outputs_available:
                        state = "present" if selector[1] in row.outputs else "unresolved"
                        reason = "key_present" if state == "present" else "key_absent"
            findings.append(
                OutputFinding(
                    node_id=node_id,
                    output_name=str(output.get("variable", "")),
                    selector=selector,
                    state=state,
                    reason=reason,
                )
            )
    return findings
