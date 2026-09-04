"""Real LLM cognition for Dify Builder's Build mode (light methods).

Pure functions called by ``LlmBuilderAgent`` for Build cognition.
Each degrades to an honest result on model-None / provider-error / parse-fail
rather than crashing the advance. build_nodes lives in the same module
(added in Task A6)."""

import logging
from typing import Any

from core.app.app_config.entities import ModelConfig
from core.dify_builder.contract import ResourceOption
from core.dify_builder.models import MutationIntent
from graphon.enums import BUILT_IN_NODE_TYPES
from services.dify_builder import graph_ops
from services.dify_builder.agent import graph_translate, llm, resources
from services.dify_builder.agent.model_resolver import resolve_model_instance
from services.workflow_generator_service import WorkflowGeneratorService

logger = logging.getLogger(__name__)


def analyze_goal(model, goal_text: str) -> dict[str, Any]:
    if model is None:
        return _degraded_form(goal_text)
    system = (
        "You are a Dify workflow requirements analyst. Given a build goal, propose 3-6 "
        "clarifying requirement fields SHAPED BY THE GOAL, and a sensible default value per "
        'field. Reply with ONLY JSON: {"fields": [{"key": "...", "label": "...", '
        '"type": "text|textarea|select|bool", "options": ["..."]}], "values": {"<key>": <default>}}.'
    )
    try:
        data = llm.invoke_json(model, system=system, user=f"GOAL:\n{goal_text}")
    except Exception:
        return _degraded_form(goal_text)
    fields = data.get("fields")
    values = data.get("values")
    if not isinstance(fields, list) or not isinstance(values, dict):
        return _degraded_form(goal_text)
    return {"fields": fields, "values": values}


def _degraded_form(goal_text: str) -> dict[str, Any]:
    return {"fields": [{"key": "goal", "label": "Goal", "type": "textarea", "options": []}],
            "values": {"goal": goal_text}}


def propose_plan_v1(model, requirements: dict[str, Any]) -> list[str]:
    if model is None:
        return _degraded_plan()
    system = (
        "You are a Dify workflow planner. Given requirements, propose an ordered list of "
        'concise build steps. Reply with ONLY JSON: {"plan": ["step", ...]}.'
    )
    try:
        data = llm.invoke_json(model, system=system, user=f"REQUIREMENTS:\n{requirements}")
    except Exception:
        return _degraded_plan()
    plan = data.get("plan")
    return [str(p) for p in plan] if isinstance(plan, list) and plan else _degraded_plan()


def _degraded_plan() -> list[str]:
    return ["Ingest the input", "Process with an LLM", "Emit the result"]


def discover_resources(model, tenant_id: str, plan_items: list[str]) -> list[ResourceOption]:
    inv = resources.list_tenant_resources(tenant_id)
    catalog = {r.id: ("knowledge", r) for r in inv.datasets}
    catalog.update({r.id: ("plugin", r) for r in inv.tools})
    catalog.update({r.id: ("model", r) for r in inv.models})
    if not catalog:
        return []
    chosen_ids = list(catalog.keys())
    if model is not None:
        system = (
            "You are a Dify workflow resource recommender. From the AVAILABLE resources, pick the "
            "ids relevant to the plan. Use ONLY listed ids. Reply with ONLY JSON: "
            '{"resource_ids": ["<id>", ...]}.'
        )
        listing = "\n".join(f"- {rid} ({kind}): {ref.label}" for rid, (kind, ref) in catalog.items())
        user = f"PLAN:\n{chr(10).join(plan_items)}\n\nAVAILABLE:\n{listing}"
        try:
            data = llm.invoke_json(model, system=system, user=user)
            picked = [rid for rid in (data.get("resource_ids") or []) if rid in catalog]
            if picked:
                chosen_ids = picked
        except Exception:
            chosen_ids = list(catalog.keys())  # explicit reset: degrade to full inventory
    return [
        ResourceOption(id=rid, label=catalog[rid][1].label, meta=catalog[rid][1].meta,
                       kind=catalog[rid][0], readiness=catalog[rid][1].readiness)
        for rid in chosen_ids
    ]


def bind_resources(
    model, tenant_id: str, plan_items: list[str], resource_ids: list[str], conflict_policy: str
) -> list[str]:
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
    model, goal_text: str, requirements: dict[str, Any], plan_items: list[str],
    built_node_ids: list[str]
) -> str:
    fallback = f"Reusable skill: a {len(built_node_ids)}-node workflow for: {goal_text[:80]}"
    if model is None:
        return fallback
    system = "Summarize this built workflow as a one-line reusable skill descriptor. Reply with plain text."
    try:
        return llm.invoke_text(model, system=system, user=f"GOAL: {goal_text}\nPLAN: {plan_items}") or fallback
    except Exception:
        return fallback


_ALLOWED_NODE_TYPES: set[str] = set(BUILT_IN_NODE_TYPES)


def _generator_model_config(tenant_id: str, model_config: dict[str, Any]) -> ModelConfig:
    if model_config:
        return ModelConfig.model_validate({
            "provider": model_config.get("provider", ""),
            "name": model_config.get("name", ""),
            "mode": model_config.get("mode", "chat"),
            "completion_params": model_config.get("completion_params", {}),
        })
    inst = resolve_model_instance(tenant_id, None)  # tenant default; read real provider/name off it
    return ModelConfig.model_validate({
        "provider": inst.provider, "name": inst.model_name, "mode": "chat", "completion_params": {},
    })


# Prepended to the generator instruction so the LLM emits a WORKFLOW-shaped graph
# (start + end node) even when the plan reads like a chatbot. Without this the model
# often produces a chatflow graph (answer node / no end node) that the generator
# rejects as MISSING_TERMINAL -- and the generator does NOT retry that class of
# failure -- so the build silently yields no nodes.
_WORKFLOW_TOPOLOGY_DIRECTIVE = (
    "Build a Dify WORKFLOW graph (this is NOT a chat app): it MUST begin with exactly one "
    "'start' node and terminate in at least one 'end' node that returns the result. Do NOT use "
    "'answer' nodes -- those exist only in chat / advanced-chat apps and are invalid in a workflow."
)


def _terminal_retry_instruction(base_instruction: str, error: str) -> str:
    """Corrective instruction for the single retry after a topology-validation
    failure -- feed the specific generator error back with an explicit fix."""
    return (
        f"Your previous attempt was rejected: {error}. Regenerate the COMPLETE workflow graph "
        "with exactly one 'start' node and at least one 'end' node wired from the final step. "
        f"Do NOT use 'answer' nodes.\n\n{base_instruction}"
    )


def build_nodes(tenant_id: str, model_config: dict[str, Any], plan_items: list[str]) -> list[MutationIntent]:
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

        result = _generate(base_instruction)
        graph = result.get("graph") or {}
        if result.get("error") or not graph.get("nodes"):
            # The generator's own retry only covers invalid-JSON / bad-schema, NOT a
            # structurally-valid graph that fails topology validation (e.g. no 'end'
            # node). Retry ONCE with the specific error fed back as a corrective nudge.
            retry_error = result.get("error") or "the generated graph had no nodes"
            result = _generate(_terminal_retry_instruction(base_instruction, retry_error))
            graph = result.get("graph") or {}
        if result.get("error") or not graph.get("nodes"):
            logger.warning(
                "Dify Builder: build_nodes produced no graph for tenant %s (%d plan items): error=%s",
                tenant_id,
                len(plan_items),
                result.get("error"),
            )
            return []
        intents = graph_translate.to_intents(graph)
        _ground(intents, mc, tenant_id, plan_items)
        applicable, _rejected = graph_ops.filter_applicable({"nodes": [], "edges": []}, intents, _ALLOWED_NODE_TYPES)
        return applicable
    except Exception:  # any generation/translation failure -> honest empty build
        logger.exception(
            "Dify Builder: build_nodes generation failed for tenant %s (%d plan items); returning empty build",
            tenant_id,
            len(plan_items),
        )
        return []


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
