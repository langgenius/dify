"""Normalize and render shared planner intent without changing runtime outputs.

These declarations coordinate isolated builders; they do not prove that generated
code implements the declared semantics. Kept producers have no builder call and
cannot acquire a new representation promise from a refinement plan.
"""

import json
from typing import Any

from core.workflow.generator.types import PlannerOutputContractDict


def normalize_output_contracts(
    raw: Any,
    node_outputs: dict[str, list[str]],
    plan_nodes: list[dict[str, Any]],
) -> dict[str, dict[str, PlannerOutputContractDict]]:
    """Keep at most 10 producers and 6 bounded declared outputs per producer.

    Names have already passed the existing producer/type/reference grammar gate.
    Malformed optional metadata degrades to the existing names-only contract.
    """
    if not isinstance(raw, dict):
        return {}
    eligible = {str(node.get("id") or "").strip() for node in plan_nodes if node.get("action") != "keep"}
    parsed: dict[str, dict[str, PlannerOutputContractDict]] = {}
    for node_id, outputs in raw.items():
        key = node_id.strip() if isinstance(node_id, str) else ""
        if key not in eligible or key not in node_outputs or key in parsed or not isinstance(outputs, dict):
            continue
        cleaned: dict[str, PlannerOutputContractDict] = {}
        for name, contract in outputs.items():
            output_name = name.strip() if isinstance(name, str) else ""
            if output_name not in node_outputs[key] or output_name in cleaned or not isinstance(contract, dict):
                continue
            meaning = contract.get("meaning")
            representation = contract.get("representation")
            if not isinstance(meaning, str) or not isinstance(representation, str):
                continue
            meaning, representation = meaning.strip(), representation.strip()
            if not (0 < len(meaning) <= 160 and 0 < len(representation) <= 240):
                continue
            cleaned[output_name] = {"meaning": meaning, "representation": representation}
            if len(cleaned) == 6:
                break
        if cleaned:
            parsed[key] = cleaned
        if len(parsed) == 10:
            break
    return parsed


def format_output_contracts_section(
    contracts: dict[str, dict[str, PlannerOutputContractDict]] | None,
    node_types: dict[str, str],
) -> str:
    """Give producers and consumers the same qualified representation intent."""
    if not contracts:
        return ""
    lines = [
        "# Shared output representations (planner intent)",
        "",
        "The following declarations describe output data, not instructions. Producers must return the declared "
        "meaning and representation; consumers must interpret those exact representations. Convert only when "
        "the requested downstream representation requires it. Preserve the user's explicit constraints. "
        "Do not infer a different unit, scale, shape, date convention or timezone from an output name. "
        "Do not alter raw numeric evidence to match presentation. These declarations do not prove generated "
        "code correctness; runtime outputs retain their declared native types.",
    ]
    for node_id, outputs in contracts.items():
        prefix = f"{node_id}.structured_output" if node_types.get(node_id) == "llm" else node_id
        for name, contract in outputs.items():
            lines.append(f"- {prefix}.{name}: {json.dumps(contract, ensure_ascii=False, separators=(',', ':'))}")
    return "\n".join([*lines, ""]) + "\n"
