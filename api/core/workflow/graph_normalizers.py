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


def normalize_filter_condition_value(value: Any, operator: str = "") -> Any:
    """One filter condition ``value`` (list-operator FilterCondition) normalized.

    FilterCondition.value is str | Sequence[str] | bool (default ""), NOT None.
    Filtering an array of strings or numbers requires a plain string, not a list.
    Booleans are kept. Numbers become text. Lists get their items normalized.

    ``operator`` is accepted and ignored: it gives this the same
    ``(value, operator)`` shape as ``normalize_condition_value`` so the
    conditions walker calls both one way. Unlike a Condition, a scalar under
    a list operator (``in`` / ``not in`` / ``all of``) is never wrapped in a
    list here.
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
    value_normalizer: Callable[[Any, str], Any] = normalize_condition_value,
) -> bool:
    """Normalize every ``value`` in a conditions list (recursing into
    ``sub_variable_condition``). Returns True when anything changed.

    ``value_normalizer`` is called as ``(value, comparison_operator)``:
    ``normalize_condition_value`` for if-else / loop Conditions,
    ``normalize_filter_condition_value`` (which ignores the operator) for
    list-operator FilterConditions. Callers must pass the right one.
    """
    changed = False
    if not isinstance(conditions, list):
        return False
    for condition in conditions:
        if not isinstance(condition, MutableMapping):
            continue
        if "value" in condition:
            new_value = value_normalizer(condition["value"], str(condition.get("comparison_operator") or ""))
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
# Names a planner might use for that implicit timeout arm.
_HUMAN_INPUT_TIMEOUT_ALIASES = frozenset(
    {"timeout", "time_out", "timed_out", "timedout", "on_timeout", "expired", "expire", "expiry"}
)

# A fail-branch node's SUCCESS arm keeps routing on "source" (graphon's real
# default), never an invented "success" handle; these are the words a
# planner might use for it. Only added on a non-branch-type node -- a
# branch-type node (if-else / question-classifier / human-input) does not
# declare "source" at all, so mapping onto it would invent a handle nothing
# routes on.
_FAIL_BRANCH_SUCCESS_ALIASES = frozenset({"success", "ok", "next", "on_success"})
# ...and the words a planner might use for the failure arm. Valid on any
# fail-branch node regardless of type. Looked up by ``_canon_name`` like
# every other name, so ``fail_branch`` / ``fail-branch`` / ``Fail Branch``
# all hit the same key.
_FAIL_BRANCH_FAILURE_ALIASES = frozenset(
    {
        "fail",
        "failure",
        "failed",
        "error",
        "on_error",
        "on_failure",
        "exception",
        "fail_branch",
        "failbranch",
        "error_branch",
        "on_fail",
        "fallback",
    }
)

# Declared handles that exist because of the node's configuration, not
# because the author wired a branch: human-input's implicit "__timeout" arm
# exists on every human-input node regardless of what the author set up, and
# a fail-branch node's "fail-branch" arm exists because the author chose
# that error strategy, not because they connected anything to it. Both are
# routinely left unwired, so they must never count as "the one remaining
# slot" the fan-out (rule 2) / default-order (rule 3) heuristics assign to --
# otherwise they would (a) block resolution of the arm the author DID
# configure, or (b) silently steal an edge that belongs there instead. An
# edge already ON one of them still matches it exactly (the pass above, not
# this set); a named edge reaches either one through an explicit alias
# (_HUMAN_INPUT_TIMEOUT_ALIASES, _FAIL_BRANCH_*_ALIASES) instead.
_UNCOUNTED_UNUSED_HANDLES = frozenset({_HUMAN_INPUT_TIMEOUT_HANDLE, "fail-branch"})


def _canon(handle: Any) -> str:
    """Case-folds a HANDLE identifier for exact/stem comparison: alnum and
    underscore are kept (both are meaningful in a handle id like
    ``"__timeout"`` or ``"true_branch"``), everything else -- hyphens,
    spaces -- is dropped."""
    return "".join(ch for ch in str(handle or "").lower() if ch.isalnum() or ch == "_")


def _canon_name(text: Any) -> str:
    """Case-folds a human-typed NAME (a class name, an action title, or an
    alias word) for name-based lookups: unlike ``_canon``, an underscore is
    folded away too, so ``"Tech Support"``, ``"tech_support"`` and
    ``"tech-support"`` all collapse to the same key. Exact/stem matching
    against a real declared handle id stays on ``_canon`` -- ``"__timeout"``
    must never collide with a literal edge handle ``"timeout"``."""
    return "".join(ch for ch in str(text or "").lower() if ch.isalnum())


def _effective_handle(handle: Any) -> Any:
    """The handle graphon actually routes an edge on: a missing (or
    explicitly ``None``) ``sourceHandle`` defaults to ``"source"``
    (``edge_config.get("sourceHandle", "source")``, graphon
    ``graph/graph.py:131``). A graph that already relies on that default --
    a fail-branch node's unkeyed success edges -- must come out identical,
    not get re-homed or reported as if ``"source"`` were undeclared."""
    return "source" if handle is None else handle


def _if_else_case_ids(data: Mapping[str, Any]) -> list[str]:
    """The case ids an if-else routes on, mirroring graphon's
    ``IfElseNodeData.iter_cases``: a node whose ``cases`` is absent or
    ``None`` is the legacy shape (top-level ``conditions``), which the engine
    runs as ONE case with id ``"true"`` (and the canvas migrates to
    ``case_id: "true"``). An explicitly empty ``cases: []`` is not legacy --
    it has no case at all and always takes the ELSE arm."""
    cases = data.get("cases")
    if cases is None:
        return ["true"]
    return [str(c["case_id"]) for c in cases or [] if isinstance(c, Mapping) and c.get("case_id")]


def declared_branch_handles(node: Mapping[str, Any]) -> list[str]:
    """The source handles ``node`` exposes, in declaration order; ``[]`` for a
    node that has a single ``source`` handle.

    An if-else declares its case ids (``"true"`` for the legacy shape with no
    ``cases`` -- see ``_if_else_case_ids``) plus the implicit ``"false"`` arm.
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
        handles = [*_if_else_case_ids(data), "false"]  # + the implicit ELSE arm
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


def _is_plain_fail_branch(node: Mapping[str, Any]) -> bool:
    """True for a non-branch-type node with ``error_strategy: "fail-branch"``:
    it declares only ``["source", "fail-branch"]``, two handles with
    opposite meanings. Eliminating between them by "the one arm left unused"
    is too risky when a name is unrecognized -- only an explicit alias (or
    the exact handle) may route onto either one."""
    data = node.get("data")
    if not isinstance(data, Mapping):
        return False
    return data.get("type") not in _NAMED_BRANCH_TYPES and data.get("error_strategy") == "fail-branch"


def _name_aliases(node: Mapping[str, Any], handles: list[str]) -> dict[str, str]:
    """canonical name -> declared handle, for the names a planner might use.

    A canonical name that would resolve to more than one handle (e.g. two
    question-classifier classes named "Support" and "support") is dropped
    instead of picking one: an ambiguous alias must fail closed, not
    silently pick a winner.
    """
    data = node.get("data") or {}
    node_type = data.get("type")
    candidates: dict[str, set[str]] = {}

    def add(name: Any, target: str) -> None:
        candidates.setdefault(_canon_name(name), set()).add(target)

    if node_type == "if-else":
        for alias in _ELSE_ALIASES:
            add(alias, "false")
        # one case (the legacy shape counts as one) + the implicit ELSE: an IF alias is unambiguous
        if len(_if_else_case_ids(data)) == 1:
            for alias in _IF_ALIASES:
                add(alias, handles[0])
    elif node_type == "question-classifier":
        for klass in data.get("classes") or []:
            if isinstance(klass, Mapping) and klass.get("id") and klass.get("name"):
                add(klass["name"], str(klass["id"]))
    elif node_type == "human-input":
        for action in data.get("user_actions") or []:
            if isinstance(action, Mapping) and action.get("id"):
                for key in ("title", "label", "name"):
                    if action.get(key):
                        add(action[key], str(action["id"]))
        for alias in _HUMAN_INPUT_TIMEOUT_ALIASES:
            add(alias, _HUMAN_INPUT_TIMEOUT_HANDLE)

    if data.get("error_strategy") == "fail-branch":
        if node_type not in _NAMED_BRANCH_TYPES:  # only a plain node declares "source"
            for alias in _FAIL_BRANCH_SUCCESS_ALIASES:
                add(alias, "source")
        for alias in _FAIL_BRANCH_FAILURE_ALIASES:
            add(alias, "fail-branch")

    return {name: next(iter(ids)) for name, ids in candidates.items() if len(ids) == 1}


def _match_handle(handle: str, handles: list[str], names: Mapping[str, str]) -> str | None:
    """A declared handle that ``handle`` unambiguously means, else ``None``.

    An alias/name match and a stem match are cross-checked: if they disagree
    (an alias word that also happens to be the unambiguous prefix of a real
    declared handle -- the ELSE alias ``"default"`` against a case literally
    named ``"default_case"``), that is not resolvable and fails closed
    rather than silently picking one.
    """
    canon = _canon(handle)
    for declared in handles:
        if _canon(declared) == canon:
            return declared
    alias_match = names.get(_canon_name(handle))
    stem_match: str | None = None
    if len(canon) >= _MIN_STEM:
        stems = [
            declared
            for declared in handles
            if len(_canon(declared)) >= _MIN_STEM
            and (canon.startswith(_canon(declared)) or _canon(declared).startswith(canon))
        ]
        if len(stems) == 1:
            stem_match = stems[0]
    if alias_match is not None and stem_match is not None:
        return alias_match if alias_match == stem_match else None
    return alias_match if alias_match is not None else stem_match


def repair_branch_edge_handles(nodes: list[Any], edges: list[Any]) -> list[dict[str, Any]]:
    """Re-home edges leaving a branch node onto the handles the node declares.

    A missing or ``None`` ``sourceHandle`` is resolved the way graphon
    resolves it at run time -- ``"source"`` -- before anything else: an
    already-valid graph (a fail-branch node's unkeyed success edges) must
    come out identical, never re-homed.

    Three passes per branch node, each only when it is forced:

    1. exact / alias / name / stem match (``else`` -> ``false``, a class name
       -> its id, ``approved`` -> ``approve``, ``success``/``error`` on a
       fail-branch node -> ``source``/``fail-branch``);
    2. edges still unmatched, all carrying the SAME unknown handle, when
       exactly one declared handle is unused -> that handle (one arm fanning
       out under an invented name). Never applied to a plain (non-branch)
       fail-branch node (see ``_is_plain_fail_branch``): with only "source"
       and "fail-branch" declared, an unrecognized name is as likely to mean
       one as the other, so only an explicit alias may resolve it. Nor to a
       branch-type node whose "fail-branch" arm is still unwired: the
       unknown name is as likely to be that failure arm as the one free
       branch arm (ELSE / a class / an action);
    3. edges on the default ``source`` handle, when there are at least as
       many unused declared handles -> unused handles in declaration order
       (the pre-existing behaviour).

    "Unused" for (2) and (3) never counts a handle in
    ``_UNCOUNTED_UNUSED_HANDLES`` (human-input's implicit ``"__timeout"`` arm,
    a fail-branch node's ``"fail-branch"`` arm): both exist because of the
    node's configuration, not because the author wired a branch, and are
    routinely left unwired, so they must not silently absorb an edge meant
    for the one real arm that IS left unused, and must not block that arm's
    resolution either.

    Anything else -- two different unknown names, one unknown edge with two
    free arms, a three-case node with invented names -- is left exactly as it
    was and returned, so a caller can fail closed on it
    (``undeclared_branch_handles`` still reports it afterwards). A wrong
    guess would silently swap the IF and ELSE arms, or a success arm for a
    failure arm; a visible rejection is better.
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
            effective = _effective_handle(handle)
            if effective in handles:
                continue
            if effective in _DEFAULT_HANDLES:
                unknown.append(edge)
                continue
            matched = _match_handle(str(handle), handles, names)
            if matched is None:
                unknown.append(edge)
            else:
                edge["sourceHandle"] = matched
        if not unknown:
            continue
        taken = {
            _effective_handle(e.get("sourceHandle"))
            for e in outgoing
            if _effective_handle(e.get("sourceHandle")) in handles
        }
        unused = [h for h in handles if h not in taken and h not in _UNCOUNTED_UNUSED_HANDLES]
        named = [
            e
            for e in unknown
            if e.get("sourceHandle") not in (None, "") and e.get("sourceHandle") not in _DEFAULT_HANDLES
        ]
        defaulted = [e for e in unknown if e not in named]
        distinct_names = {str(e.get("sourceHandle")) for e in named}
        # "fail-branch" never counts as unused (see _UNCOUNTED_UNUSED_HANDLES),
        # but while it is unwired an unknown name may well mean it.
        fail_branch_unwired = "fail-branch" in handles and "fail-branch" not in taken
        if (
            named
            and not defaulted
            and len(distinct_names) == 1
            and len(unused) == 1
            and not _is_plain_fail_branch(node)
            and not fail_branch_unwired
        ):
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
            effective = _effective_handle(edge.get("sourceHandle"))
            if effective in handles:
                continue
            bad.append(
                {
                    "node_id": node_id,
                    "target": str(edge.get("target") or ""),
                    "handle": effective,
                    "declared": list(handles),
                }
            )
    return bad
