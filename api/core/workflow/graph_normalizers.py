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


# ---------------------------------------------------------------------------
# Branch edge handles (if-else / question-classifier / human-input / fail-branch)
# ---------------------------------------------------------------------------

# Names the planner uses for the arms of a two-arm if-else before the node
# builder has chosen a case id. Trusted as NAMES: an ELSE alias always means
# the implicit ``false`` arm, an IF alias the single declared case.
_ELSE_ALIASES = frozenset(
    {"else", "otherwise", "default", "no", "not", "elsebranch", "else_branch", "false_branch", "falsebranch"}
)
_IF_ALIASES = frozenset(
    {"if", "then", "yes", "true_branch", "truebranch", "if_branch", "ifbranch", "case", "case1", "case_1"}
)
_DEFAULT_HANDLES = frozenset({"", "source"})
# A handle shorter than this never claims a declared id by prefix ("no" must
# not swallow "nothing").
_MIN_STEM = 3

# Node types that route on named handles the node itself declares (if-else's
# case ids + the implicit "false" arm, question-classifier's class ids,
# human-input's action ids + the implicit "__timeout" arm) rather than the
# single default "source" handle every other node type uses.
_NAMED_BRANCH_TYPES = frozenset({"if-else", "question-classifier", "human-input"})

# human-input's implicit timeout arm. This is
# ``core.workflow.nodes.human_input.constants.TIMEOUT_HANDLE`` ("__timeout"),
# not imported: that package's __init__ pulls in graphon/pydantic entities,
# which this module's own contract (see the module docstring) keeps out --
# "no engine imports beyond the graph dict shape".
_HUMAN_INPUT_TIMEOUT_HANDLE = "__timeout"

# Declared handles that exist on every node of their type regardless of what
# the author configured (unlike a case id, a class id or an action id, which
# only exist because the author added them). An author routinely leaves them
# unwired, so they must not count as "the one remaining slot" when repair is
# deciding whether an unnamed/misnamed edge unambiguously belongs to the last
# free arm -- otherwise that arm would never resolve. An edge already ON one
# of them still matches it exactly (the pass above, not this set).
_UNCOUNTED_UNUSED_HANDLES = frozenset({_HUMAN_INPUT_TIMEOUT_HANDLE})


def _canon(handle: Any) -> str:
    return "".join(ch for ch in str(handle or "").lower() if ch.isalnum() or ch == "_")


def declared_branch_handles(node: Mapping[str, Any]) -> list[str]:
    """The source handles ``node`` exposes, in declaration order; ``[]`` for a
    node that has a single ``source`` handle.

    A node with ``error_strategy: "fail-branch"`` gains a ``"fail-branch"``
    arm. Its success path stays on whatever handle the node already routes
    on: graphon's ``NodeRunResult.edge_source_handle`` defaults to
    ``"source"``, so a plain node (http-request, code, ...) declares
    ``["source", "fail-branch"]`` -- not an invented ``"success"`` handle
    nothing ever emits, which would strand its real ``"source"`` edge as
    undeclared and skip it at run time. A branch-type node (if-else,
    question-classifier, human-input) keeps routing on its own handles and
    simply gains the extra ``"fail-branch"`` arm.
    """
    data = node.get("data")
    if not isinstance(data, Mapping):
        return []
    node_type = data.get("type")
    handles: list[str] = []
    if node_type == "if-else":
        handles = [str(c["case_id"]) for c in data.get("cases") or [] if isinstance(c, Mapping) and c.get("case_id")]
        handles.append("false")  # the implicit ELSE arm
    elif node_type == "question-classifier":
        handles = [str(k["id"]) for k in data.get("classes") or [] if isinstance(k, Mapping) and k.get("id")]
    elif node_type == "human-input":
        handles = [str(a["id"]) for a in data.get("user_actions") or [] if isinstance(a, Mapping) and a.get("id")]
        handles.append(_HUMAN_INPUT_TIMEOUT_HANDLE)  # the implicit timeout arm
    if data.get("error_strategy") == "fail-branch":
        if node_type in _NAMED_BRANCH_TYPES:
            handles.append("fail-branch")
        else:
            handles = ["source", "fail-branch"]
    return handles


def _name_aliases(node: Mapping[str, Any], handles: list[str]) -> dict[str, str]:
    """canonical name -> declared handle, for the names a planner might use."""
    data = node.get("data") or {}
    names: dict[str, str] = {}
    if data.get("type") == "if-else":
        for alias in _ELSE_ALIASES:
            names[alias] = "false"
        if len(handles) == 2:  # one case + ELSE: an IF alias is unambiguous
            for alias in _IF_ALIASES:
                names[alias] = handles[0]
    elif data.get("type") == "question-classifier":
        for klass in data.get("classes") or []:
            if isinstance(klass, Mapping) and klass.get("id") and klass.get("name"):
                names[_canon(klass["name"])] = str(klass["id"])
    elif data.get("type") == "human-input":
        for action in data.get("user_actions") or []:
            if isinstance(action, Mapping) and action.get("id"):
                for key in ("title", "label", "name"):
                    if action.get(key):
                        names[_canon(action[key])] = str(action["id"])
    return names


def _match_handle(handle: str, handles: list[str], names: Mapping[str, str]) -> str | None:
    """A declared handle that ``handle`` unambiguously means, else ``None``."""
    canon = _canon(handle)
    for declared in handles:
        if _canon(declared) == canon:
            return declared
    if canon in names:
        return names[canon]
    if len(canon) >= _MIN_STEM:
        stems = [
            declared
            for declared in handles
            if len(_canon(declared)) >= _MIN_STEM
            and (canon.startswith(_canon(declared)) or _canon(declared).startswith(canon))
        ]
        if len(stems) == 1:
            return stems[0]
    return None


def repair_branch_edge_handles(nodes: list[Any], edges: list[Any]) -> list[dict[str, Any]]:
    """Re-home edges leaving a branch node onto the handles the node declares.

    Three passes per branch node, each only when it is forced:

    1. exact / alias / name / stem match (``else`` -> ``false``, a class name
       -> its id, ``approved`` -> ``approve``);
    2. edges still unmatched, all carrying the SAME unknown handle, when
       exactly one declared handle is unused -> that handle (one arm fanning
       out under an invented name);
    3. edges on the default ``source`` handle, when there are at least as
       many unused declared handles -> unused handles in declaration order
       (the pre-existing behaviour).

    "Unused" for (2) and (3) never counts a handle in
    ``_UNCOUNTED_UNUSED_HANDLES`` (human-input's implicit ``"__timeout"``
    arm): it exists on every node of its type whether or not the author
    wired it, so it must not silently absorb an edge meant for the one real
    arm that IS left unused, and must not block that arm's resolution either.

    Anything else -- two different unknown names, one unknown edge with two
    free arms, a three-case node with invented names -- is left exactly as it
    was and returned, so ``undeclared_branch_handles`` fails the graph closed.
    A wrong guess would silently swap the IF and ELSE arms; a visible rejection
    is better.
    """
    unresolved: list[dict[str, Any]] = []
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        handles = declared_branch_handles(node)
        if not handles:
            continue
        node_id = str(node.get("id") or "")
        outgoing = [e for e in edges if isinstance(e, MutableMapping) and e.get("source") == node_id]
        if not outgoing:
            continue
        names = _name_aliases(node, handles)
        unknown: list[MutableMapping[str, Any]] = []
        for edge in outgoing:
            handle = edge.get("sourceHandle")
            if handle in handles:
                continue
            if handle is None or handle in _DEFAULT_HANDLES:
                unknown.append(edge)
                continue
            matched = _match_handle(str(handle), handles, names)
            if matched is None:
                unknown.append(edge)
            else:
                edge["sourceHandle"] = matched
        if not unknown:
            continue
        taken = {e.get("sourceHandle") for e in outgoing if e.get("sourceHandle") in handles}
        unused = [h for h in handles if h not in taken and h not in _UNCOUNTED_UNUSED_HANDLES]
        named = [
            e
            for e in unknown
            if e.get("sourceHandle") not in (None, "") and e.get("sourceHandle") not in _DEFAULT_HANDLES
        ]
        defaulted = [e for e in unknown if e not in named]
        distinct_names = {str(e.get("sourceHandle")) for e in named}
        if named and not defaulted and len(distinct_names) == 1 and len(unused) == 1:
            for edge in named:
                edge["sourceHandle"] = unused[0]
            continue
        if defaulted and not named and len(defaulted) <= len(unused):
            for edge, handle in zip(defaulted, unused):
                edge["sourceHandle"] = handle
            continue
        for edge in unknown:
            unresolved.append(
                {
                    "node_id": node_id,
                    "target": str(edge.get("target") or ""),
                    "handle": edge.get("sourceHandle"),
                    "declared": list(handles),
                }
            )
    return unresolved


def undeclared_branch_handles(nodes: list[Any], edges: list[Any]) -> list[dict[str, Any]]:
    """Every edge leaving a branch node on a handle the node does not declare
    (including the default ``source``): the edge would hang off a handle that
    does not exist and its arm would silently never run."""
    bad: list[dict[str, Any]] = []
    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        handles = declared_branch_handles(node)
        if not handles:
            continue
        node_id = str(node.get("id") or "")
        for edge in edges:
            if not isinstance(edge, Mapping) or edge.get("source") != node_id:
                continue
            handle = edge.get("sourceHandle")
            if handle in handles:
                continue
            bad.append(
                {
                    "node_id": node_id,
                    "target": str(edge.get("target") or ""),
                    "handle": "source" if handle is None else handle,
                    "declared": list(handles),
                }
            )
    return bad
