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
