"""Real cognition for Dify Builder mock test inputs.

Given the start node's StartSchema, produce plausible run inputs keyed by each
declared variable. LLM-assisted, degrading to deterministic type-based defaults
on model-None / provider-error / parse-fail (never raises). Structured samples
use strict JSON decoding and at most two completions; nested JSON for text
fields is serialized here rather than escaped by the model."""

import json
from collections.abc import Callable
from typing import Any

from core.dify_builder.models import Inputs, StartSchema
from services.dify_builder import trace_diagnostics as diagnostics
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


def _reject_constant(value: str) -> Any:
    raise ValueError(f"Non-JSON constant: {value}")


def _generated_inputs(data: Any, vars_: list[dict[str, Any]]) -> Inputs:
    if not isinstance(data, dict) or not isinstance(data.get("inputs"), dict):
        raise ValueError("Expected an inputs object")
    produced = data["inputs"]
    text_names = {str(v["variable"]) for v in vars_ if v.get("type") in {"text-input", "paragraph"}}
    json_fields = data.get("json_text_fields", [])
    if (
        not isinstance(json_fields, list)
        or any(not isinstance(name, str) or name not in text_names or name not in produced for name in json_fields)
        or len(set(json_fields)) != len(json_fields)
    ):
        raise ValueError("json_text_fields must list distinct declared text fields present in inputs")
    for name in json_fields:
        value = produced[name]
        if isinstance(value, str):
            value = json.loads(value, parse_constant=_reject_constant)
        if not isinstance(value, dict | list):
            raise ValueError("JSON text samples must contain an object or array")
    # Legacy responses without metadata retain ordinary strings exactly. Never
    # guess content encoding from field names or the appearance of a string.
    result: Inputs = {}
    for v in vars_:
        name = str(v["variable"])
        value = produced[name] if name in produced else _default_value(v)
        if name in text_names and isinstance(value, dict | list):
            value = json.dumps(value, ensure_ascii=False, allow_nan=False)
        result[name] = value
    return result


def generate(
    model,
    schema: StartSchema,
    prior_failed: Inputs,
    on_reasoning: Callable[[str], None] | None = None,
    *,
    business_context: str = "",
) -> Inputs:
    vars_ = _variables(schema)
    if not vars_:
        return {}
    if model is None:
        return _deterministic(vars_)
    system = (
        "You generate plausible TEST inputs for a workflow's start form. Given the input "
        "variables and business context, return realistic values keyed by each variable's name. "
        "Follow the goal, confirmed requirements, approved plan and field hints when choosing "
        "sample shapes and values. For text-input/paragraph fields carrying JSON, return an actual JSON "
        "object or array as the field value, not an escaped JSON string; the application serializes it once. "
        "Include json_text_fields listing those declared text fields (an empty list for ordinary text). "
        "These samples are suggestions for user review, not proof of business acceptance. Avoid any values "
        "listed as previously-failing. Reply with ONLY strict JSON: "
        '{"inputs": {"<variable>": <value>}, "json_text_fields": ["<JSON text variable>"]}.'
    )
    listing = "\n".join(
        f"- {v['variable']} (type={v.get('type', '?')}) options={v.get('options')} "
        f"label={v.get('label')} hint={v.get('hint')} placeholder={v.get('placeholder')} required={v.get('required')}"
        for v in vars_
    )
    user = f"VARIABLES:\n{listing}\n\nPREVIOUSLY-FAILING (avoid): {prior_failed}"
    if business_context:
        user += f"\n\nBUSINESS CONTEXT:\n{business_context}"
    for attempt in (1, 2):
        try:
            text = llm.invoke_text(model, system=system, user=user, on_reasoning=on_reasoning)
        except Exception:
            diagnostics.report("deterministic_fallback", fallback_used=True)
            return _deterministic(vars_)
        try:
            data = json.loads(text, parse_constant=_reject_constant)
        except (ValueError, TypeError, RecursionError):
            diagnostics.report("json_decode_failed", attempt=attempt, fallback_used=attempt == 2)
        else:
            try:
                return _generated_inputs(data, vars_)
            except (ValueError, TypeError, RecursionError):
                diagnostics.report("response_schema_invalid", attempt=attempt, fallback_used=attempt == 2)
        if attempt == 1:
            user += (
                "\n\nThe previous sample was invalid. Return one strict JSON object with an inputs object. "
                "Use actual objects/arrays for JSON text fields and list only their declared text names "
                "in json_text_fields. Do not use NaN, Infinity, comments, fences or trailing content."
            )
    return _deterministic(vars_)
