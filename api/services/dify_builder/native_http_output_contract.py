"""Pure native HTTP v1 facts for Builder references, hints, prompts and refusal.

Missing version means the native default ``1``; explicit unknown versions and
ambiguous producer identities establish no type. Generic HTTP root declarations
and the historic ``response`` alias retain their existing compatibility scope.
No registry, model, configuration, request data or runtime lookup is needed.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import NamedTuple

_OUTPUT_TYPES = (("body", "string"), ("status_code", "number"), ("headers", "object"), ("files", "array[file]"))
_OUTPUT_ROOTS = frozenset(name for name, _ in _OUTPUT_TYPES)
# Graphon 0.7.0 _assert_is/_assert_is_not reject actual numbers. Enum category
# comments are not operand restrictions: null/empty/existence unary predicates
# accept numbers. Other operators remain native validation's responsibility.
_INCOMPATIBLE_NUMERIC_OPERATORS = frozenset({"is", "is not"})
_MAX_NODES = 512
_MAX_EDGES = 1024
_MAX_PLAN_CHARS = 1_000_000
_MAX_CONTEXT_BYTES = 16_000
_HEADING = "# Native HTTP output contracts\n\n"
_SYSTEM_RULES = (
    "# Native HTTP v1 generation rules\n\n"
    "Native http-request v1 publishes body:string, status_code:number, headers:object, files:array[file]. "
    "Planner output declarations cannot rename or expand these fixed outputs. "
    "Exact response and http_response_body aliases mean body; consume the real body root. "
    "Use the exact producer IDs in the user contract bindings; do not infer types from labels or varType hints. "
    "Direct status_code equality uses numeric = or ≠, never string/boolean is or is not. "
    "Native numeric >, <, ≥, ≤ and unary null, not null, empty, not empty, exists, not exists remain supported. "
    "Unary predicates require no expected literal; do not confuse a registered null value with a missing selector. "
    'Numeric literal values retain wire text: variable_selector=[<bound producer ID>,"status_code"], '
    'comparison_operator="=", value="200". A text literal does not make the actual status a string. '
    "Preserve the original user goal, including exact equality and requested status handling. "
    "Native HTTP reports non-2xx failure when retry or an error strategy is enabled. "
    "For a NEW HTTP node, if the original goal treats every response status as data and did not request "
    "retry/error behavior, explicitly choose retry_enabled=false and no error strategy. "
    "Preserve retained/authored retry and error strategy unless the original instruction requests a change; "
    "do not silently disable them or invent timeout/fail-branch behavior. "
    "Unavailable bindings establish no producer contract; do not guess from planner claims."
)


def is_native_http_v1(data: Mapping[str, object]) -> bool:
    """Qualify exact native type and string v1, with only absence defaulting."""
    return data.get("type") == "http-request" and data.get("version", "1") == "1"


def declares_http_output(variable: str) -> bool:
    """Preserve generic HTTP root declaration behavior, including dotted roots."""
    return variable.split(".", 1)[0] in _OUTPUT_ROOTS


def aliased_http_output(data: Mapping[str, object], variable: str, *, producer_is_unique: bool = True) -> str | None:
    """Repair exact aliases; individual-node callers supply an unambiguous node.

    Graph callers must qualify identity from the original list. The historic
    response alias keeps its prior compatibility even when identity is unknown.
    """
    if data.get("type") != "http-request":
        return None
    if variable == "response" or (variable == "http_response_body" and producer_is_unique and is_native_http_v1(data)):
        return "body"
    return None


def _unique_nodes(nodes: Sequence[object]) -> dict[str, Mapping[str, object]]:
    counts: dict[str, int] = {}
    by_id: dict[str, Mapping[str, object]] = {}
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        node_id = node.get("id")
        if isinstance(node_id, str) and node_id:
            counts[node_id] = counts.get(node_id, 0) + 1
            by_id[node_id] = node
    return {node_id: node for node_id, node in by_id.items() if counts[node_id] == 1}


def native_http_variable_types(nodes: Sequence[object]) -> tuple[tuple[tuple[str, str], str], ...]:
    """Immutable direct-root hints, qualified before any last-wins mapping."""
    return tuple(
        ((node_id, name), var_type)
        for node_id, node in _unique_nodes(nodes).items()
        if isinstance(data := node.get("data"), Mapping) and is_native_http_v1(data)
        for name, var_type in _OUTPUT_TYPES
    )


class HttpConditionProblem(NamedTuple):
    """A stable semantic location plus a bounded, value-free explanation."""

    node_id: str
    location: tuple[str, ...]
    detail: str


def native_http_condition_problems(nodes: Sequence[object]) -> tuple[HttpConditionProblem, ...]:
    """Refuse only direct qualified numeric status comparisons; never mutate."""
    numeric_ids = frozenset(
        node_id for (node_id, root), _ in native_http_variable_types(nodes) if root == "status_code"
    )
    problems: list[HttpConditionProblem] = []
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        data, node_id = node.get("data"), node.get("id")
        if not isinstance(data, Mapping) or data.get("type") != "if-else" or not isinstance(node_id, str):
            continue
        cases = data.get("cases")
        # IfElseNodeData.iter_cases uses legacy conditions only for absent/None
        # cases. An explicit [] is an active empty case list, not a fallback.
        groups: list[tuple[tuple[str, ...], object]] = [((), data.get("conditions"))] if cases is None else []
        if isinstance(cases, list):
            groups.extend(
                (("cases", str(i)), case.get("conditions")) for i, case in enumerate(cases) if isinstance(case, Mapping)
            )
        for prefix, conditions in groups:
            if not isinstance(conditions, list):
                continue
            for i, condition in enumerate(conditions):
                if not isinstance(condition, Mapping):
                    continue
                selector, operator = condition.get("variable_selector"), condition.get("comparison_operator")
                if (
                    not isinstance(selector, list)
                    or len(selector) != 2
                    or not all(isinstance(part, str) for part in selector)
                    or selector[0] not in numeric_ids
                    or selector[1] != "status_code"
                    or not isinstance(operator, str)
                    or operator not in _INCOMPATIBLE_NUMERIC_OPERATORS
                ):
                    continue
                location = (*prefix, "conditions", str(i), "comparison_operator")
                producer = json.dumps(selector[0][:160], ensure_ascii=True)
                detail = (
                    f"{'.'.join(location)}: native HTTP producer {producer} status_code is number; "
                    f"operator {operator!r} is incompatible. Numeric equality uses = or ≠; "
                    "numeric literals use wire text. Native null/empty/existence unary predicates remain supported."
                )
                problems.append(HttpConditionProblem(node_id, location, detail))
    return tuple(problems)


@dataclass(frozen=True)
class HttpPlanContext:
    """Snapshot native identity from original lists before caller maps collapse it."""

    producer_ids: tuple[str, ...]
    node_ids: frozenset[str]
    edges: tuple[tuple[str, str], ...]
    unavailable: bool = False


def snapshot_http_plan_context(
    plan_nodes: Sequence[object], plan_edges: Sequence[object], current_nodes: Sequence[object]
) -> HttpPlanContext:
    """Bind fresh v1 HTTP and retained actual identities within plan bounds."""
    unavailable = HttpPlanContext((), frozenset(), (), True)
    if len(plan_nodes) > _MAX_NODES or len(current_nodes) > _MAX_NODES or len(plan_edges) > _MAX_EDGES:
        return unavailable
    try:
        if len(json.dumps([plan_nodes, plan_edges], ensure_ascii=False)) > _MAX_PLAN_CHARS:
            return unavailable
    except (TypeError, ValueError):
        return unavailable
    unique_plan, unique_current = _unique_nodes(plan_nodes), _unique_nodes(current_nodes)
    if len(unique_plan) != len(plan_nodes) or len(unique_current) != len(current_nodes):
        return unavailable
    producers: list[str] = []
    for node_id, node in unique_plan.items():
        if node.get("action") == "keep" and node_id in unique_current:
            data = unique_current[node_id].get("data")
        else:
            data = {"type": node.get("node_type")}
        if isinstance(data, Mapping) and is_native_http_v1(data):
            producers.append(node_id)
    edges = tuple(
        (edge["source"], edge["target"])
        for edge in plan_edges
        if isinstance(edge, Mapping)
        and isinstance(edge.get("source"), str)
        and isinstance(edge.get("target"), str)
        and edge["source"] in unique_plan
        and edge["target"] in unique_plan
    )
    return HttpPlanContext(tuple(producers), frozenset(unique_plan), edges)


def format_http_output_context(context: HttpPlanContext | None, target_node_id: str) -> tuple[str, str]:
    """Fixed SYSTEM rules and escaped USER bindings; no authored data crosses."""
    if context is None:
        return "", ""
    unavailable = _HEADING + '{"state":"unavailable","producer_ids":[]}\n\n'
    if context.unavailable or target_node_id not in context.node_ids:
        return _SYSTEM_RULES, unavailable
    parents: dict[str, set[str]] = {}
    for source, target in context.edges:
        parents.setdefault(target, set()).add(source)
    relevant, pending = {target_node_id}, [target_node_id]
    while pending:
        for parent in parents.get(pending.pop(), ()):
            if parent not in relevant:
                relevant.add(parent)
                pending.append(parent)
    producers = [node_id for node_id in context.producer_ids if node_id in relevant]
    if not producers:
        return "", ""
    payload = {"state": "known", "contract": "native-http-request-v1", "producer_ids": producers}
    user_context = _HEADING + json.dumps(payload, ensure_ascii=True, separators=(",", ":")) + "\n\n"
    if len(user_context.encode()) + len(_SYSTEM_RULES.encode()) > _MAX_CONTEXT_BYTES:
        return _SYSTEM_RULES, unavailable
    return _SYSTEM_RULES, user_context
