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

from collections.abc import Mapping
from typing import NamedTuple

from pydantic import ValidationError

from core.dify_builder.models import Graph, MutationIntent
from core.workflow.node_factory import validate_node_config
from services.dify_builder import credentials, graph_ops

# graphon's ``Graph._filter_canvas_only_nodes`` drops persisted note widgets
# (top-level ``type == "custom-note"``, empty ``data.type``) before validating
# node configs. Mirror it, or every draft with a note would fail preflight.
_CANVAS_ONLY_NODE_TYPE = "custom-note"

# Stands in for a pydantic error location when validation did not raise a
# ``ValidationError`` at all -- graphon's
# ``HttpRequestNodeAuthorization.check_config`` raises a bare ``KeyError`` for an
# ``authorization`` with no ``type``. A crash has no field path, so the
# exception's own class name IS its location: the same crash before and after a
# change is the same problem, a different one is a new problem. Angle-bracketed
# so it can never collide with a real field name.
_CRASH_LOCATION = "<crash>"


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
    # No field path to key on. Fall back to the crash's own class -- never an
    # empty set, which would make a real problem permanently un-new.
    return frozenset({(_CRASH_LOCATION, type(exc).__name__)})


def _withheld_message(node: Mapping, exc: Exception, locations: frozenset[tuple[str, ...]]) -> str:
    """The engine's refusal, with the node's credentials withheld.

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
        paths = ", ".join(sorted(".".join(location) for location in locations))
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


def new_preflight_problems(before: Graph, after: Graph) -> list[str]:
    """Every node of ``after`` the engine refuses at a location it did not
    already refuse in ``before``, one message each, in node order.

    NEW problems only. A draft the user already broke -- a half-configured node
    they left on the canvas -- must not veto an unrelated change somewhere else,
    and a change that heals one is a change that passed.

    Keyed on the set of pydantic error LOCATIONS per node (see
    ``_error_locations``), which is the only key that gets both halves right:

    * a node that was already refused and this change breaks FURTHER gains a
      location, so it IS reported. Node identity alone would exempt it -- and
      since a Fix repair targets a node that is by definition already invalid,
      that would leave ``propose_repair`` with no node-data coverage on its own
      culprit;
    * a node whose remaining errors merely re-render (pydantic quotes a
      truncated repr of the input, so filling one of three missing fields
      rewrites the other two messages) gains NO location, so a valid partial
      repair is not refused as if it had broken something.

    A node absent from ``before`` has no known locations, so everything the
    engine says about a node this batch ADDED is new.

    The message reported is that node's whole refusal, pre-existing locations
    included: the model fixing it needs the node's full state, not just the delta.

    ``before`` is deliberately NOT healed first, while ``after`` (the dry run's
    working copy, or the port's mutated draft) already has been. The asymmetry
    can only ever grow the set of already-known locations, which is the safe
    direction: it may let a pre-existing defect through, it can never manufacture
    a new one.

    One definition for two callers that must agree: ``dify_port.apply_repair``
    raises ``PreflightError`` on a non-empty result, and ``vet_intents`` predicts
    exactly that refusal one step earlier, while a corrective re-prompt is still
    affordable. If they computed it separately the dry run would be guessing.
    """
    known: dict[tuple[str, str], frozenset[tuple[str, ...]]] = {}
    for problem in _node_problems(before):
        known[problem.node] = known.get(problem.node, frozenset()) | problem.locations
    return [
        problem.message for problem in _node_problems(after) if problem.locations - known.get(problem.node, frozenset())
    ]


class VettedIntents(NamedTuple):
    """A proposed batch as the engine sees it.

    ``rejections`` is the corrective-re-prompt text, one ``- ...`` line per
    refusal, EMPTY when the batch would apply and the draft would still start.
    Every line quotes the engine -- an ``apply_*``/``validate_intent_args``
    ``ValueError`` or a ``validate_node_config`` message -- never anything the
    model said about its own proposal.
    """

    applicable: list[MutationIntent]
    rejections: list[str]


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
    rejections = [f"- {intent.op} {intent.args}: {reason}" for intent, reason in dry_run.rejected]
    rejections += [
        f"- the draft would then not start: {problem}" for problem in new_preflight_problems(graph, dry_run.graph)
    ]
    return VettedIntents(dry_run.applicable, rejections)
