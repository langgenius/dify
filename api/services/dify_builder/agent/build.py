"""Real LLM cognition for Dify Builder's Build mode (light methods).

Pure functions called by LlmBuilderAgent when DIFY_BUILDER_AGENT_MODE=llm.
Each degrades to an honest result on model-None / provider-error / parse-fail
rather than crashing the advance. build_nodes lives in the same module
(added in Task A6)."""

from typing import Any

from core.dify_builder.contract import ResourceOption
from services.dify_builder.agent import llm, resources


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
