"""Pure, deterministic repairs for LLM-written workflow graph dicts.

Shared by two callers that must agree:

- ``core.workflow.generator.runner.WorkflowGenerator._postprocess_graph`` -- the
  generator used by cmd+K ``/create`` / ``/refine`` and by the Dify Builder's
  first build;
- ``services.dify_builder.dify_port.WorkflowServiceDifyPort.apply_repair`` --
  the Builder's single write chokepoint, which also sees the Fix / Edit
  intents the generator never produced.

No I/O, no engine imports beyond the graph dict shape, no prompts: every
function takes the raw ``nodes`` / ``edges`` lists the canvas persists and
mutates them in place, returning what it changed so callers can log it.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, MutableMapping
from typing import Any

# ---------------------------------------------------------------------------
# Condition values (if-else/loop's Condition vs list-operator's FilterCondition)
# ---------------------------------------------------------------------------

# graphon ``Condition.value`` (if-else, loop) is ``str | Sequence[str] | bool | None``.
# graphon ``FilterCondition.value`` (list-operator) is ``str | Sequence[str] | bool``
# (no None; default ""). For list operators filtering arrays, graphon requires a plain
# string, not a list. The two need separate normalization rules.

# if-else/loop conditions: operators below compare against a LIST, so a scalar
# written for them must become a one-item list rather than a bare string.
_LIST_OPERATORS = frozenset({"in", "not in", "all of"})


def _scalar_to_text(value: int | float) -> str:
    """``60`` -> ``"60"``, ``60.0`` -> ``"60"``, ``60.5`` -> ``"60.5"``."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _normalize_list_item(item: Any) -> str:
    """Normalize a single item in a condition value list."""
    if isinstance(item, str):
        return item
    if isinstance(item, (int, float)):
        return _scalar_to_text(item)
    return str(item)


def normalize_condition_value(value: Any, operator: str) -> Any:
    """One condition ``value`` (if-else/loop Condition) as graphon will accept it.

    ESQ1-303: the node builder wrote ``"value": 60`` (a JSON number). pydantic
    rejects a number for ``str | Sequence[str] | bool | None`` -- except that it
    coerces ``1`` / ``0`` to ``True`` / ``False``, which is why ``bool`` is
    checked BEFORE ``int`` here (``True`` is an ``int`` in Python).
    """
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, list):
        return [_normalize_list_item(item) for item in value]
    if isinstance(value, (int, float)):
        text = _scalar_to_text(value)
        return [text] if operator in _LIST_OPERATORS else text
    if isinstance(value, str) and operator in _LIST_OPERATORS:
        return [value]
    return value


def normalize_filter_condition_value(value: Any) -> Any:
    """One filter condition ``value`` (list-operator FilterCondition) normalized.

    FilterCondition.value is str | Sequence[str] | bool (default ""), NOT None.
    Filtering an array of strings or numbers requires a plain string, not a list.
    Booleans are kept. Numbers become text. Lists get their items normalized.
    """
    if isinstance(value, bool):
        return value
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return _scalar_to_text(value)
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return [_normalize_list_item(item) for item in value]
    return value


def _normalize_conditions(
    conditions: Any,
    value_normalizer: Callable[[Any, str], Any] | Callable[[Any], Any] = normalize_condition_value,
) -> bool:
    """Normalize every ``value`` in a conditions list (recursing into
    ``sub_variable_condition``). Returns True when anything changed.

    The value_normalizer is called with (value, operator) for Condition-like
    normalizers, or just (value,) for FilterCondition normalizers. Callers
    must pass the right function for their context.
    """
    changed = False
    if not isinstance(conditions, list):
        return False
    for condition in conditions:
        if not isinstance(condition, MutableMapping):
            continue
        if "value" in condition:
            # Try the normalizer with both signatures (Condition vs FilterCondition)
            try:
                new_value = value_normalizer(condition["value"], str(condition.get("comparison_operator") or ""))  # type: ignore
            except TypeError:
                # If that fails, try with just the value (FilterCondition path)
                new_value = value_normalizer(condition["value"])  # type: ignore
            if new_value != condition["value"] or type(new_value) is not type(condition["value"]):
                condition["value"] = new_value
                changed = True
        sub = condition.get("sub_variable_condition")
        if isinstance(sub, MutableMapping) and _normalize_conditions(sub.get("conditions"), value_normalizer):
            changed = True
    return changed


def normalize_condition_values(nodes: list[Any]) -> list[str]:
    """Coerce every condition value in ``nodes`` to the shape graphon accepts.

    Covers if-else ``cases[].conditions[]`` (and the legacy top-level
    ``conditions``), loop ``break_conditions[]``, and list-operator
    ``filter_by.conditions[]``. if-else and loop use graphon's ``Condition``
    model; list-operator uses ``FilterCondition`` (different value shape).
    Returns the ids of the nodes that changed, in order.
    """
    changed: list[str] = []
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        data = node.get("data")
        if not isinstance(data, MutableMapping):
            continue
        node_type = data.get("type")
        touched = False
        if node_type == "if-else":
            cases = data.get("cases")
            if isinstance(cases, list):
                for case in cases:
                    if isinstance(case, Mapping) and _normalize_conditions(
                        case.get("conditions"), normalize_condition_value
                    ):
                        touched = True
            if _normalize_conditions(data.get("conditions"), normalize_condition_value):
                touched = True
        elif node_type == "loop":
            touched = _normalize_conditions(data.get("break_conditions"), normalize_condition_value)
        elif node_type == "list-operator":
            filter_by = data.get("filter_by")
            if isinstance(filter_by, Mapping):
                touched = _normalize_conditions(filter_by.get("conditions"), normalize_filter_condition_value)
        if touched:
            changed.append(str(node.get("id") or ""))
    return changed


# ---------------------------------------------------------------------------
# if-else ``varType`` (frontend-only operator hint)
# ---------------------------------------------------------------------------

# Start-variable ``type`` -> the canvas ``VarType`` it is certain to be. Anything
# not listed (``json``, ``json_object``, ``iterator``, ...) is left alone: the
# frontend copes with a missing ``varType`` (it defaults the operator list);
# a wrong one steers the user to operators that fail at run time (ESQ1-285).
_START_TYPE_TO_VAR_TYPE: Mapping[str, str] = {
    "number": "number",
    "text-input": "string",
    "paragraph": "string",
    "select": "string",
    "url": "string",
    "checkbox": "boolean",
    "file": "file",
    "file-list": "array[file]",
}


def _start_variable_types(nodes: list[Any]) -> dict[tuple[str, str], str]:
    """``(start_node_id, variable_name) -> VarType`` for every certain start variable."""
    out: dict[tuple[str, str], str] = {}
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        data = node.get("data")
        if not isinstance(data, Mapping) or data.get("type") != "start":
            continue
        for variable in data.get("variables") or []:
            if not isinstance(variable, Mapping):
                continue
            var_type = _START_TYPE_TO_VAR_TYPE.get(str(variable.get("type") or ""))
            name = str(variable.get("variable") or "")
            if var_type and name:
                out[(str(node.get("id") or ""), name)] = var_type
    return out


def derive_if_else_var_types(nodes: list[Any]) -> list[str]:
    """Fill ``varType`` on if-else conditions that lack it, ONLY when the
    condition reads a start variable whose declared type maps to a certain
    ``VarType``. Existing values are never overwritten. Returns the ids of the
    nodes that changed."""
    known = _start_variable_types(nodes)
    changed: list[str] = []
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        data = node.get("data")
        if not isinstance(data, Mapping) or data.get("type") != "if-else":
            continue
        touched = False
        for case in data.get("cases") or []:
            if not isinstance(case, Mapping):
                continue
            for condition in case.get("conditions") or []:
                if not isinstance(condition, MutableMapping) or condition.get("varType"):
                    continue
                selector = condition.get("variable_selector")
                if not isinstance(selector, list) or len(selector) != 2:
                    continue
                var_type = known.get((str(selector[0]), str(selector[1])))
                if var_type:
                    condition["varType"] = var_type
                    touched = True
        if touched:
            changed.append(str(node.get("id") or ""))
    return changed


# ---------------------------------------------------------------------------
# http-request bodies
# ---------------------------------------------------------------------------

# graphon's executor (``Executor._require_single_body_item``) sends these body
# types as ONE rendered item; ``form-data`` / ``x-www-form-urlencoded`` take any
# number of key/value items and ``none`` takes none.
_SINGLE_ITEM_BODY_TYPES = frozenset({"json", "raw-text", "binary"})


def normalize_http_request_bodies(nodes: list[Any]) -> list[str]:
    """Fill what graphon's ``BodyData`` model cannot default.

    ``BodyData.type`` is ``Literal["file", "text"]`` with NO default, and the
    shared builder prompt only ever shows ``"body": {"type": "none", "data": []}``,
    so the LLM writes ``{key, value}`` items (ESQ1-302) and the graph fails at
    ``Graph.init``. An item with a non-empty ``file`` selector is a file item;
    every other item is text. A ``none`` body carries no items. Returns the ids
    of the nodes that changed.
    """
    changed: list[str] = []
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        data = node.get("data")
        if not isinstance(data, Mapping) or data.get("type") != "http-request":
            continue
        body = data.get("body")
        if not isinstance(body, MutableMapping):
            continue
        items = body.get("data")
        touched = False
        if body.get("type") == "none" and items:
            body["data"] = []
            touched = True
        elif isinstance(items, list):
            for item in items:
                if not isinstance(item, MutableMapping) or item.get("type") in ("file", "text"):
                    continue
                item["type"] = "file" if item.get("file") else "text"
                touched = True
        if touched:
            changed.append(str(node.get("id") or ""))
    return changed


def http_request_body_errors(nodes: list[Any]) -> list[tuple[str, str]]:
    """``(node_id, detail)`` for every http-request whose body the executor
    would reject at run time: a json / raw-text / binary body with a number of
    items other than one.

    Deliberately NOT repaired. Two ``{key, value}`` items under a json body
    have no single correct collapse: quoting each value breaks a variable whose
    text is itself JSON (ESQ1-302's ``node3.text``), not quoting breaks plain
    text with quotes or newlines. Only the author can say which was meant, so
    the graph is rejected with the node named and regenerated instead.
    """
    errors: list[tuple[str, str]] = []
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        data = node.get("data")
        if not isinstance(data, Mapping) or data.get("type") != "http-request":
            continue
        body = data.get("body")
        if not isinstance(body, Mapping):
            continue
        body_type = str(body.get("type") or "")
        items = body.get("data")
        if body_type not in _SINGLE_ITEM_BODY_TYPES:
            continue
        if isinstance(items, str):
            count = 1 if items else 0
        else:
            count = len(items) if isinstance(items, list) else 0
        if count != 1:
            errors.append(
                (
                    str(node.get("id") or ""),
                    f"http-request {body_type} body must have exactly one item (one template "
                    f"holding the whole payload); node {node.get('id')!r} has {count} items",
                )
            )
    return errors
