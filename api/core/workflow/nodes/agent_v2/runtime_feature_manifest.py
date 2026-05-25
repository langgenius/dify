from __future__ import annotations

from typing import Any

from models.agent_config_entities import AgentSoulConfig

SUPPORTED_AGENT_BACKEND_FEATURES = frozenset(
    {
        "system_prompt",
        "workflow_prompt",
        "workflow_context",
        "model",
        "structured_output",
    }
)

RESERVED_AGENT_BACKEND_FEATURES = frozenset(
    {
        "skills_files",
        "tools",
        "knowledge",
        "human",
        "env",
        "sandbox",
        "memory",
    }
)


def build_runtime_feature_manifest(agent_soul: AgentSoulConfig) -> dict[str, Any]:
    """Describe PRD capabilities that are persisted but not executed in phase 3."""
    warnings: list[dict[str, str]] = []
    soul_dump = agent_soul.model_dump(mode="json")
    for section in sorted(RESERVED_AGENT_BACKEND_FEATURES):
        value = soul_dump.get(section)
        has_value = bool(value)
        if isinstance(value, dict):
            has_value = any(bool(item) for item in value.values())
        if has_value:
            warnings.append(
                {
                    "section": f"agent_soul.{section}",
                    "code": "agent_backend_layer_not_available",
                    "message": f"{section} is saved in Agent Soul but is not executed by Agent backend in phase 3.",
                }
            )

    reserved_status = dict.fromkeys(sorted(RESERVED_AGENT_BACKEND_FEATURES), "reserved_not_executed")

    return {
        "supported": sorted(SUPPORTED_AGENT_BACKEND_FEATURES),
        "reserved": sorted(RESERVED_AGENT_BACKEND_FEATURES),
        "reserved_status": reserved_status,
        "unsupported_runtime_warnings": warnings,
    }
