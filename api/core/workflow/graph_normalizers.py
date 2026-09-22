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

from collections.abc import Mapping, MutableMapping
from typing import Any

# ---------------------------------------------------------------------------
# Condition values (if-else, loop break conditions, list-operator filters)
# ---------------------------------------------------------------------------

# graphon ``Condition.value`` is ``str | Sequence[str] | bool | None``. The
# operators below compare against a LIST, so a scalar written for them must
# become a one-item list rather than a bare string.
_LIST_OPERATORS = frozenset({"in", "not in", "all of"})


def _scalar_to_text(value: int | float) -> str:
    """``60`` -> ``"60"``, ``60.0`` -> ``"60"``, ``60.5`` -> ``"60.5"``."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def normalize_condition_value(value: Any, operator: str) -> Any:
    """One condition ``value`` as graphon will accept it.

    ESQ1-303: the node builder wrote ``"value": 60`` (a JSON number). pydantic
    rejects a number for ``str | Sequence[str] | bool | None`` -- except that it
    coerces ``1`` / ``0`` to ``True`` / ``False``, which is why ``bool`` is
    checked BEFORE ``int`` here (``True`` is an ``int`` in Python).
    """
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, list):
        return [item if isinstance(item, str) else str(item) for item in value]
    if isinstance(value, (int, float)):
        text = _scalar_to_text(value)
        return [text] if operator in _LIST_OPERATORS else text
    if isinstance(value, str) and operator in _LIST_OPERATORS:
        return [value]
    return value


def _normalize_conditions(conditions: Any) -> bool:
    """Normalize every ``value`` in a conditions list (recursing into
    ``sub_variable_condition``). Returns True when anything changed."""
    changed = False
    if not isinstance(conditions, list):
        return False
    for condition in conditions:
        if not isinstance(condition, MutableMapping):
            continue
        if "value" in condition:
            new_value = normalize_condition_value(condition["value"], str(condition.get("comparison_operator") or ""))
            if new_value != condition["value"] or type(new_value) is not type(condition["value"]):
                condition["value"] = new_value
                changed = True
        sub = condition.get("sub_variable_condition")
        if isinstance(sub, MutableMapping) and _normalize_conditions(sub.get("conditions")):
            changed = True
    return changed


def normalize_condition_values(nodes: list[Any]) -> list[str]:
    """Coerce every condition value in ``nodes`` to the shape graphon accepts.

    Covers if-else ``cases[].conditions[]`` (and the legacy top-level
    ``conditions``), loop ``break_conditions[]`` and list-operator
    ``filter_by.conditions[]`` -- all three use graphon's ``Condition`` model.
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
                    if isinstance(case, Mapping) and _normalize_conditions(case.get("conditions")):
                        touched = True
            if _normalize_conditions(data.get("conditions")):
                touched = True
        elif node_type == "loop":
            touched = _normalize_conditions(data.get("break_conditions"))
        elif node_type == "list-operator":
            filter_by = data.get("filter_by")
            if isinstance(filter_by, Mapping):
                touched = _normalize_conditions(filter_by.get("conditions"))
        if touched:
            changed.append(str(node.get("id") or ""))
    return changed
