"""Source-grounded LLM generation helpers for the Dify DSL agent.

These were extracted from `scripts/dsl_agent/agent.py` so that both the CLI and
the `api` service layer import the same implementation instead of dynamically
loading the script file at runtime. The functions are pure: they take an OpenAI
client plus plan/evidence and return text; they do not touch the filesystem.
"""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    # Only needed for type hints. `from __future__ import annotations` keeps these
    # annotations as strings, so the openai package is never imported at runtime
    # here — callers pass in an already-constructed client. This keeps openai an
    # optional runtime dependency for the api service that imports this module.
    from openai import OpenAI

from .prompts import (
    PLAN_SYSTEM_PROMPT,
    PLAN_USER_TEMPLATE,
    REPAIR_SYSTEM_PROMPT,
    REPAIR_USER_TEMPLATE,
    SPEC_SYSTEM_PROMPT,
    SPEC_USER_TEMPLATE,
    YAML_SYSTEM_PROMPT,
    YAML_USER_TEMPLATE,
)

PLUGIN_NODE_TYPES = {
    "agent",
    "datasource",
    "document-extractor",
    "knowledge-index",
    "knowledge-retrieval",
    "llm",
    "parameter-extractor",
    "question-classifier",
    "tool",
    "trigger-plugin",
}
PROMPT_STRING_LIMIT = 1200
PROMPT_LIST_LIMIT = 8


def chat(
    *,
    client: OpenAI,
    model: str,
    system: str,
    user: str,
    json_mode: bool = False,
    temperature: float = 0.2,
) -> str:
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if not model.startswith("gpt-5"):
        kwargs["temperature"] = temperature
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = client.chat.completions.create(**kwargs)
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("Model returned an empty response.")
    return content


def extract_yaml(text: str) -> str:
    stripped = text.strip()
    fenced = re.match(r"^```(?:yaml|yml)?\s*\n?(.*?)\n?```\s*$", stripped, flags=re.DOTALL | re.IGNORECASE)
    if not fenced:
        fenced = re.search(r"```(?:yaml|yml)\s*\n(.*?)\n?```", stripped, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        stripped = fenced.group(1).strip()
    return stripped + "\n"


def generate_plan(client: OpenAI, model: str, request: str) -> dict[str, Any]:
    content = chat(
        client=client,
        model=model,
        system=PLAN_SYSTEM_PROMPT,
        user=PLAN_USER_TEMPLATE.format(request=request),
        json_mode=True,
        temperature=0.1,
    )
    try:
        plan = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Planner did not return valid JSON: {exc}\n{content}") from exc
    if not isinstance(plan, dict):
        raise RuntimeError("Planner JSON must be an object.")
    return plan


def generate_yaml(
    *,
    client: OpenAI,
    model: str,
    request: str,
    plan: dict[str, Any],
    plugin_evidence: dict[str, Any],
    source_context: dict[str, Any],
) -> str:
    content = chat(
        client=client,
        model=model,
        system=YAML_SYSTEM_PROMPT,
        user=YAML_USER_TEMPLATE.format(
            request=request,
            plan_json=json.dumps(plan, ensure_ascii=False, indent=2),
            plugin_json=json.dumps(plugin_evidence, ensure_ascii=False, indent=2),
            source_context_json=json.dumps(source_context, ensure_ascii=False, indent=2),
        ),
        temperature=0.2,
    )
    return extract_yaml(content)


def generate_spec(
    *,
    client: OpenAI,
    model: str,
    request: str,
    plan: dict[str, Any],
    plugin_evidence: dict[str, Any],
    source_context: dict[str, Any],
) -> str:
    content = chat(
        client=client,
        model=model,
        system=SPEC_SYSTEM_PROMPT,
        user=SPEC_USER_TEMPLATE.format(
            request=request,
            plan_json=json.dumps(plan, ensure_ascii=False, indent=2),
            plugin_json=json.dumps(plugin_evidence, ensure_ascii=False, indent=2),
            source_context_json=json.dumps(source_context, ensure_ascii=False, indent=2),
        ),
        temperature=0.15,
    )
    return extract_yaml(content)


def planned_node_types(plan: dict[str, Any]) -> set[str]:
    graph_plan = plan.get("graph_plan")
    if not isinstance(graph_plan, dict):
        return set()
    nodes = graph_plan.get("nodes")
    if not isinstance(nodes, list):
        return set()
    return {str(node.get("type")) for node in nodes if isinstance(node, dict) and node.get("type")}


def plan_needs_plugin_evidence(plan: dict[str, Any]) -> bool:
    requirements = plan.get("requirements")
    requirements = requirements if isinstance(requirements, dict) else {}
    explicit_needs = []
    for key in ("needs_plugins", "needs_triggers"):
        value = requirements.get(key)
        if isinstance(value, list):
            explicit_needs.extend(item for item in value if item)
    return bool(explicit_needs or (planned_node_types(plan) & PLUGIN_NODE_TYPES))


def truncate_prompt_value(
    value: Any,
    *,
    string_limit: int = PROMPT_STRING_LIMIT,
    list_limit: int = PROMPT_LIST_LIMIT,
) -> Any:
    if isinstance(value, str):
        if len(value) <= string_limit:
            return value
        return value[:string_limit] + "\n... [truncated for prompt] ..."
    if isinstance(value, list):
        return [
            truncate_prompt_value(item, string_limit=string_limit, list_limit=list_limit)
            for item in value[:list_limit]
        ]
    if isinstance(value, dict):
        return {
            key: truncate_prompt_value(item, string_limit=string_limit, list_limit=list_limit)
            for key, item in value.items()
        }
    return value


def compact_candidate(candidate: Any) -> dict[str, Any]:
    if not isinstance(candidate, dict):
        return {}
    keep_keys = (
        "source",
        "kind",
        "name",
        "author",
        "version",
        "plugin_id",
        "package_identity",
        "minimum_dify_version",
        "label",
        "description",
        "provider_id",
        "provider_name",
        "provider_refs",
        "tools",
        "events",
        "models",
        "dependencies",
        "exact_dependency_evidence",
        "credential_requirements",
        "oauth_scopes",
        "resource",
        "score",
    )
    compact = {key: candidate.get(key) for key in keep_keys if key in candidate}
    docs = candidate.get("docs")
    if isinstance(docs, list):
        compact["docs"] = [
            {
                key: truncate_prompt_value(doc.get(key), string_limit=320, list_limit=3)
                for key in ("path", "title", "excerpt", "summary")
                if isinstance(doc, dict) and doc.get(key)
            }
            for doc in docs[:3]
            if isinstance(doc, dict)
        ]
    groups = compact.get("credential_requirements")
    if isinstance(groups, list):
        compact["credential_requirements"] = [
            {
                "name": group.get("name"),
                "fields": [
                    {
                        "name": field.get("name"),
                        "type": field.get("type"),
                        "required": field.get("required", False),
                        "label": truncate_prompt_value(field.get("label"), string_limit=120, list_limit=2),
                    }
                    for field in (group.get("fields") or [])[:8]
                    if isinstance(field, dict) and field.get("name")
                ],
            }
            for group in groups[:4]
            if isinstance(group, dict)
        ]
    return truncate_prompt_value(compact)


def compact_plugin_evidence_for_prompt(plugin_evidence: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    if not plan_needs_plugin_evidence(plan):
        return {
            "resolution_policy": plugin_evidence.get("resolution_policy", []),
            "official_candidates": [],
            "model_provider_candidates": [],
            "extracted_template_candidates": [],
            "official_template_links": [],
            "pruned_reason": "Plan uses only native non-plugin workflow nodes.",
        }

    extracted = [
        item
        for item in plugin_evidence.get("extracted_template_candidates", [])
        if isinstance(item, dict)
    ][:PROMPT_LIST_LIMIT]
    linked_ids = {
        str(link.get("official_plugin_id"))
        for link in plugin_evidence.get("official_template_links", [])
        if isinstance(link, dict) and link.get("official_plugin_id")
    }
    official_candidates = [
        candidate
        for candidate in plugin_evidence.get("official_candidates", [])
        if isinstance(candidate, dict)
    ]
    strong_official = [
        candidate
        for candidate in official_candidates
        if int(candidate.get("score") or 0) >= 10 or str(candidate.get("plugin_id") or "") in linked_ids
    ]
    if len(strong_official) < 2:
        strong_official = official_candidates[:4]

    return {
        "resolution_policy": plugin_evidence.get("resolution_policy", []),
        "official_candidates": [
            compact_candidate(candidate)
            for candidate in strong_official[:PROMPT_LIST_LIMIT]
        ][:PROMPT_LIST_LIMIT],
        "model_provider_candidates": [
            compact_candidate(candidate)
            for candidate in plugin_evidence.get("model_provider_candidates", [])
            if isinstance(candidate, dict)
        ][:4],
        "extracted_template_candidates": truncate_prompt_value(
            extracted,
            string_limit=1000,
            list_limit=PROMPT_LIST_LIMIT,
        ),
        "official_template_links": truncate_prompt_value(
            plugin_evidence.get("official_template_links", []),
            string_limit=800,
            list_limit=PROMPT_LIST_LIMIT,
        ),
        "pruned_reason": "Prompt evidence is compacted; full evidence remains in plugin_evidence.json.",
    }


def repair_yaml(
    *,
    client: OpenAI,
    model: str,
    request: str,
    plan: dict[str, Any],
    plugin_evidence: dict[str, Any],
    source_context: dict[str, Any],
    yaml_text: str,
    validation: dict[str, Any],
) -> str:
    content = chat(
        client=client,
        model=model,
        system=REPAIR_SYSTEM_PROMPT,
        user=REPAIR_USER_TEMPLATE.format(
            request=request,
            plan_json=json.dumps(plan, ensure_ascii=False, indent=2),
            plugin_json=json.dumps(plugin_evidence, ensure_ascii=False, indent=2),
            source_context_json=json.dumps(source_context, ensure_ascii=False, indent=2),
            validation_json=json.dumps(validation, ensure_ascii=False, indent=2),
            yaml_text=yaml_text,
        ),
        temperature=0.1,
    )
    return extract_yaml(content)
