"""Bounded native API envelope/body context for planned node builders.

Response schemas describe HTTP body data, not dynamically published Tool
variables. Only selected native APIs upstream of this target are rendered;
the full installed inventory and original user instruction remain unchanged.
"""

import json
from collections.abc import Sequence
from typing import TYPE_CHECKING

from core.workflow.generator.tool_catalogue import find_tool_entry, text_mentions_tool_identifier

if TYPE_CHECKING:
    from core.workflow.generator.tool_catalogue import ToolCatalogueEntry

_MAX_PLAN_CHARS = 1_000_000
_MAX_PLAN_NODES = 512
_MAX_PLAN_EDGES = 1024
_MAX_CONTEXT_TOOLS = 8
_MAX_CONTEXT_BYTES = 16_000

_GUIDANCE = (
    "Native API tools publish only text (scalar string), files (array), and json (array). "
    "For JSON OBJECT HTTP responses with application/json content type, json=[response_body]; "
    "select the json root then unwrap the object in Code. "
    "For JSON array/scalar HTTP responses, native ApiTool emits raw text only: "
    "select text and explicitly JSON-parse it. "
    "Never reference HTTP body properties as top-level Tool outputs, use dotted text fields, or index json/files "
    "inside a variable selector. Declared response schemas are unverified body declarations, not adapter validation "
    "or native output_schema. Validate the explicit body shape, item types and required fields in Code. "
    "Apply the user's requested record bound independently of request parameters: an API limit parameter is not "
    "proof of returned count. Valid shorter or empty collections retain their actual count; do not fabricate records. "
    "Fail explicitly on malformed declared roots/items/fields; do not fabricate missing "
    "values or return empty success. If the response declaration is absent, ambiguous, unsupported or oversized, "
    "no body shape is established: do not guess fields from a label or capability description."
)

_CODE_SYSTEM_RULES = (
    "# Native API Code generation rules\n\n"
    "Use the direct response declarations supplied as user-context data when consuming a native API response. "
    "If the user disables filtering, deduplication or sorting, do not silently drop or reorder records; "
    "this does not waive declared required-field or type validation. "
    "Validate consumed declared root/item fields and types on every record before applying the result bound. "
    "Fail clearly on missing or ill-typed required values, including null when the declaration forbids null. "
    "Do not use .get/defaults to turn a missing required value into successful null/default output. "
    "Enforce any explicit maximum in the original user request at the result end, independently of API inputs: "
    "a request count/limit parameter does not guarantee the returned count. "
    "Preserve that original maximum even when a partial plan/purpose merely says to map every record. "
    "Do not invent a maximum when the original request states none. "
    "Valid empty or shorter results retain their actual count; never pad or fabricate records. "
    "If no direct response declaration establishes a shape, do not invent fields or required/type constraints."
)


def format_api_tool_code_system_rules(*, node_type: str, api_context: str) -> str:
    """Return fixed generation rules only for a Code consumer of relevant APIs.

    The context is the existing bounded renderer's result, used only as a gate.
    Its workspace schema/labels/descriptions stay user-message data and never
    become system instructions. These rules guide generation, not validation
    or execution of the model's generated Code.
    """
    return _CODE_SYSTEM_RULES if node_type == "code" and api_context else ""


def _body_transport(contracts: dict[str, object]) -> str:
    schemas = contracts.get("schemas")
    if contracts.get("state") != "declared" or not isinstance(schemas, list) or len(schemas) != 1:
        return "unverified"
    response = schemas[0]
    schema = response.get("schema") if isinstance(response, dict) else None
    kind = schema.get("type") if isinstance(schema, dict) else None
    if kind == "object":
        return "json"
    if kind in ("array", "string", "number", "integer", "boolean", "null"):
        return "text"
    return "unverified"


def format_api_tool_output_context(
    *, plan_json: str, target_node_id: str, entries: Sequence["ToolCatalogueEntry"]
) -> str:
    """Render exact native/API identities and bounded direct body declarations."""
    if len(plan_json) > _MAX_PLAN_CHARS:
        return ""
    try:
        plan = json.loads(plan_json)
    except (TypeError, ValueError):
        return ""
    if not isinstance(plan, dict):
        return ""
    nodes = plan.get("nodes")
    edges = plan.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return ""
    if len(nodes) > _MAX_PLAN_NODES or len(edges) > _MAX_PLAN_EDGES:
        return ""
    target_id = target_node_id.strip()
    parents: dict[str, set[str]] = {}
    for edge in edges:
        if isinstance(edge, dict) and isinstance(edge.get("source"), str) and isinstance(edge.get("target"), str):
            parents.setdefault(edge["target"].strip(), set()).add(edge["source"].strip())
    relevant = {target_id}
    pending = [target_id]
    while pending:
        for parent in parents.get(pending.pop(), set()):
            if parent not in relevant:
                relevant.add(parent)
                pending.append(parent)
    api_entries = [entry for entry in entries if entry["provider_type"] == "api"]
    selected: list[tuple[str, ToolCatalogueEntry]] = []
    for node in nodes:
        if not isinstance(node, dict) or node.get("node_type") != "tool":
            continue
        node_id = node.get("id")
        if not isinstance(node_id, str) or node_id.strip() not in relevant:
            continue
        selector = node.get("tool")
        entry = None
        if isinstance(selector, dict):
            entry = find_tool_entry(
                api_entries,
                str(selector.get("provider_id") or selector.get("provider_name") or ""),
                str(selector.get("tool_name") or ""),
            )
        if entry is None:
            purpose = str(node.get("purpose") or "")
            entry = next(
                (
                    candidate
                    for candidate in api_entries
                    if text_mentions_tool_identifier(purpose, candidate["provider_name"], candidate["tool_name"])
                ),
                None,
            )
        if entry is not None:
            selected.append((node_id.strip(), entry))
    if not selected:
        return ""
    tools: list[dict[str, object]] = []
    for node_id, entry in selected[:_MAX_CONTEXT_TOOLS]:
        contracts = entry.get("response_contracts") or {"state": "absent", "schemas": []}
        item: dict[str, object] = {
            "node_id": node_id,
            "provider_id": entry["provider_name"],
            "tool_name": entry["tool_name"],
            "tool_label": entry["tool_label"],
            "output_roots": {"text": "string", "files": "array[file]", "json": "array[object]"},
            "response_contracts": contracts,
            "response_body_transport": _body_transport(contracts),
        }
        candidate = {"tools": [*tools, item], "omitted_upstream_api_nodes": len(selected) - len(tools) - 1}
        encoded = json.dumps(candidate, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode()) + len(_GUIDANCE.encode()) + 100 > _MAX_CONTEXT_BYTES:
            item["response_contracts"] = {"state": "oversized", "schemas": []}
            item["response_body_transport"] = "unverified"
            candidate["tools"] = [*tools, item]
            if (
                len(json.dumps(candidate, ensure_ascii=False).encode()) + len(_GUIDANCE.encode()) + 100
                > _MAX_CONTEXT_BYTES
            ):
                continue
        tools.append(item)
    payload = {"tools": tools, "omitted_upstream_api_nodes": len(selected) - len(tools)}
    return (
        "# Native API output contracts\n\n"
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + "\n\n"
        + _GUIDANCE
        + "\n\n"
    )
