"""Real LLM cognition for Dify Builder's Edit mode.

Surgical config change on an existing graph. build_edit_intents follows the
Fix pattern: the LLM proposes targeted intents which are dry-run-validated
through preflight.vet_intents -- structure AND node data, the same two checks
apply_repair makes -- before they can reach the approval gate.
Degrades to an honest result on model-None / provider-error / parse-fail."""

from collections.abc import Callable, Sequence
from typing import Any

from core.dify_builder.models import MutationIntent
from core.dify_builder.node_defaults import default_config_or_empty
from core.workflow.graph_normalizers import declared_branch_handles
from graphon.enums import BUILT_IN_NODE_TYPES
from services.dify_builder import credentials, preflight
from services.dify_builder.agent import form_schema, graph_prompt, llm

_ALLOWED_NODE_TYPES: set[str] = set(BUILT_IN_NODE_TYPES)

# Keys the summary line above the block already carries; a config with nothing
# but these says nothing and is not worth a line.
_SUMMARY_LINE_KEYS = frozenset({"type", "title"})

# The one clause that is Edit's alone: a plan that grows a branch has to say
# where that branch rejoins. Fix repairs the single node it diagnosed and is
# deliberately not told to reach across the graph like this.
_REJOIN_RULE = (
    "Follow a new branch to where it rejoins the graph. If the node on the new branch feeds an "
    "existing variable-aggregator, that aggregator's variables array does not list it yet -- also "
    "append that node's selector to it, re-sending the existing selectors byte-identical. The "
    'selector is ["<new node id>", "<that node\'s own output variable>"], and the variable name '
    "differs by node type: an llm's is text, a template-transform's is output, a tool's is "
    "text (or files / json), a code node's is whatever its own outputs declare, a "
    "question-classifier's is class_name. The selectors already in that aggregator's variables "
    "show you the spelling a node of the same type uses -- copy it. A selector the run cannot "
    "resolve is skipped in silence, so the wrong variable name leaves the workflow running green "
    "and producing nothing, which is the very failure this step exists to prevent.\n"
)

# The ops, the branch-handle rule, the operator literals and the redaction
# sentinel are Fix's too, and are stated once in ``graph_prompt`` for both.
_OP_SCHEMA = graph_prompt.OP_LIST + graph_prompt.CONDITION_OPERATOR_RULES + _REJOIN_RULE + graph_prompt.REDACTION_RULE


def _node_ids(graph: dict) -> set[str]:
    return {str(n.get("id")) for n in graph.get("nodes", []) if n.get("id") is not None}


def _authored_config(node: dict) -> dict[str, Any]:
    """The node's ``data`` minus every key still sitting at its type default.

    ``node_defaults`` is the single source of what "default" means here, so
    this drops exactly the keys ``graph_ops._build_node`` would have supplied
    on its own -- an http-request node's two dozen method/auth/timeout/retry
    keys -- and keeps what an author actually chose. Without the subtraction
    the scaffolding crowds the field the edit is ABOUT out of the prompt.
    """
    data = node.get("data")
    if not isinstance(data, dict):
        return {}
    defaults = default_config_or_empty(str(data.get("type", "")))
    return {k: v for k, v in data.items() if k not in defaults or defaults[k] != v}


def _config_block(node: dict) -> str:
    """One node's authored config as ``graph_prompt.config_block`` renders it:
    JSON, secrets withheld, over-budget keys dropped BY NAME.

    The rendering is shared with ``fix._culprit_config``. What is Edit's alone
    is what goes into it: the type defaults are subtracted first, and that
    subtraction is exactly what un-hides a secret -- a live token never equals
    the ``no-auth`` / ``""`` default -- so ``redact_node_config`` runs after it,
    over a target AND every neighbour rather than Fix's one culprit.

    Returns ``""`` when nothing survives that the summary line above does not
    already say.
    """
    config = credentials.redact_node_config(_authored_config(node))
    if not set(config) - _SUMMARY_LINE_KEYS:
        return ""
    return graph_prompt.config_block(config)


def _detailed_ids(graph: dict, target_node_ids: Sequence[str]) -> set[str]:
    """Which nodes get their config inlined: the targets, their direct
    neighbours, and one hop further past a BRANCH target's successors.

    Neighbours are in because an edit to one node is usually only half the
    change. The extra hop is in because a branch's arms reconverge: in the
    live F4 failure the if-else target fed two template-transforms that fed a
    variable-aggregator, whose ``variables`` is what says whether the new arm
    reaches the End node at all. At one hop that aggregator rendered as a bare
    one-liner and the model could not extend it -- triage cause (d), the one
    that ends in "All checks passed" on empty output. The extra hop is taken
    ONLY past a branch node, so a long linear chain does not drag the whole
    graph into the prompt.
    """
    targets = {str(t) for t in target_node_ids}
    if not targets:
        return set()
    nodes_by_id = {str(n.get("id")): n for n in graph.get("nodes", []) if n.get("id") is not None}
    successors: dict[str, set[str]] = {}
    neighbours: dict[str, set[str]] = {}
    for e in graph.get("edges", []):
        source, target = str(e.get("source")), str(e.get("target"))
        successors.setdefault(source, set()).add(target)
        neighbours.setdefault(source, set()).add(target)
        neighbours.setdefault(target, set()).add(source)

    detailed = set(targets)
    for node_id in targets:
        detailed |= neighbours.get(node_id, set())
        if not declared_branch_handles(nodes_by_id.get(node_id) or {}):
            continue
        for successor in successors.get(node_id, set()):
            detailed |= successors.get(successor, set())
    return detailed


def _graph_context(graph: dict, target_node_ids: Sequence[str] = ()) -> str:
    detailed = _detailed_ids(graph, target_node_ids)
    node_lines: list[str] = []
    rendered_any_config = False
    for n in graph.get("nodes", []):
        node_lines.append(graph_prompt.node_line(n))
        if str(n.get("id")) in detailed:
            block = _config_block(n)
            if block:
                node_lines.append(f"    config: {block}")
                rendered_any_config = True
    lines = ["NODES:"]
    if rendered_any_config:
        lines.append(
            "  (config = that node's CURRENT data; keys still at their type default are omitted. "
            f"A value shown as {credentials.REDACTED} is a secret withheld from you -- never write "
            "it back; leave that field alone.)"
        )
    lines.extend(node_lines)
    lines.append("EDGES:")
    lines.extend(graph_prompt.edge_line(e) for e in graph.get("edges", []))
    return "\n".join(lines)


def _degraded_impact(goal_text: str) -> dict[str, Any]:
    return {
        "fields": [{"key": "change", "label": "Change", "type": "textarea", "options": []}],
        "values": {"change": goal_text},
        "target_node_ids": [],
    }


def analyze_impact(
    model,
    goal_text: str,
    graph: dict,
    on_reasoning: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    if model is None:
        return _degraded_impact(goal_text)
    system = (
        "You are a Dify workflow edit-impact analyst. Given an edit goal and the current graph, "
        "propose 2-5 goal-shaped edit-rule fields, sensible values, and which EXISTING node ids the "
        f"change touches. {form_schema.FORM_FIELD_TYPE_GUIDANCE}"
        'Reply with ONLY JSON: {"fields": [{"key","label","type","options"}], '
        '"values": {...}, "target_node_ids": ["<existing id>", ...]}.'
    ) + llm.json_language_instruction("field labels and values")
    try:
        data = llm.invoke_json(
            model,
            system=system,
            user=f"GOAL:\n{goal_text}\n\nGRAPH:\n{_graph_context(graph)}",
            on_reasoning=on_reasoning,
        )
    except Exception:
        return _degraded_impact(goal_text)
    ids = _node_ids(graph)
    raw_targets = data.get("target_node_ids")
    targets = [str(t) for t in raw_targets if str(t) in ids] if isinstance(raw_targets, list) else []
    fields = data.get("fields") if isinstance(data.get("fields"), list) else []
    values = data.get("values") if isinstance(data.get("values"), dict) else {}
    return {
        "fields": form_schema.reconcile_form_fields(fields, values),
        "values": values,
        "target_node_ids": targets,
    }


def propose_edit_plan(
    model,
    edit_rules: dict[str, Any],
    graph: dict,
    on_reasoning: Callable[[str], None] | None = None,
) -> list[str]:
    if model is None:
        return ["Apply the requested edit"]
    system = (
        'You are a Dify workflow edit planner. Reply with ONLY JSON: {"plan": ["step", ...]}.'
        + llm.json_language_instruction("plan steps")
    )
    try:
        data = llm.invoke_json(
            model,
            system=system,
            user=f"EDIT RULES:\n{edit_rules}\n\nGRAPH:\n{_graph_context(graph)}",
            on_reasoning=on_reasoning,
        )
    except Exception:
        return ["Apply the requested edit"]
    plan = data.get("plan")
    return [str(p) for p in plan] if isinstance(plan, list) and plan else ["Apply the requested edit"]


# Heads the verbatim engine refusal block appended to the user prompt. Kept a
# constant so a test can pin the exact framing the model is shown.
_REJECTION_HEADER = "PREVIOUS ATTEMPT REJECTED BY THE ENGINE:"


def build_edit_intents(
    model,
    edit_rules: dict[str, Any],
    graph: dict,
    on_reasoning: Callable[[str], None] | None = None,
    *,
    edit_target_node_ids: Sequence[str] = (),
    last_edit_rejection: str | None = None,
) -> list[MutationIntent]:
    """Propose the mutations that apply ``edit_rules`` to an existing graph.

    ``edit_target_node_ids`` are the nodes ``analyze_impact`` said the change
    touches; their config (and their neighbours') is inlined into the prompt so
    the model can rewrite the one field it was asked about and leave the rest
    byte-identical. An empty list is legal and simply yields today's
    title/type/handles-only context.

    ``last_edit_rejection`` is what the ENGINE said when it refused the
    previous attempt's write (``handlers_edit._change_not_applied``), quoted
    verbatim into the prompt. The gate re-reads an unchanged draft on every
    re-approval, so ``edit_rules`` and ``graph`` are byte-identical each time
    and this is the only input that can make a second attempt differ from the
    first. It is also finer-grained than the dry run's own key: the preflight
    is keyed on pydantic error LOCATIONS, so replacing one bad value with
    another bad value at the same path is not a new problem to it, while the
    engine's message names the value.
    """
    if model is None:
        return []
    system = (
        "You are a Dify workflow editor. Propose the minimal mutations that apply the edit rules to "
        "EXISTING nodes. Reference only node ids that exist and use only the listed node types. "
        'Reply with ONLY JSON: {"intents": [{"op": ..., "args": {...}}]}.\n'
        + _OP_SCHEMA
        + "Allowed node types: "
        + ", ".join(sorted(_ALLOWED_NODE_TYPES))
        + ".\n"
    )
    user = f"EDIT RULES:\n{edit_rules}\n\nGRAPH:\n{_graph_context(graph, edit_target_node_ids)}"
    if last_edit_rejection:
        user += f"\n\n{_REJECTION_HEADER}\n{last_edit_rejection}\nDo not repeat it."
    intents = _invoke_intents(model, system, user, on_reasoning)
    if intents is None:
        return []
    vetted = preflight.vet_intents(graph, intents, _ALLOWED_NODE_TYPES)
    # ANY rejection -- partial, total, or a node the engine would refuse to start
    # -- burns the one corrective re-prompt: a partial reject can silently drop
    # the one intent that mattered (e.g. a connect from a branch node missing its
    # required source_handle), so it is not safe to just keep what survived
    # without giving the model a chance to supply the rest; and a batch that
    # applies cleanly but leaves a node ``Graph.init`` refuses is worse than one
    # that does not apply -- it reaches the approval gate looking healthy and
    # dies at the write. If the retry itself yields nothing usable, fall back to
    # the first attempt's applicable intents rather than losing them.
    if vetted.rejections:
        first_applicable = vetted.applicable
        reasons = "\n".join(vetted.rejections)
        retry_user = f"{user}\n\nYour previous intents were invalid:\n{reasons}\nReturn corrected intents."
        intents = _invoke_intents(model, system, retry_user, on_reasoning)
        if intents is None:
            return first_applicable
        vetted = preflight.vet_intents(graph, intents, _ALLOWED_NODE_TYPES)
        if not vetted.applicable:
            return first_applicable
    return vetted.applicable


def _invoke_intents(
    model,
    system: str,
    user: str,
    on_reasoning: Callable[[str], None] | None,
) -> list[MutationIntent] | None:
    try:
        data = llm.invoke_json(model, system=system, user=user, on_reasoning=on_reasoning)
    except Exception:
        return None
    raw = data.get("intents")
    if not isinstance(raw, list):
        return None
    out: list[MutationIntent] = []
    for item in raw:
        if isinstance(item, dict) and isinstance(item.get("op"), str) and isinstance(item.get("args"), dict):
            out.append(MutationIntent(op=item["op"], args=item["args"]))
        else:
            return None
    return out
