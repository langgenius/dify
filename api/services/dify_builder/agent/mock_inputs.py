"""Real cognition for Dify Builder mock test inputs.

Given the start node's StartSchema, produce plausible run inputs keyed by each
declared variable. LLM-assisted, degrading to deterministic type-based defaults
on model-None / provider-error / parse-fail (never raises)."""

from collections.abc import Callable
from typing import Any

from core.dify_builder.models import Inputs, StartSchema
from services.dify_builder.agent import llm

_DEFAULT_BY_TYPE = {
    "number": 1,
    "float": 1.0,
    "checkbox": True,
    "boolean": True,
}


def _variables(schema: StartSchema) -> list[dict[str, Any]]:
    raw = schema.get("variables") if isinstance(schema, dict) else None
    return [v for v in raw if isinstance(v, dict) and v.get("variable")] if isinstance(raw, list) else []


def _default_value(var: dict[str, Any]) -> Any:
    vtype = str(var.get("type") or "")
    options = var.get("options")
    if isinstance(options, list) and options:
        return options[0]
    return _DEFAULT_BY_TYPE.get(vtype, "test")


def _deterministic(vars_: list[dict[str, Any]]) -> Inputs:
    return {str(v["variable"]): _default_value(v) for v in vars_}


def generate(
    model,
    schema: StartSchema,
    prior_failed: Inputs,
    on_reasoning: Callable[[str], None] | None = None,
) -> Inputs:
    vars_ = _variables(schema)
    if not vars_:
        return {}
    if model is None:
        return _deterministic(vars_)
    system = (
        "You generate plausible TEST inputs for a workflow's start form. Given the input "
        "variables, return realistic values keyed by each variable's name. Avoid any values "
        'listed as previously-failing. Reply with ONLY JSON: {"inputs": {"<variable>": <value>}}.'
    )
    listing = "\n".join(f"- {v['variable']} (type={v.get('type', '?')}) options={v.get('options')}" for v in vars_)
    user = f"VARIABLES:\n{listing}\n\nPREVIOUSLY-FAILING (avoid): {prior_failed}"
    try:
        data = llm.invoke_json(model, system=system, user=user, on_reasoning=on_reasoning)
        produced = data.get("inputs")
        if not isinstance(produced, dict):
            return _deterministic(vars_)
    except Exception:
        return _deterministic(vars_)
    # keep only declared variable keys; fill any the model omitted with a default
    result: Inputs = {}
    for v in vars_:
        name = str(v["variable"])
        result[name] = produced[name] if name in produced else _default_value(v)
    return result
