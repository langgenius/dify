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
        "tools.dify_tools",
        "tools.cli_tools",
        "env",
        "sandbox",
    }
)

RESERVED_AGENT_BACKEND_FEATURES = frozenset(
    {
        "skills_files",
        "knowledge",
        "human",
        "memory",
    }
)


def build_runtime_feature_manifest(agent_soul: AgentSoulConfig) -> dict[str, Any]:
    """Describe PRD capabilities supported by or still reserved from Agent backend runtime."""
    warnings: list[dict[str, str]] = []
    soul_dump = agent_soul.model_dump(mode="json")
    for section in sorted(RESERVED_AGENT_BACKEND_FEATURES):
        value = _get_nested(soul_dump, section)
        has_value = bool(value)
        if isinstance(value, dict):
            has_value = any(bool(item) for item in value.values())
        if has_value:
            warnings.append(
                {
                    "section": f"agent_soul.{section}",
                    "code": "agent_backend_layer_not_available",
                    "message": f"{section} is saved in Agent Soul but is not executed by Agent backend.",
                }
            )

    reserved_status = dict.fromkeys(sorted(RESERVED_AGENT_BACKEND_FEATURES), "reserved_not_executed")
    reserved_status["tools.dify_tools"] = "supported_when_config_valid"
    reserved_status["tools.cli_tools"] = "supported_by_shell_bootstrap"
    reserved_status["env"] = "supported_by_shell_bootstrap"
    reserved_status["sandbox"] = "forwarded_to_shell_layer_config"

    return {
        "supported": sorted(SUPPORTED_AGENT_BACKEND_FEATURES),
        "reserved": sorted(RESERVED_AGENT_BACKEND_FEATURES),
        "reserved_status": reserved_status,
        "unsupported_runtime_warnings": warnings,
    }


def _get_nested(value: dict[str, Any], path: str) -> Any:
    current: Any = value
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current
