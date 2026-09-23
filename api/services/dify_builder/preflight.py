"""Dry ``Graph.init`` for a draft graph: the node-data validation the engine
performs before it starts a run, without the run.

Both ESQ1-302 (an http-request body item without ``type``) and ESQ1-303 (an
if-else ``value`` written as a JSON number) died at ``Graph.init`` -- before
``workflow_started``, so the Builder saw an error frame with no run id and no
rows, and spent runs and approvals discovering what a validation pass could
have said up front. ``preflight_errors`` runs that pass over a graph dict.

Three layers, each built on the one above:

- ``preflight_errors`` -- every node ``Graph.init`` would reject;
- ``new_preflight_problems`` -- only the ones an edit ADDED, so a draft the
  user already broke cannot veto an unrelated change. This is the rule
  ``dify_port.apply_repair`` refuses a write on, defined once so the dry run
  and the write chokepoint cannot answer it differently;
- ``vet_intents`` -- the whole engine check a proposed batch must pass before
  it reaches the approval gate: the structural dry run plus that diff, with
  every refusal quoted from the engine.

Pure with respect to the Builder: no session, no DB, no engine state. It
imports ``core.workflow.node_factory`` (the same validation ``create_node``
does), which is why it lives in ``services/dify_builder`` and not in the
I/O-free ``core/dify_builder``.
"""

import copy
from collections.abc import Collection, Mapping
from typing import Any, NamedTuple

from pydantic import ValidationError

from core.dify_builder.models import Graph, MutationIntent
from core.workflow.graph_normalizers import heal_nodes_for_preflight
from core.workflow.node_factory import validate_node_config
from services.dify_builder import credentials, graph_ops

# Only for the node-type knowledge the rejoin guard's REASON needs -- which
# variable a node publishes -- stated once there so the sentence Edit's prompt
# shows the model and the sentence this module writes cannot name different
# variables. Nothing here renders a prompt, and ``graph_prompt`` is as pure as
# this module is (it reaches no further than ``credentials`` and
# ``graph_normalizers``).
from services.dify_builder.agent import graph_prompt

# graphon's ``Graph._filter_canvas_only_nodes`` drops persisted note widgets
# (top-level ``type == "custom-note"``, empty ``data.type``) before validating
# node configs. Mirror it, or every draft with a note would fail preflight.
_CANVAS_ONLY_NODE_TYPE = "custom-note"

# Stands in for a pydantic error location when validation did not raise a
# ``ValidationError`` at all. graphon's
# ``HttpRequestNodeAuthorization.check_config`` (nodes/http_request/entities.py)
# is a ``mode="before"`` validator on ``config`` that reads ``values.data["type"]``
# -- and ``type`` is absent from ``values.data`` whenever it failed its own
# ``Literal["no-auth", "api-key"]`` check. So the rule is: an ``authorization``
# with a ``config`` KEY PRESENT and ``type`` absent-or-invalid raises a bare
# ``KeyError``. Probed, all four shapes: ``{"config": {...}}``,
# ``{"type": None, "config": {...}}`` and ``{"type": "bogus", "config": {...}}``
# crash; ``{}`` and ``{"type": None}`` (no ``config`` key, so the validator never
# runs) raise an ordinary ``ValidationError`` at ``("authorization", "type")``.
# ``_CRASH_AUTHORIZATION_SHAPES`` in test_preflight.py pins all of them.
# A crash has no field path, so the exception's own class and message stand in
# for one: the same crash before and after a change is the same problem, a
# different one is a new problem. Angle-bracketed so it can never collide with a
# real field name.
_CRASH_LOCATION = "<crash>"

# How much of a crash's own message joins its class name in that stand-in
# location. Without it every non-``ValidationError`` failure on a node collapses
# to ``("<crash>", "KeyError")``, so a change that swaps one ``KeyError`` shape
# for a different one is not a new problem. Truncated because the location is
# compared for equality, not read.
_CRASH_MESSAGE_CHARS = 200


def preflight_errors(graph: Graph) -> list[str]:
    """Every node of ``graph`` that ``Graph.init`` would reject, one message
    each, in node order. Each message starts with ``node '<id>' (<type>):``
    (see ``core.workflow.node_factory.validate_node_config``). Empty when the
    draft would start.

    A validation step must never crash the Builder: a node whose validation
    raises something OTHER than ``ValueError`` (graphon's
    ``HttpRequestNodeAuthorization.check_config`` raises ``KeyError`` for an
    ``authorization`` with no ``type``, and pydantic does not wrap it) is
    reported as ``node '<id>' (<type>): <ExcName>: <message>`` -- the engine
    would not start that draft either -- and the next node is still checked.

    Every message is produced from a CREDENTIAL-REDACTED copy of the node (see
    ``_withheld_message``). The verdict is always taken from the real node.
    """
    return [problem.message for problem in _node_problems(graph)]


def _node_key(node: Mapping) -> tuple[str, str]:
    """``(id, data.type)`` -- what makes a node the SAME node across two versions
    of a graph. The type is part of it because a batch may delete a node and
    recreate its id as a different type (the from-scratch build does exactly
    that): the replacement is a new node, not the old one, and its problems are
    new."""
    data = node.get("data")
    node_type = str(data.get("type") or "") if isinstance(data, Mapping) else ""
    return str(node.get("id") or ""), node_type


def _node_label(node: Mapping) -> str:
    """``node '<id>' (<type>)``, the prefix ``validate_node_config`` gives its
    own ``ValueError`` messages."""
    node_id, node_type = _node_key(node)
    return f"node {node_id!r} ({node_type or 'unknown type'})"


def _validation_error(node: Mapping) -> Exception | None:
    """What ``Graph.init`` would raise for ``node``, or ``None`` if it starts."""
    try:
        validate_node_config(node)
    except Exception as exc:
        return exc
    return None


def _error_locations(exc: BaseException) -> frozenset[tuple[str, ...]]:
    """The pydantic error LOCATIONS behind ``exc`` -- one tuple per field path
    the engine refused, e.g. ``("cases", "0", "conditions", "0",
    "comparison_operator")``.

    This is what makes a problem identifiable across two versions of a node, and
    neither of the two obvious keys works:

    * node identity is too coarse. It exempts an already-refused node from every
      later verdict, so a batch that breaks it FURTHER passes unnoticed -- and
      for the whole ESQ1-302 / ESQ1-303 / F4 family the node a repair targets is
      by definition already invalid, which would leave ``propose_repair`` with no
      node-data coverage at all on the very node it is repairing.
    * message text is too fine. ``validate_node_config`` raises ONE error per
      node whose message embeds a truncated repr of the input, so repairing one
      of three missing fields rewrites the messages for the other two and an
      exact-text diff refuses the repair that improved the node.

    A location is exactly right: a NEW field path on an already-broken node is a
    new problem, and a changed input repr at the SAME path is not.

    ``validate_node_config`` re-raises pydantic's error as its own ``ValueError``
    (``node_factory._validated_node_config``) with ``from exc``, so the original
    is reached through the ``__cause__``/``__context__`` chain rather than off
    the exception handed back.
    """
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, ValidationError):
            located = frozenset(tuple(str(part) for part in error["loc"]) for error in current.errors())
            if located:
                return located
            break
        current = current.__cause__ or current.__context__
    # No field path to key on. Fall back to the crash's own class AND its
    # (truncated) message -- never an empty set, which would make a real problem
    # permanently un-new. The message is part of the key because the class alone
    # makes every ``KeyError`` on a node the same problem, so a change that
    # replaces one crashing shape with another would pass unnoticed.
    return frozenset({(_CRASH_LOCATION, type(exc).__name__, str(exc)[:_CRASH_MESSAGE_CHARS])})


def _location_label(location: tuple[str, ...]) -> str:
    """A location rendered for a message a human and the model both read.

    A crash location's third element is the exception's OWN message -- the one
    part of a location not derived from a field path, and so the only part that
    could echo a value out of the node. It is keyed on (see
    ``_error_locations``) and never shown.
    """
    if location[:1] == (_CRASH_LOCATION,):
        return ".".join(location[:2])
    return ".".join(location)


def _withheld_message(node: Mapping, exc: Exception, locations: frozenset[tuple[str, ...]]) -> str:
    """The engine's refusal, with the node's credentials withheld -- to
    ``credentials.redact_node_config``'s DECLARED SCOPE, which is not every
    string in the node (see that module: a request ``body`` value is outside it,
    on purpose).

    pydantic puts ``input_value=<repr of what it was given>`` in its message, and
    for a model-level error that repr is the node's whole ``data`` -- which for
    an http-request node is where a live bearer token sits. This message goes
    straight into a corrective re-prompt, so it is built by re-validating a
    ``credentials.redact_node_config`` copy; the VERDICT (whether the node is
    refused, and at which locations) is always taken from the real node above.

    Task 3 closed this leak on the two paths that inline a node's config into a
    prompt; a rejection reason is the third.
    """
    data = node.get("data")
    if not isinstance(data, dict):
        return _raw_message(node, exc)  # no config to carry a secret
    safe_node = {**node, "data": credentials.redact_node_config(data)}
    safe_exc = _validation_error(safe_node)
    if safe_exc is None:
        # Redaction changed the verdict -- not observed (it replaces a secret
        # VALUE with a string of the same type), but a message built from the
        # real node could carry the secret, so say only what is certainly safe.
        paths = ", ".join(sorted(_location_label(location) for location in locations))
        return f"{_node_label(node)}: refused by the engine at {paths}"
    return _raw_message(safe_node, safe_exc)


def _raw_message(node: Mapping, exc: Exception) -> str:
    """``validate_node_config``'s own ``ValueError`` text, or the same
    ``node '<id>' (<type>):`` prefix for a crash it does not wrap."""
    if isinstance(exc, ValueError):
        return str(exc)
    return f"{_node_label(node)}: {type(exc).__name__}: {exc}"


class _NodeProblem(NamedTuple):
    node: tuple[str, str]
    locations: frozenset[tuple[str, ...]]
    message: str


def _node_problems(graph: Graph) -> list[_NodeProblem]:
    """One ``_NodeProblem`` per node ``Graph.init`` would reject, in node order."""
    problems: list[_NodeProblem] = []
    for node in graph.get("nodes") or []:
        if not isinstance(node, Mapping) or node.get("type") == _CANVAS_ONLY_NODE_TYPE:
            continue
        exc = _validation_error(node)
        if exc is None:
            continue
        locations = _error_locations(exc)
        problems.append(_NodeProblem(_node_key(node), locations, _withheld_message(node, exc, locations)))
    return problems


def new_preflight_problems(before: Graph, after: Graph, touched: Collection[str]) -> list[str]:
    """Every problem this batch is ANSWERABLE for, one message each, in node
    order. Empty when the batch is safe to write.

    Two rules, because a node the batch wrote and a node it left alone are not
    the same question.

    **A node in ``touched`` must be fully startable.** No exemption at all: if
    the engine still refuses it after the write, the batch is refused. A repair
    targets a node that is by definition already invalid (that is the whole
    ESQ1-302 / ESQ1-303 / F4 family), so under any "new problems only" rule a
    repair that swaps one bad value for another bad value AT THE SAME field
    path -- or fixes one of three missing fields and leaves two -- produces
    nothing new, is written, and the card says "Applied the changes" over a
    draft that still cannot start. That silent false success is Fix's main
    line, not an edge case, and no key short of "did it actually work" catches
    it. ``touched`` is the caller's own record of the nodes whose DATA it wrote
    (``graph_ops.DryRun.changed_nodes``, ``apply_repair``'s ``written_nodes``),
    so this asks exactly that.

    "Wrote its data" is narrower than "appears in the change set", and the
    difference is load-bearing in this direction: a ``connect`` reports both its
    endpoints as changed, but adding an edge cannot change a node's
    ``validate_node_config`` verdict, so counting an endpoint here would let
    merely WIRING an already-broken node make that node's pre-existing defect
    veto the batch -- the exact invariant the second rule below exists to keep.
    Both callers exclude it; see ``graph_ops.DryRun``.

    **Every other node keeps its location-keyed exemption.** A draft the user
    already broke -- a half-configured node they left on the canvas -- must not
    veto an unrelated change, and a change that heals one is a change that
    passed. Keyed on the set of pydantic error LOCATIONS per node (see
    ``_error_locations``), which is the only key that gets both halves right for
    a node nobody wrote:

    * one the change breaks FURTHER gains a location, so it IS reported;
    * one whose remaining errors merely re-render (pydantic quotes a truncated
      repr of the input, so a change elsewhere can rewrite its message) gains NO
      location, so it is not reported as if it had broken.

    A node absent from ``before`` has no known locations, so everything the
    engine says about a node this batch ADDED is new either way.

    The message reported is that node's whole refusal, pre-existing locations
    included: the model fixing it needs the node's full state, not just the delta.

    ``before`` is deliberately NOT healed first, while ``after`` (the dry run's
    working copy, or the port's mutated draft) already has been. The asymmetry
    can only ever grow the set of already-known locations, which is the safe
    direction: it may let a pre-existing defect through on an UNtouched node, it
    can never manufacture a new one.

    ``touched`` is required rather than defaulted: the answer depends on what
    was written, and a caller that silently got the weaker rule is exactly the
    bug this parameter exists to close. Pass ``()`` to compare two graphs with
    no batch behind them.

    One definition for two callers that must agree: ``dify_port.apply_repair``
    raises ``PreflightError`` on a non-empty result, and ``vet_intents`` predicts
    exactly that refusal one step earlier, while a corrective re-prompt is still
    affordable. If they computed it separately the dry run would be guessing --
    which is why ``touched`` has to be the same set on both sides too (the
    pre-heal ``changed_nodes``; see ``graph_ops.DryRun``).
    """
    written = frozenset(touched)
    known: dict[tuple[str, str], frozenset[tuple[str, ...]]] = {}
    for problem in _node_problems(before):
        known[problem.node] = known.get(problem.node, frozenset()) | problem.locations
    return [
        problem.message
        for problem in _node_problems(after)
        if problem.node[0] in written or problem.locations - known.get(problem.node, frozenset())
    ]


def _withheld_args(intent: MutationIntent) -> dict:
    """``intent.args`` with the args that carry a node's DATA -- ``create_node``
    and ``insert_between``'s ``config``, ``set_node_config``'s ``value``
    (``graph_ops._REDACTABLE_ARGS``) -- credential-redacted.

    A rejection line inlines the whole arg dict into a corrective re-prompt, so
    it is the same kind of channel as the node config ``_withheld_message``
    covers. These args are model-authored today, so nothing stored can ride
    along; redacting anyway costs one dict copy and means a future path that
    round-trips a real node's data through an intent cannot re-open the leak.

    Two passes, because a ``set_node_config`` carries its value in two
    different shapes. The first treats ``value``/``config`` as a whole node
    ``data``, which is what ``create_node`` and ``insert_between`` send. The
    second treats it as the value at the intent's own ``path``, which is what
    ``set_node_config`` sends: ``path="headers"`` with a header LINE, or
    ``path="authorization"`` with the auth block itself, is not node-data-shaped
    and the first pass walks straight past it.
    """
    args = dict(intent.args)
    for key in ("config", "value"):
        carried = args.get(key)
        if isinstance(carried, dict):
            args[key] = credentials.redact_node_config(carried)
    path = args.get("path")
    if "value" in args and isinstance(path, str) and path:
        args["value"] = _redacted_at_path(path, args["value"])
    return args


def _redacted_at_path(path: str, value: Any) -> Any:
    """``value`` redacted as if it were sitting at ``path`` inside a node's
    ``data``.

    Wraps the value back up in the nesting its path describes, runs the ONE
    redaction profile over the result and unwraps it again -- so
    ``credentials`` stays the single definition of what a credential is, and a
    field it learns about later is covered here for free. A path that names
    nothing credential-shaped comes back byte-identical, which matters: this
    value is what the corrective re-prompt tells the model to correct.
    """
    segments = path.split(".")
    wrapped: Any = value
    for segment in reversed(segments):
        wrapped = {segment: wrapped}
    unwrapped: Any = credentials.redact_node_config(wrapped)
    for segment in segments:
        if not isinstance(unwrapped, Mapping) or segment not in unwrapped:
            return value
        unwrapped = unwrapped[segment]
    return unwrapped


_AGGREGATOR_NODE_TYPE = "variable-aggregator"


def _edge_pairs(graph: Graph) -> set[tuple[str, str]]:
    """Which node REACHES which, ignoring the handle it leaves on.

    Deliberately not keyed on ``sourceHandle``: re-routing an existing
    ``N -> A`` from one arm to another does not change whether ``A`` has been
    told about ``N``, and keying on the handle would make that re-route look
    like a brand-new branch and refuse a batch that was already correct.
    """
    return {
        (str(edge.get("source")), str(edge.get("target")))
        for edge in graph.get("edges") or []
        if isinstance(edge, Mapping)
    }


def _aggregator_selector_variables(data: Mapping[str, Any]) -> dict[str, set[str]]:
    """Which variables this aggregator's selectors name, grouped by the node
    each selector is rooted at.

    Both places graphon reads selectors from are scanned regardless of
    ``group_enabled`` (``VariableAggregatorNode._run`` takes the flat
    ``variables`` when it is off and ``advanced_settings.groups[*].variables``
    when it is on). Scanning both can only ever FIND a selector, which is the
    safe direction for a guard that refuses when it finds none.

    A selector shorter than ``[node, variable]`` names no variable and so
    contributes nothing: it cannot resolve, which is the very condition being
    guarded against.
    """
    named: dict[str, set[str]] = {}

    def collect(selectors: Any) -> None:
        if not isinstance(selectors, list):
            return
        for selector in selectors:
            if isinstance(selector, list) and len(selector) >= 2:
                named.setdefault(str(selector[0]), set()).add(str(selector[1]))

    collect(data.get("variables"))
    advanced = data.get("advanced_settings")
    if isinstance(advanced, Mapping):
        groups = advanced.get("groups")
        if isinstance(groups, list):
            for group in groups:
                if isinstance(group, Mapping):
                    collect(group.get("variables"))
    return named


def _reaches_along_new_edges(source: str, new_pairs: Collection[tuple[str, str]]) -> set[str]:
    """``source`` and every node that reaches it along edges THIS BATCH ADDED.

    A branch of more than one node is an ordinary shape: a batch that adds
    ``n7 -> n8`` and ``n8 -> aggregator`` has told the aggregator about the new
    arm if it lists EITHER of them, because both run whenever that arm runs.
    Keying on the immediate source alone refused the two-node version of the
    very edit this guard is meant to allow.

    Restricted to the batch's OWN new edges on purpose, and this is the whole
    soundness argument: nodes chained by edges this batch added all run together
    when the new arm runs. Walking back through PRE-EXISTING edges as well would
    cross into the graph's exclusive branches -- in the live S6 shape the
    aggregator's existing selectors are rooted in the OTHER arms of the same
    if-else, which never run when the new one does, so treating them as
    ancestors would accept exactly the batch that produces nothing.
    """
    predecessors: dict[str, set[str]] = {}
    for edge_source, edge_target in new_pairs:
        predecessors.setdefault(edge_target, set()).add(edge_source)
    seen = {source}
    stack = [source]
    while stack:
        node_id = stack.pop()
        for parent in predecessors.get(node_id, set()):
            if parent not in seen:
                seen.add(parent)
                stack.append(parent)
    return seen


def _feeds(named: Mapping[str, set[str]], node_id: str, node: Mapping[str, Any]) -> bool:
    """True when the aggregator has a selector rooted at ``node_id`` naming a
    variable that node actually PUBLISHES.

    Rooted-at is not enough on its own: ``["node7", "output"]`` on a node that
    publishes ``text`` is exactly as unresolvable as no selector at all, and the
    run skips it in the same silence -- so a guard that accepted any name would
    leave the failure it was built for intact behind a selector that looks
    right.

    The published set comes from ``graph_prompt.published_variables_of``, which
    answers ``None`` for a type whose set is not knowable. ``None`` accepts:
    this guard refuses a name it KNOWS is wrong, never one it merely cannot
    confirm.
    """
    variables = named.get(node_id)
    if not variables:
        return False
    published = graph_prompt.published_variables_of(node)
    if published is None:
        return True
    return bool(variables & published)


def _unfed_aggregator_reasons(before: Graph, after: Graph) -> list[str]:
    """Every new branch this batch wires into a ``variable-aggregator`` without
    telling that aggregator about it.

    This is the one shape that still ended in "All checks passed" on empty
    output. The aggregator stays engine-VALID -- its EXISTING selectors still
    resolve, so ``preflight_errors`` has nothing to say and no single intent
    owns the defect -- while graphon's ``VariableAggregatorNode._run``
    (``nodes/variable_aggregator/variable_aggregator_node.py:29-50``) walks the
    selectors, finds nothing for the new arm, and returns ``SUCCEEDED`` with
    ``outputs={}``. The End node still runs, so even
    ``run_finished_without_output`` is False: the Builder reports success over a
    workflow that produces nothing on the branch the user just asked for.

    Kept narrow on purpose, because a guard that false-rejects is worse than no
    guard:

    * it fires only on an edge THIS BATCH ADDED. An aggregator the user already
      wired badly keeps the same exemption ``new_preflight_problems`` gives a
      node the user already broke;
    * the target must be an aggregator. A new branch that routes anywhere else
      -- another node, the End node -- is an ordinary edit and is not looked at;
    * "told about it" means a selector rooted at ANY node on the new arm --
      not just the edge's immediate source (``_reaches_along_new_edges``) and
      in either of the two selector homes -- naming a variable that node really
      publishes (``_feeds``). The first half is what stops a two-node branch
      being refused; the second is what stops ``["node7", "output"]`` on a node
      that publishes ``text`` passing as an answer when the run skips it in the
      same silence as no selector at all.

    Keyed entirely on graph structure and node data. Nothing the model said
    about its own proposal is consulted.
    """
    new_pairs = _edge_pairs(after) - _edge_pairs(before)
    if not new_pairs:
        return []
    nodes_by_id = {str(node.get("id")): node for node in after.get("nodes") or [] if isinstance(node, Mapping)}
    reasons: list[str] = []
    for source, target in sorted(new_pairs):
        aggregator = nodes_by_id.get(target)
        data = aggregator.get("data") if isinstance(aggregator, Mapping) else None
        if not isinstance(data, Mapping) or data.get("type") != _AGGREGATOR_NODE_TYPE:
            continue
        named = _aggregator_selector_variables(data)
        if any(
            _feeds(named, ancestor, nodes_by_id.get(ancestor) or {})
            for ancestor in _reaches_along_new_edges(source, new_pairs)
        ):
            continue
        variable = graph_prompt.output_variable_of(nodes_by_id.get(source) or {})
        reasons.append(
            f"the new branch {source} -> {target} would run and produce nothing: {target} is a "
            f"{_AGGREGATOR_NODE_TYPE} and none of its selectors is rooted at {source}. Append "
            f'["{source}", "{variable}"] to {target}\'s variables, re-sending the existing '
            f"selectors byte-identical. A selector the run cannot resolve is skipped in silence, "
            f"so without it the workflow still reports success and {target} outputs nothing."
        )
    return reasons


# The keys that make an ARRAY ELEMENT the same element across two versions of a
# node's data, INSIDE the arrays listed below. Neither key is read by the engine
# on every array that carries it -- graphon's ``Condition``
# (utils/condition/entities.py) has no ``id`` field at all -- which is exactly
# why losing one is silent: pydantic validates the rewritten array happily and
# the canvas quietly renders a different case.
_IDENTITY_KEYS = frozenset({"id", "case_id"})

# Where those keys MEAN something. Scoped by (node type, path) because ``id`` is
# a frontend uuid in plenty of arrays where losing it costs nothing, and
# refusing those writes blocks ordinary edits:
#
#   an llm ``prompt_template`` message carries an ``id`` the canvas mints and
#   REGENERATES when it is absent (web .../llm/components/config-prompt.tsx:61,
#   ``item.id || uuid4()``), and graphon's ``ChatModelMessage``
#   (prompt_entities.py:8-13) is ``text`` / ``role`` / ``edition_type`` with no
#   ``id`` field. Rewriting a prompt as a whole array without echoing those
#   uuids loses nothing -- and editing a prompt is the commonest thing anyone
#   asks the Builder to do.
#
# Each pair below was checked against the engine before being added:
#
# * ``if-else`` ``cases`` -- ``IfElseNodeData.Case.case_id`` is a REQUIRED
#   engine field and is the edge ``sourceHandle`` a branch routes on
#   (``graph_normalizers.declared_branch_handles``). Losing one orphans an arm;
# * ``if-else`` ``cases.*.conditions`` -- the same array addressed one case
#   down, so a rewrite of it is the same write;
# * ``question-classifier`` ``classes`` -- ``ClassConfig.id`` is required and
#   documented in graphon as "Stable branch identifier used for routing and edge
#   handles" (question_classifier/entities.py:12-15). Identical in kind to
#   ``case_id``;
# * ``knowledge-retrieval`` ``metadata_filtering_conditions.conditions`` -- the
#   engine ``Condition`` (core/rag/entities/metadata_entities.py:44) has no
#   ``id``, but the canvas mints one per condition (web
#   .../knowledge-retrieval/hooks/use-knowledge-metadata-config.ts:57) and a
#   regenerated filter silently changes which documents are retrieved.
#
# Digit segments are normalized to ``*`` (see ``_normalized_path``), so an
# indexed path matches its pattern. Deliberately NOT here: ``loop``
# ``break_conditions`` and ``list-operator`` ``filter_by.conditions``, whose
# elements carry no branch identity and whose engine entities have no ``id`` --
# they would be a false-rejection surface bought for nothing.
_IDENTITY_ARRAY_PATHS: Mapping[str, frozenset[str]] = {
    "if-else": frozenset({"cases", "cases.*.conditions"}),
    "question-classifier": frozenset({"classes"}),
    "knowledge-retrieval": frozenset({"metadata_filtering_conditions.conditions"}),
}


def _normalized_path(path: str) -> str:
    """``cases.0.conditions`` -> ``cases.*.conditions``: the shape of a path,
    with every array index collapsed, so one pattern covers every element."""
    return ".".join("*" if segment.isdigit() else segment for segment in path.split("."))


def _carries_structural_identities(node_type: str, path: str) -> bool:
    """Whether ``path`` on a node of ``node_type`` is one of the arrays whose
    element identities are load-bearing (see ``_IDENTITY_ARRAY_PATHS``)."""
    return _normalized_path(path) in _IDENTITY_ARRAY_PATHS.get(node_type, frozenset())


def _identities(value: Any) -> set[tuple[str, str]]:
    """Every element identity anywhere under ``value``.

    The whole subtree, not just the top level, because the live clobber was one
    level down: the rewrite kept both ``case_id``s and regenerated the surviving
    case's CONDITIONS from scratch, losing the condition's ``id`` (and turning
    ``= 60`` into ``≥ 60`` with it). A top-level-only comparison would have
    called that batch clean.

    Keyed on ``(key, value)`` so moving an identity from ``case_id`` to ``id``
    is a change, and only non-empty strings count -- a generated placeholder
    that is ``None`` or ``""`` identifies nothing.
    """
    found: set[tuple[str, str]] = set()
    stack: list[Any] = [value]
    while stack:
        current = stack.pop()
        if isinstance(current, Mapping):
            for key, item in current.items():
                if key in _IDENTITY_KEYS and isinstance(item, str) and item:
                    found.add((str(key), item))
                stack.append(item)
        elif isinstance(current, list):
            stack.extend(current)
    return found


def _is_pure_deletion(existing: list, written: list) -> bool:
    """True when ``written`` is ``existing`` with elements REMOVED and nothing
    else done to it.

    "Nothing else" is the whole test, and it is made of two halves that have to
    hold together: every element kept is byte-identical to one of the
    originals, and each original may be claimed only once (so re-sending one
    element twice in place of two is not a deletion), and fewer are kept than
    were given. A write that also modified a survivor, or added an element the
    draft did not have, fails it -- which is exactly the regeneration this
    guard is for.

    Deliberately equality on the whole element, not on its identity: keeping a
    case's ``case_id`` while quietly rewriting its condition is the live S6
    clobber, and it has to stay refused.
    """
    if len(written) >= len(existing):
        return False
    unclaimed = list(existing)
    for element in written:
        for index, candidate in enumerate(unclaimed):
            if candidate == element:
                del unclaimed[index]
                break
        else:
            return False
    return True


def _node_data(graph: Graph, node_id: str) -> dict | None:
    for node in graph.get("nodes") or []:
        if isinstance(node, Mapping) and str(node.get("id")) == node_id:
            data = node.get("data")
            return data if isinstance(data, dict) else None
    return None


def _dropped_identity_reasons(before: Graph, after: Graph, intents: Collection[MutationIntent]) -> list[str]:
    """Every whole-array ``set_node_config`` in this batch that lost an element
    the draft already had.

    The second half of the live S6 clobber. Asked to ADD a case to an if-else,
    the model re-sent the whole ``cases`` array -- the only way to append one --
    and regenerated the case it was not asked about, dropping its condition's
    ``id`` and its ``varType`` and rewriting ``= 60`` as ``≥ 60``. The engine
    accepts every part of that (``id`` and ``varType`` are frontend-only,
    ``≥ 60`` is a perfectly valid condition), ``diff_graphs`` reports one line
    ("cases updated"), and the user's threshold has silently changed meaning.

    The op schema tells the model to re-send existing elements byte-identical.
    This is the half that does not depend on it obeying.

    Narrow by construction, and the neighbouring shapes are the point:

    * only the arrays whose element identities MEAN something are looked at, by
      (node type, path) -- see ``_IDENTITY_ARRAY_PATHS``. An ``id`` is a
      frontend uuid in plenty of other arrays, and the one that matters is an
      llm's ``prompt_template``: the canvas regenerates a missing message id and
      graphon has no field for it, so rewriting a prompt as a whole array is an
      ordinary edit that this must not touch. Inside a scoped array the walk
      stays recursive, which is what catches the S6 condition ``id`` one level
      down;
    * only a write that REPLACES AN EXISTING ARRAY with another array is looked
      at. Changing one element by its index writes a scalar into the array and
      is never compared;
    * only identities PRESENT BEFORE and ABSENT AFTER count. An append that
      repeats every existing element -- exactly what the schema asks for --
      keeps them all and passes untouched, whatever else it adds;
    * an array whose elements never carried an identity has nothing to lose, so
      a ``variable-aggregator``'s ``variables`` (bare selector arrays, and the
      only way to extend it is to re-send it whole) is never in scope. The
      rejoin guard demands that write; this one must not stand in its way;
    * a DELETION is not a clobber. Removing an if-else case is a legitimate
      edit and a whole-array write is the only way to express one, so a guard
      that refused it would make the feature unusable -- loudly, but unusably.
      The two shapes are distinguishable without asking the model what it
      meant, which is the only reason this exception exists: a deletion leaves
      every element it KEEPS byte-identical to one of the originals and keeps
      fewer than it was given (``_is_pure_deletion``), while a regeneration
      loses an identity in the same write that modified or added something
      else. The live S6 batch is the second kind -- it appended ``excellent``
      AND rewrote the surviving case -- so it is still refused, and so is the
      mixed write that deletes one element while editing another.

    The comparison is made against a HEALED copy of ``before``, because
    ``after`` is the dry run's already-healed graph: a draft holding ``">="``
    or a JSON ``60`` (the ESQ1-303 shape this whole plan grew out of) would
    otherwise make a survivor the model re-sent verbatim look modified, and a
    genuine deletion would be refused for a difference the heal set introduced.
    Healing can only ever make two elements MORE equal, so it can only reduce
    false rejections.

    Compared against the graph as it stands BEFORE the batch and as it stands
    AFTER every applicable intent, so two intents writing the same array in one
    batch are judged on the net result -- which is what gets written.
    """
    if not any(intent.op == "set_node_config" for intent in intents):
        return []
    healed_before = copy.deepcopy(before)
    heal_nodes_for_preflight(healed_before.get("nodes") or [])

    reasons: list[str] = []
    seen: set[tuple[str, str]] = set()
    for intent in intents:
        if intent.op != "set_node_config":
            continue
        node_id, path = intent.args.get("node_id"), intent.args.get("path")
        if not isinstance(node_id, str) or not isinstance(path, str) or (node_id, path) in seen:
            continue
        seen.add((node_id, path))
        data_before, data_after = _node_data(healed_before, node_id), _node_data(after, node_id)
        if data_before is None or data_after is None:
            continue
        if not _carries_structural_identities(str(data_before.get("type") or ""), path):
            continue
        found_before, existing = graph_ops.value_at_path(data_before, path)
        found_after, written = graph_ops.value_at_path(data_after, path)
        if not (found_before and found_after) or not isinstance(existing, list) or not isinstance(written, list):
            continue
        lost = sorted(_identities(existing) - _identities(written))
        if not lost or _is_pure_deletion(existing, written):
            continue
        named = ", ".join(f"{key} {value!r}" for key, value in lost)
        reasons.append(
            f"the write to {path!r} on node {node_id!r} re-sent the whole array and lost {named}: "
            f"an element the draft already had is gone from it. To change ONE element, address it "
            f"by index ({path}.0....) and leave its siblings alone; to ADD one, re-send every "
            f"existing element byte-identical -- ids included -- with the new element appended."
        )
    return reasons


class VettedIntents(NamedTuple):
    """A proposed batch as the engine sees it.

    ``rejections`` is the corrective-re-prompt text, one ``- ...`` line per
    refusal, EMPTY when the batch would apply and the draft would still start.
    Every line quotes the engine -- an ``apply_*``/``validate_intent_args``
    ``ValueError`` or a ``validate_node_config`` message -- never anything the
    model said about its own proposal.

    ``would_run_wrong`` is the subset of those refusals that the engine does NOT
    make: the two semantic guards. It is carried separately because the two
    kinds fail differently and a caller has to be able to tell them apart
    WITHOUT reading the text:

    * a structural refusal DROPPED its intent, so what is left in ``applicable``
      is a batch nobody has judged wrong. Keeping it -- rather than losing the
      user's whole change -- is a deliberate choice;
    * a semantic verdict drops nothing. It condemns the batch that is still
      sitting in ``applicable``, and there is no engine refusal behind it for
      ``apply_repair`` to raise, so a caller that wrote it anyway would write
      the exact draft the guard was built to stop.

    Reading which is which off the rejection PROSE would be the same mistake as
    keying control flow on the model's prose: the text is for a human and a
    re-prompt, the list is for the code.
    """

    applicable: list[MutationIntent]
    rejections: list[str]
    would_run_wrong: list[str]


def vet_intents(
    graph: Graph,
    intents: list[MutationIntent],
    allowed_node_types: set[str] | None = None,
) -> VettedIntents:
    """Put a proposed batch through the whole engine check, structure AND node
    data, before it can reach a human approval gate.

    Two layers, because they fail differently:

    * ``graph_ops.filter_applicable`` refuses ONE intent at a time -- an unknown
      op, a dangling id, a path that does not resolve. Those intents are dropped
      and the rest still stand.
    * the preflight refuses the RESULTING GRAPH. A node's config is only invalid
      in combination (an if-else whose operator is not one of graphon's
      literals), and no single intent owns that verdict, so a new problem does
      not drop an intent -- it makes the batch as a whole unsafe to hand to the
      gate.

    Before this existed the second layer was missing entirely: the live F4 Edit
    proposed four intents, all four passed the structural filter ("applicable, 0
    rejected"), the batch then died at ``apply_repair``'s preflight, and the one
    corrective re-prompt could never fire because nothing had been rejected.
    Every re-approval re-sent the identical prompt and got the identical batch
    back.
    """
    dry_run = graph_ops.filter_applicable(graph, intents, allowed_node_types)
    rejections = [f"- {intent.op} {_withheld_args(intent)}: {reason}" for intent, reason in dry_run.rejected]
    rejections += [
        f"- the draft would then not start: {problem}"
        # The dry run's own record of what the batch wrote, which is the port's
        # too -- a node this batch touches has to be startable, not merely no
        # worse than it was.
        for problem in new_preflight_problems(graph, dry_run.graph, dry_run.changed_nodes)
    ]
    # The third layer: two defects the engine accepts and then runs to nothing.
    # ``Graph.init`` is happy with both, so neither can be quoted from it --
    # they are keyed on the batch's own effect on the graph instead, never on
    # anything the model said.
    would_run_wrong = _unfed_aggregator_reasons(graph, dry_run.graph) + _dropped_identity_reasons(
        graph, dry_run.graph, dry_run.applicable
    )
    rejections += [f"- {reason}" for reason in would_run_wrong]
    return VettedIntents(dry_run.applicable, rejections, would_run_wrong)
