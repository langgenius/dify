"""How a draft's graph -- and the ops that may be written against it -- are
described to a model.

Edit and Fix prompt the same engine about the same draft through the same
``graph_ops`` apply functions, so what they say about branch handles, indexed
paths and the engine's comparison literals has to be ONE text and ONE
rendering. Fix went without the handle half entirely: its op schema listed
``connect: {from_node, to_node}`` and its graph view printed no handles, so a
connect it proposed from an if-else / question-classifier / human-input node
fell back to the ``"source"`` handle, ``graph_ops.apply_connect`` refused it,
the single corrective re-prompt was spent on that refusal and
``propose_repair`` ended in ``_no_fix()``. Edit was given the handles in
197cd9c5ad; this module is what stops the two drifting apart again.

What is NOT here is what the two agents do differently: Edit's rule about
following a new branch to the variable-aggregator it rejoins belongs to
rewriting a plan, and Fix's culprit-only config rendering belongs to repairing
one diagnosed node.
"""

import json
from collections.abc import Mapping
from typing import Any

from core.workflow.graph_normalizers import declared_branch_handles
from services.dify_builder import credentials

# graphon reads an edge with no ``sourceHandle`` as this one
# (``edge_config.get("sourceHandle", "source")``, ``graph/graph.py``), so an
# edge sitting on it carries no information worth a line of prompt.
_DEFAULT_SOURCE_HANDLE = "source"


def node_line(node: Mapping[str, Any]) -> str:
    """One node as ``  id (type): title``, plus the source handles it declares.

    ``declared_branch_handles`` is the engine's own answer (if-else case ids
    plus the implicit ``false``, question-classifier class ids, human-input
    actions plus ``__timeout``, and a fail-branch's ``source`` /
    ``fail-branch``), and it is exactly the vocabulary ``apply_connect``
    accepts: a connect from such a node on any other handle -- the default
    ``"source"`` included -- is refused. A model that cannot see the handles
    cannot write one.
    """
    data = node.get("data") or {}
    line = f"  {node.get('id')} ({data.get('type', '?')}): {data.get('title', '')}"
    handles = declared_branch_handles(node)
    if handles:
        line += f" handles={handles}"
    return line


def edge_line(edge: Mapping[str, Any]) -> str:
    """One edge as ``  source -> target``, naming a non-default source handle.

    ``branch -[true]-> next`` is what tells the model which arm an existing
    edge leaves on, so the handles on the node line come with a worked example
    of one in use rather than a bare list.
    """
    handle = edge.get("sourceHandle")
    if handle and handle != _DEFAULT_SOURCE_HANDLE:
        return f"  {edge.get('source')} -[{handle}]-> {edge.get('target')}"
    return f"  {edge.get('source')} -> {edge.get('target')}"


# What a node of each type PUBLISHES -- the second element of a selector rooted
# at that node, and so the thing an aggregator's ``variables`` has to spell to
# reach it.
#
# Read off graphon's own ``NodeRunResult.outputs`` keys: an llm node's
# ``"text"`` (``nodes/llm/node.py:731``), a template-transform's ``"output"``
# (``template_transform_node.py:116``), a tool's ``"text"`` alongside ``files``
# and ``json`` (``tool_node.py:301-304``), a question-classifier's
# ``"class_name"`` (``question_classifier_node.py:437``). A code node is
# deliberately absent: its names are whatever its own ``outputs`` declares, so
# ``output_variable_of`` reads them off the node instead of guessing.
#
# Stated once here because two things need the same answer and a DISAGREEMENT
# between them is the failure being guarded against: Edit's rejoin clause tells
# the model which name to write, and ``preflight.vet_intents``'s rejoin guard
# names the selector a new branch is missing from. graphon's
# ``VariableAggregatorNode._run`` (``variable_aggregator_node.py:29-50``) skips
# a selector the run cannot resolve IN SILENCE, so a wrong name -- ``["llm",
# "output"]`` for a node that publishes ``text`` -- leaves the workflow running
# green and producing nothing.
OUTPUT_VARIABLE_BY_NODE_TYPE: Mapping[str, str] = {
    "llm": "text",
    "template-transform": "output",
    "tool": "text",
    "question-classifier": "class_name",
}

# EVERY variable name a selector rooted at a node of this type may legitimately
# name -- the set to ACCEPT, where ``OUTPUT_VARIABLE_BY_NODE_TYPE`` above is the
# single name to SUGGEST. Read off the same ``NodeRunResult.outputs`` literals:
#
# * llm (``nodes/llm/node.py::_build_run_outputs``) -- ``text``,
#   ``reasoning_content``, ``usage``, ``finish_reason``, plus
#   ``structured_output`` and ``files`` when the node is configured for them.
#   The two conditional keys are included because a SUPERSET can only ever
#   accept, never refuse something valid;
# * template-transform (``template_transform_node.py:116``) -- ``output``, and
#   that is the whole dict;
# * question-classifier (``question_classifier_node.py:436-441``) --
#   ``class_name``, ``class_label``, ``class_id``, ``usage``.
#
# A type is absent from this table when its published set is NOT KNOWABLE, and
# absence means ACCEPT ANYTHING. ``tool`` is the deliberate example: its outputs
# are ``text``/``files``/``json`` plus ``**state.variables``, which the tool
# decides at run time (``tool_node.py:300-305``), so no closed set exists.
# Guessing one would refuse a correct selector, which is worse than missing a
# wrong one.
PUBLISHED_VARIABLES_BY_NODE_TYPE: Mapping[str, frozenset[str]] = {
    "llm": frozenset({"text", "reasoning_content", "usage", "finish_reason", "structured_output", "files"}),
    "template-transform": frozenset({"output"}),
    "question-classifier": frozenset({"class_name", "class_label", "class_id", "usage"}),
}

# Stands in for a name this module cannot know. Angle-bracketed so a model
# copying it back writes something obviously wrong rather than a plausible
# field name that would resolve to nothing.
UNKNOWN_OUTPUT_VARIABLE = "<that node's own output variable>"


def published_variables_of(node: Mapping[str, Any]) -> frozenset[str] | None:
    """Every variable name a selector rooted at ``node`` may name, or ``None``
    when this module cannot know -- and ``None`` means "accept anything".

    Three answers, in order: a registered type answers from
    ``PUBLISHED_VARIABLES_BY_NODE_TYPE``; a node whose own data DECLARES its
    outputs as a mapping (a code node, a loop) answers from those keys, which is
    where the truth is for it; anything else answers ``None``.

    A declared-but-EMPTY ``outputs`` answers ``None`` too, not the empty set. A
    code node created without its outputs configured declares nothing rather
    than declaring that nothing is published, and an empty set would refuse
    every selector naming it -- a guard turning an unconfigured node into a
    blocked edit, which is the failure mode this function exists to avoid.
    """
    data = node.get("data")
    if not isinstance(data, Mapping):
        return None
    known = PUBLISHED_VARIABLES_BY_NODE_TYPE.get(str(data.get("type") or ""))
    if known is not None:
        return known
    outputs = data.get("outputs")
    if isinstance(outputs, Mapping) and outputs:
        return frozenset(str(key) for key in outputs)
    return None


def output_variable_of(node: Mapping[str, Any]) -> str:
    """The variable name a selector rooted at ``node`` has to use.

    A registered type answers from ``OUTPUT_VARIABLE_BY_NODE_TYPE``. A code
    node -- and anything else whose node data declares its own outputs -- is
    read off the node, because that is where the truth is. Anything left
    answers ``UNKNOWN_OUTPUT_VARIABLE``: a rejection that admits it does not
    know the name is still actionable, and a guessed one is the exact silent
    failure this knowledge exists to prevent.
    """
    data = node.get("data")
    if not isinstance(data, Mapping):
        return UNKNOWN_OUTPUT_VARIABLE
    known = OUTPUT_VARIABLE_BY_NODE_TYPE.get(str(data.get("type") or ""))
    if known:
        return known
    outputs = data.get("outputs")
    if isinstance(outputs, Mapping) and outputs:
        return str(next(iter(outputs)))
    return UNKNOWN_OUTPUT_VARIABLE


# How many characters of ONE node's JSON config either prompt will spend:
# enough for a realistic if-else ``cases`` array or an LLM prompt template,
# small enough that Edit's target plus its neighbours still leave room for the
# rules below.
NODE_CONFIG_LIMIT = 1500

# Whole keys are dropped to fit the budget and then NAMED, rather than cutting
# the JSON mid-string. A purpose field that happened to serialize last would
# otherwise disappear without a trace, and the model would fill the gap from
# imagination -- the exact failure this rendering exists to stop.
TRUNCATION_MARKER = "… omitted for length: "


def _dumps(config: Mapping[str, Any]) -> str:
    try:
        return json.dumps(config, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return str(config)


def config_block(config: Mapping[str, Any]) -> str:
    """One node's config as JSON, shedding WHOLE keys to fit the budget and
    naming the ones it shed.

    This is the half of ``OP_LIST`` that cannot be prose. The schema tells the
    model to re-send an array's existing elements "byte-identical -- ... as
    GRAPH shows them", which is only honest if what GRAPH showed is whole: a
    ``cases`` array cut mid-value would be copied back completed from
    imagination, and the model would be obeying the instruction while
    destroying the case it could not see. So an over-budget config loses its
    last key entirely and says which one, and everything still rendered is
    exactly what the draft holds.

    Callers redact first (``credentials.redact_node_config``); this only
    renders.
    """
    text = _dumps(config)
    if len(text) <= NODE_CONFIG_LIMIT:
        return text
    kept = dict(config)
    dropped: list[str] = []
    while kept and len(_dumps(kept)) > NODE_CONFIG_LIMIT:
        key = next(reversed(kept))
        del kept[key]
        dropped.insert(0, key)
    return _dumps(kept) + TRUNCATION_MARKER + ", ".join(dropped)


# The five verbs ``graph_ops.APPLY_FNS`` accepts, with the two rules whose
# violation the port refuses outright: address ONE array element by index
# instead of re-sending the array, and carry the handle a branch connect needs.
OP_LIST = (
    'Allowed ops (each as {"op": ..., "args": {...}}):\n'
    "- set_node_config: {node_id, path, value}\n"
    "  path is dot-separated and walks into that node's data; an all-digit segment indexes an "
    "array, so cases.1.conditions.0.value addresses one condition of one case.\n"
    "  To CHANGE one element of an array, address that element BY INDEX and leave its siblings "
    "untouched. Do not re-send the array to change one element: every key you do not repeat -- id, "
    "case_id, varType -- is lost, and a value you retype in a different shape (90 instead of "
    '"90") is a second change nobody asked for.\n'
    "  To ADD an element, there is no index to write to: an index past the end of the array is "
    "rejected. Set path to the WHOLE array and send every existing element back byte-identical -- "
    "same keys, same ids, same operators, same value spellings as GRAPH shows them -- with the new "
    "element appended. Adding a branch to an if-else is exactly this: repeat every existing case "
    "unchanged and append the new one.\n"
    "- create_node: {node_type, config, node_id?}\n"
    "- delete_node: {node_id}\n"
    "- connect: {from_node, to_node, source_handle?}\n"
    "  When from_node is an if-else, question-classifier or human-input node (or a node with "
    "error_strategy fail-branch), source_handle is required and must be one of the handles "
    "listed for that node in GRAPH.\n"
    "- insert_between: {edge: {source, target}, node_type, config}\n"
)

# graphon's own comparison literals, in graphon's own order
# (``utils/condition/entities.py``'s ``SupportedComparisonOperator``). Spelled
# out rather than joined from the engine at import time so this module keeps no
# runtime dependency on graphon's internals; a test asserts the two stay equal.
COMPARISON_OPERATORS = (
    "for strings and arrays: contains, not contains, start with, end with, is, is not, empty, "
    "not empty, in, not in, all of; for numbers: =, ≠, >, <, ≥, ≤, null, not null; for files: "
    "exists, not exists"
)

CONDITION_OPERATOR_RULES = (
    "A condition's comparison_operator must be one of the engine's literals -- "
    + COMPARISON_OPERATORS
    + ". The comparison forms are the unicode characters ≥ ≤ ≠, never the ASCII >= <= != <> == and "
    "never a word form like gte or equals. Write ≠ rather than != or <>, and = rather than ==: an "
    "equality form cannot be guessed back, because a string compares with is / is not and a number "
    "with = / ≠, so those forms are refused outright and the whole batch is lost with them.\n"
)

# Both agents inline a node's config with its secrets replaced by the sentinel
# (``credentials.redact_node_config``), and ``graph_ops.validate_intent_args``
# refuses any intent that hands it back -- a refusal that costs the one
# corrective re-prompt, so it is worth a line of prompt to avoid.
REDACTION_RULE = (
    f"A value shown as {credentials.REDACTED} is a secret withheld from you. Never hand it back: "
    "leave that field out of your change entirely.\n"
)
