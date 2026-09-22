"""Real LLM cognition for Dify Builder's Build mode (light methods).

Pure functions called by ``LlmBuilderAgent`` for Build cognition.
Each degrades to an honest result on model-None / provider-error / parse-fail
rather than crashing the advance. build_nodes lives in the same module
(added in Task A6)."""

import json
import logging
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any

from core.app.app_config.entities import ModelConfig
from core.dify_builder.contract import ResourceOption
from core.dify_builder.models import BuildNodesResult, MutationIntent
from graphon.enums import BUILT_IN_NODE_TYPES
from services.dify_builder import graph_ops
from services.dify_builder.agent import form_schema, graph_translate, llm, resources
from services.dify_builder.agent.model_resolver import resolve_model_instance
from services.workflow_generator_service import WorkflowGeneratorService

logger = logging.getLogger(__name__)

# A reply longer than this is prose, not a title. Well above
# ``naming.MAX_NAME_LENGTH`` so a good-but-long title is trimmed downstream
# rather than rejected here.
_MAX_PROPOSED_NAME_CHARS = 80


def analyze_goal(
    model,
    goal_text: str,
    on_reasoning: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    if model is None:
        return _degraded_form(goal_text)
    system = (
        "You are a Dify workflow requirements analyst. Given a build goal, propose 3-6 "
        "clarifying requirement fields SHAPED BY THE GOAL, and a sensible default value per "
        f"field. {form_schema.FORM_FIELD_TYPE_GUIDANCE}"
        'Reply with ONLY JSON: {"fields": [{"key": "...", "label": "...", "type": "...", '
        '"options": ["..."]}], "values": {"<key>": <default>}}.'
    ) + llm.json_language_instruction("field labels and values")
    try:
        data = llm.invoke_json(model, system=system, user=f"GOAL:\n{goal_text}", on_reasoning=on_reasoning)
    except Exception:
        return _degraded_form(goal_text)
    fields = data.get("fields")
    values = data.get("values")
    if not isinstance(fields, list) or not isinstance(values, dict):
        return _degraded_form(goal_text)
    return {"fields": form_schema.reconcile_form_fields(fields, values), "values": values}


def propose_app_name(
    model,
    goal_text: str,
    requirements: dict[str, Any],
    on_reasoning: Callable[[str], None] | None = None,
) -> str:
    """Name the app the way a person would title it (spec N1).

    Returns "" whenever it cannot beat the name already cut from the prompt --
    no model, a failed call, or a sentence instead of a title. The caller then
    keeps the derived name, so this never has to be right, only safe.
    """
    if model is None:
        return ""
    system = (
        "You name Dify apps. Given the goal the user typed, reply with a short title for "
        "the app -- a noun phrase naming what it does, at most 5 words, no trailing "
        "punctuation, no quotes, not a sentence and not an instruction. "
        "Write it in the same language the user wrote the goal in. "
        "Reply with ONLY the title."
    )
    user = f"GOAL:\n{goal_text}"
    if requirements:
        user += f"\n\nREQUIREMENTS:\n{json.dumps(requirements, ensure_ascii=False)[:1000]}"
    try:
        raw = llm.invoke_text(model, system=system, user=user, on_reasoning=on_reasoning).strip()
    except Exception:
        logger.warning("dify_builder: app-name proposal failed; keeping the derived name", exc_info=True)
        return ""
    # A sentence ("Sure! Here is a good name for...") is worse than the
    # mechanical cut, so accept only a title-shaped reply.
    first_line = raw.splitlines()[0].strip() if raw else ""
    if not first_line or len(first_line) > _MAX_PROPOSED_NAME_CHARS:
        return ""
    return first_line


def _degraded_form(goal_text: str) -> dict[str, Any]:
    return {
        "fields": [{"key": "goal", "label": "Goal", "type": "textarea", "options": []}],
        "values": {"goal": goal_text},
    }


# The node types a plan step may map to. This exists because the Builder's own
# planner previously had NO node vocabulary (ESQ1-279): it planned in business
# language ("Send a Feishu notification"), and the generator -- whose system
# prompt DOES carry a node whitelist -- was then handed steps it could not map
# onto any real node, failing only after the user had approved the plan.
#
# Deliberately Builder-only. The generator's own whitelist lives in the SHARED
# core/workflow/generator/prompts/planner_prompts.py, which cmd+K also uses and
# which this package must not touch. Keep the two conceptually aligned, but do
# not try to import across that boundary.
_DIFY_NODE_VOCABULARY = """\
- "start"               — workflow entry. Always present. Holds the input form variables.
- "end"                 — workflow exit. Returns the result.
- "llm"                 — call an LLM with a prompt.
- "knowledge-retrieval" — query a Dify knowledge base.
- "code"                — run a Python/JavaScript snippet.
- "template-transform"  — Jinja2 string templating.
- "http-request"        — call an external HTTP API.
- "tool"                — call a Dify built-in or installed plugin tool (web search, Slack, JSON, …).
- "if-else"             — branch on a condition.
- "iteration"           — run a sub-pipeline over every item of a list.
- "loop"                — repeat a sub-pipeline until an exit condition holds.
- "question-classifier" — route to a labelled branch by free-text intent.
- "parameter-extractor" — pull structured fields out of free text with an LLM.
- "document-extractor"  — extract text from an uploaded file. Needs a file input.
- "variable-aggregator" — rejoin mutually-exclusive branches into one variable.
- "list-operator"       — filter / sort / slice an array variable.
- "assigner"            — update an existing conversation or loop variable.
- "human-input"         — pause for a person to review, approve, or enter data."""


def propose_plan_v1(
    model,
    requirements: dict[str, Any],
    on_reasoning: Callable[[str], None] | None = None,
) -> list[str]:
    if model is None:
        return _degraded_plan()
    system = (
        "You are a Dify workflow planner. Given requirements, propose an ordered list of "
        "concise build steps.\n\n"
        "Every step MUST be implementable by exactly one of these Dify node types, and you "
        "may plan ONLY in these terms:\n\n"
        f"{_DIFY_NODE_VOCABULARY}\n\n"
        "Write each step as the work that node does, naming the node type. Good: "
        '"llm node drafts a reply from the ticket text". Bad: "Notify the team on Feishu" '
        "-- that names a product, not a node.\n\n"
        "Dify has no scheduler, database, email or messaging node. A step that needs one of "
        "those is either a `tool` node (when an installed plugin provides it), an "
        "`http-request` node, or outside the workflow entirely -- say so in the step rather "
        "than inventing a node.\n\n"
        'Reply with ONLY JSON: {"plan": ["step", ...]}.'
    ) + llm.json_language_instruction("plan steps")
    try:
        data = llm.invoke_json(
            model,
            system=system,
            user=f"REQUIREMENTS:\n{requirements}",
            on_reasoning=on_reasoning,
        )
    except Exception:
        return _degraded_plan()
    plan = data.get("plan")
    return [str(p) for p in plan] if isinstance(plan, list) and plan else _degraded_plan()


def _degraded_plan() -> list[str]:
    return ["Ingest the input", "Process with an LLM", "Emit the result"]


def discover_resources(
    model,
    tenant_id: str,
    plan_items: list[str],
    on_reasoning: Callable[[str], None] | None = None,
) -> list[ResourceOption]:
    inv = resources.list_tenant_resources(tenant_id)
    catalog = {r.id: ("knowledge", r) for r in inv.datasets}
    catalog.update({r.id: ("plugin", r) for r in inv.tools})
    catalog.update({r.id: ("model", r) for r in inv.models})
    if not catalog or model is None:
        return []
    system = (
        "You are a Dify workflow resource recommender. From the AVAILABLE resources, pick the "
        "ids relevant to the plan. Each is listed with its readiness: 'ready' or 'missing_config' "
        "(installed but not authorized for this workspace, so it cannot actually be used) -- never "
        "recommend a missing_config resource. Use ONLY listed ids. Reply with ONLY JSON: "
        '{"resource_ids": ["<id>", ...]}.'
    )
    listing = "\n".join(f"- {rid} ({kind}, {ref.readiness}): {ref.label}" for rid, (kind, ref) in catalog.items())
    user = f"PLAN:\n{chr(10).join(plan_items)}\n\nAVAILABLE:\n{listing}"
    try:
        data = llm.invoke_json(model, system=system, user=user, on_reasoning=on_reasoning)
        chosen_ids = [rid for rid in (data.get("resource_ids") or []) if rid in catalog]
    except Exception:
        logger.warning("dify_builder: resource recommendation failed; recommending none", exc_info=True)
        chosen_ids = []
    # Recommending nothing is the honest answer when there is no signal -- no
    # model, a failed call, or a model that picked none. The old code fell back
    # to the whole tenant inventory, and because the client pre-checks every
    # recommendation and submits them by default, that silently bound dozens of
    # unrelated resources and appended their names to the plan fed to the
    # generator. The caller states the situation instead.
    return [
        ResourceOption(
            id=rid,
            label=catalog[rid][1].label,
            meta=catalog[rid][1].meta,
            kind=catalog[rid][0],
            readiness=catalog[rid][1].readiness,
        )
        for rid in chosen_ids
    ]


_GAP_SYSTEM = (
    "You check whether a workflow plan can be built from the resources listed. Each resource is "
    "shown with its readiness: 'ready' or 'missing_config' -- installed but not authorized for "
    "this workspace, so it is not usable; treat a missing_config resource as unavailable, the "
    "same as if it were not listed at all. "
    "Name in ONE plain sentence any step no listed resource can perform, and say what "
    "capability is missing -- never which product to install. Reply with ONLY JSON: "
    '{"gap": "<sentence, or empty string when the plan is covered>"}.'
)


def assess_capability_gap(model, plan_items: list[str], options: list[ResourceOption]) -> str:
    """One sentence naming what the workspace cannot do, or "".

    Grounded only in what is installed -- there is no marketplace lookup, so
    this says a capability is missing, never which plugin would supply it. A
    ``missing_config`` tool (installed but unauthorized) cannot actually cover
    a step, so it counts against the plan the same as if it weren't there at
    all -- the readiness the model is shown reflects that. A model we cannot
    reach reports no gap: inventing one would block a build that might be
    fine.
    """
    if model is None or not plan_items:
        return ""
    listing = "\n".join(f"- {o.label} ({o.kind}, {o.readiness})" for o in options) or "- (none)"
    try:
        data = llm.invoke_json(
            model,
            system=_GAP_SYSTEM + llm.json_language_instruction("the gap sentence"),
            user=f"PLAN:\n{chr(10).join(plan_items)}\n\nAVAILABLE:\n{listing}",
        )
    except Exception:
        logger.warning("dify_builder: capability-gap assessment failed", exc_info=True)
        return ""
    gap = data.get("gap")
    return str(gap).strip() if isinstance(gap, str) else ""


def bind_resources(model, tenant_id: str, plan_items: list[str], resource_ids: list[str]) -> list[str]:
    inv = resources.list_tenant_resources(tenant_id)
    by_id = {r.id: r for r in (*inv.datasets, *inv.tools, *inv.models)}
    labels = [by_id[rid].label for rid in resource_ids if rid in by_id]
    if not labels:
        return list(plan_items)
    suffix = f" (using {', '.join(labels)})"
    # Deterministic, clean binding: name the resources on the retrieval/process step.
    bound = list(plan_items)
    if bound:
        bound[-1] = bound[-1] + suffix if suffix not in bound[-1] else bound[-1]
    else:
        bound = [f"Use {', '.join(labels)}"]
    return bound


def learn_from_build(
    model,
    goal_text: str,
    requirements: dict[str, Any],
    plan_items: list[str],
    built_node_ids: list[str],
    on_reasoning: Callable[[str], None] | None = None,
) -> str:
    fallback = f"Reusable skill: a {len(built_node_ids)}-node workflow for: {goal_text[:80]}"
    if model is None:
        return fallback
    system = "Summarize this built workflow as a one-line reusable skill descriptor. Reply with plain text."
    try:
        return (
            llm.invoke_text(
                model,
                system=system,
                user=f"GOAL: {goal_text}\nPLAN: {plan_items}",
                on_reasoning=on_reasoning,
            )
            or fallback
        )
    except Exception:
        return fallback


_ALLOWED_NODE_TYPES: set[str] = set(BUILT_IN_NODE_TYPES)


def _generator_model_config(tenant_id: str, model_config: dict[str, Any]) -> ModelConfig:
    if model_config:
        return ModelConfig.model_validate(
            {
                "provider": model_config.get("provider", ""),
                "name": model_config.get("name", ""),
                "mode": model_config.get("mode", "chat"),
                "completion_params": model_config.get("completion_params", {}),
            }
        )
    inst = resolve_model_instance(tenant_id, None)  # tenant default; read real provider/name off it
    return ModelConfig.model_validate(
        {
            "provider": inst.provider,
            "name": inst.model_name,
            "mode": "chat",
            "completion_params": {},
        }
    )


def _selected_workflow_model(tenant_id: str, resource_ids: Sequence[str]) -> ModelConfig | None:
    """The user-selected MODEL resource (from the resource-confirmation step) as a
    ModelConfig to ground the built workflow's node model blocks, or None when the
    user selected no model.

    A model resource id is ``{provider}/{name}`` (see ``resources._list_models``),
    so split on the last '/'. Only ids that are actually model resources qualify --
    a selected dataset/tool must never ground a node's model. This is deliberately
    separate from the Builder's session/cognition model: the workflow runs on the
    model the user picked, not on whatever model drives the Builder itself.
    """
    if not resource_ids:
        return None
    model_ids = {m.id for m in resources.list_tenant_resources(tenant_id).models}
    selected = next((rid for rid in resource_ids if rid in model_ids), None)
    if selected is None:
        return None
    provider, _, name = selected.rpartition("/")
    if not provider or not name:
        return None
    return ModelConfig.model_validate({"provider": provider, "name": name, "mode": "chat", "completion_params": {}})


# Prepended to the generator instruction so the LLM emits a WORKFLOW-shaped graph
# (start + end node) even when the plan reads like a chatbot. Without this the model
# often produces a chatflow graph (answer node / no end node) that the generator
# rejects as MISSING_TERMINAL -- and the generator does NOT retry that class of
# failure -- so the build silently yields no nodes.
_WORKFLOW_TOPOLOGY_DIRECTIVE = (
    "Build a Dify WORKFLOW graph (this is NOT a chat app): it MUST begin with exactly one "
    "'start' node and terminate in at least one 'end' node that returns the result. Do NOT use "
    "'answer' nodes -- those exist only in chat / advanced-chat apps and are invalid in a workflow."
    "\n\n"
    # Node-usage guidance (meeting item 9). Builder-only: this string is
    # prepended to the instruction at build.py:377 and cmd+K never sees it.
    # Only rules that earned their place by breaking a real build belong here --
    # every line costs planner output budget, which ESQ1-300 implicates.
    "Node usage rules:\n"
    "- A node may only reference variables its upstream node actually declares. A 'tool' node "
    "exposes 'text', 'files' and 'json' (plus whatever its provider declares) -- it does NOT "
    "expose 'result'. A 'code' node exposes exactly the keys in its own outputs map.\n"
    "- 'document-extractor' requires a 'file' or 'file-list' input variable on the start node; "
    "feed its 'text' output into the node that consumes it.\n"
    "- Children of an 'iteration' or 'loop' belong INSIDE the container via their parent "
    "reference. Do not wire a container's body as sibling top-level nodes.\n"
    "- Compare like with like in 'if-else': a numeric variable needs a numeric operator, a "
    "string variable a string operator.\n"
    "- Prefer a 'tool' node whenever an installed tool covers the step (the installed tools are "
    "listed for you). 'http-request' is only for an endpoint the user actually supplied: never "
    "invent one and never use a placeholder such as example.com -- when no real URL is known, read "
    "it from a start-node variable. Expose an http-request's changing inputs as start-node "
    "variables rather than hardcoding them."
)


def _terminal_retry_instruction(base_instruction: str, error: str) -> str:
    """Corrective instruction for the single retry after a topology-validation
    failure -- feed the specific generator error back with an explicit fix."""
    return (
        f"Your previous attempt was rejected: {error}. Regenerate the COMPLETE workflow graph "
        "with exactly one 'start' node and at least one 'end' node wired from the final step. "
        f"Do NOT use 'answer' nodes.\n\n{base_instruction}"
    )


def _generation_error_text(result: dict[str, Any]) -> str:
    """Best human-readable failure reason from a generator result -- the top-level
    ``error`` (e.g. "UNRESOLVED_REFERENCE: Reference {#node4.x#} not declared"), else
    the joined ``errors`` details, else a generic fallback. Surfaced to the user so
    a failed build shows WHY, not a hardcoded 'couldn't build' message."""
    err = result.get("error")
    if isinstance(err, str) and err.strip():
        return err.strip()
    errors = result.get("errors")
    if isinstance(errors, list) and errors:
        parts = [
            str(e.get("detail") or e.get("message") or e.get("code"))
            for e in errors
            if isinstance(e, dict) and (e.get("detail") or e.get("message") or e.get("code"))
        ]
        if parts:
            return "; ".join(parts)
    return "the generator returned no usable graph"


def _diagnostic(**fields: Any) -> dict[str, Any]:
    """One debug-log breadcrumb, stamped with the server's UTC time.

    ``at`` is the correlation key: pod logs are lost on restart, but the exported
    debug log keeps this timestamp so the surviving log window can be searched
    around it (and matched to the same failure the server logged).
    """
    return {"at": datetime.now(UTC).isoformat(), **fields}


def _generation_diagnostic(result: dict[str, Any], *, attempt: int) -> dict[str, Any]:
    """Capture one failed generation attempt: the generator's structured errors
    (``code`` / ``detail`` / ``node_id`` -- e.g. UNRESOLVED_REFERENCE on node2),
    which is strictly more than the server-side log line carries."""
    errors = result.get("errors")
    errors = [e for e in errors if isinstance(e, dict)] if isinstance(errors, list) else []
    return _diagnostic(
        source="workflow-generator",
        attempt=attempt,
        message=_generation_error_text(result),
        codes=[str(e.get("code")) for e in errors if e.get("code")],
        errors=errors,
    )


def build_nodes(
    tenant_id: str,
    model_config: dict[str, Any],
    plan_items: list[str],
    resource_ids: Sequence[str] = (),
) -> BuildNodesResult:
    try:
        mc = _generator_model_config(tenant_id, model_config)
        base_instruction = f"{_WORKFLOW_TOPOLOGY_DIRECTIVE}\n\n" + "\n".join(plan_items)

        def _generate(instruction: str) -> dict[str, Any]:
            return WorkflowGeneratorService.generate_workflow_graph(
                tenant_id=tenant_id,
                mode="workflow",
                instruction=instruction,
                model_config=mc,
                current_graph=None,
            )

        diagnostics: list[dict[str, Any]] = []
        result = _generate(base_instruction)
        graph = result.get("graph") or {}
        if result.get("error") or not graph.get("nodes"):
            diagnostics.append(_generation_diagnostic(result, attempt=1))
            # The generator's own retry only covers invalid-JSON / bad-schema, NOT a
            # structurally-valid graph that fails topology validation (e.g. no 'end'
            # node). Retry ONCE with the specific error fed back as a corrective nudge.
            retry_error = result.get("error") or "the generated graph had no nodes"
            result = _generate(_terminal_retry_instruction(base_instruction, retry_error))
            graph = result.get("graph") or {}
        if result.get("error") or not graph.get("nodes"):
            diagnostics.append(_generation_diagnostic(result, attempt=len(diagnostics) + 1))
            error = _generation_error_text(result)
            logger.warning(
                "Dify Builder: build_nodes produced no graph for tenant %s (%d plan items): error=%s",
                tenant_id,
                len(plan_items),
                error,
            )
            return BuildNodesResult(intents=[], error=error, diagnostics=diagnostics)
        intents = graph_translate.to_intents(graph)
        # Ground node model blocks to the user-SELECTED model (resource confirmation),
        # falling back to the generation/session model when none was selected. The
        # generator above still runs on ``mc`` (cognition); only the built workflow's
        # runtime model follows the user's choice.
        grounding_mc = _selected_workflow_model(tenant_id, resource_ids) or mc
        _ground(intents, grounding_mc, tenant_id, plan_items)
        applicable, rejected = graph_ops.filter_applicable({"nodes": [], "edges": []}, intents, _ALLOWED_NODE_TYPES)
        if not applicable:
            reason = rejected[0][1] if rejected else "no applicable node intents"
            error = f"the generated nodes were rejected by validation: {reason}"
            logger.warning("Dify Builder: build_nodes rejected all intents for tenant %s: %s", tenant_id, error)
            diagnostics.append(
                _diagnostic(
                    source="build_nodes",
                    message=error,
                    rejected=[{"reason": str(r), "intent": str(i.op)} for i, r in rejected],
                )
            )
            return BuildNodesResult(intents=[], error=error, diagnostics=diagnostics)
        if rejected:
            # A partial reject still builds what applies, but the dropped intents
            # must not vanish: e.g. a connect on a branch handle the node does not
            # declare (one postprocess could not re-home unambiguously) leaves that
            # arm unwired on the canvas.
            summary = [
                {
                    "intent": str(intent.op),
                    # a create_node's config is the whole node body -- name the node, not its body
                    "args": {key: value for key, value in intent.args.items() if key != "config"},
                    "reason": str(reason),
                }
                for intent, reason in rejected
            ]
            logger.warning(
                "Dify Builder: build_nodes dropped %d of %d intents for tenant %s: %s",
                len(rejected),
                len(intents),
                tenant_id,
                "; ".join(f"{item['intent']} {item['args']}: {item['reason']}" for item in summary),
            )
            diagnostics.append(
                _diagnostic(
                    source="build_nodes",
                    message=f"{len(rejected)} generated intent(s) were rejected by validation and not applied",
                    rejected=summary,
                )
            )
        # Retries that eventually succeeded still leave their breadcrumbs behind.
        return BuildNodesResult(intents=applicable, diagnostics=diagnostics)
    except Exception as exc:  # any generation/translation failure -> honest empty build
        logger.exception(
            "Dify Builder: build_nodes generation failed for tenant %s (%d plan items); returning empty build",
            tenant_id,
            len(plan_items),
        )
        # Surface the exception text (e.g. a provider error like credit_balance_exhausted)
        # so the user sees WHY, not a hardcoded 'couldn't build' message.
        message = str(exc).strip() or type(exc).__name__
        return BuildNodesResult(
            intents=[],
            error=message,
            diagnostics=[_diagnostic(source="build_nodes", message=message, exception=type(exc).__name__)],
        )


def _ground(intents: list[MutationIntent], mc: ModelConfig, tenant_id: str, plan_items: list[str]) -> None:
    mode = mc.mode.value if hasattr(mc.mode, "value") else str(mc.mode)
    datasets = resources.list_tenant_resources(tenant_id).datasets
    matched = [d.id for d in datasets if any(d.label in item for item in plan_items)]
    for intent in intents:
        if intent.op != "create_node":
            continue
        config = intent.args.get("config") or {}
        if isinstance(config.get("model"), dict):
            # Ground ONLY provider+name (the real, configured model); preserve whatever
            # mode/completion_params the generator produced -- never fabricate params.
            # Applies to ANY node type that carries a model block (llm,
            # question-classifier, parameter-extractor, ...), not just "llm" --
            # otherwise a drifted/hallucinated model on those node types flows
            # through ungrounded.
            model = dict(config["model"])
            model["provider"] = mc.provider
            model["name"] = mc.name
            model.setdefault("mode", mode)
            config["model"] = model
        if intent.args.get("node_type") == "knowledge-retrieval":
            config["dataset_ids"] = list(matched)  # independent copy per node -- never share one list
        intent.args["config"] = config
