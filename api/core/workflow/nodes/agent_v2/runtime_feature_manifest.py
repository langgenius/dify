from __future__ import annotations

from typing import Any

from models.agent_config_entities import AgentSoulConfig
from services.agent.knowledge_datasets import list_agent_soul_knowledge_dataset_ids

SUPPORTED_AGENT_BACKEND_FEATURES = frozenset(
    {
        "system_prompt",
        "workflow_prompt",
        "workflow_context",
        "model",
        "structured_output",
        "tools.dify_tools",
        "tools.cli_tools",
        "knowledge",
        "env",
        "sandbox",
        # ENG-635: human involvement is exposed at runtime as the dify.ask_human
        # deferred tool; a call pauses via the existing HITL form mechanism.
        "human",
    }
)

RESERVED_AGENT_BACKEND_FEATURES = frozenset(
    {
        "memory",
    }
)


def build_runtime_feature_manifest(agent_soul: AgentSoulConfig) -> dict[str, Any]:
    """Describe PRD capabilities supported by or still reserved from Agent backend runtime."""
    warnings: list[dict[str, str]] = []
    soul_dump = agent_soul.model_dump(mode="json", exclude_none=True, exclude_defaults=True)
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
    reserved_status["knowledge"] = "supported_by_knowledge_layer" if agent_soul.knowledge.sets else "not_configured"
    reserved_status["tools.dify_tools"] = "supported_when_config_valid"
    reserved_status["tools.cli_tools"] = "supported_by_shell_bootstrap"
    reserved_status["env"] = "supported_by_shell_bootstrap"
    reserved_status["sandbox"] = "forwarded_to_shell_layer_config"
    reserved_status["human"] = "supported_by_ask_human_hitl" if agent_soul.human.contacts else "not_configured"

    return {
        "supported": sorted(SUPPORTED_AGENT_BACKEND_FEATURES),
        "reserved": sorted(RESERVED_AGENT_BACKEND_FEATURES),
        "reserved_status": reserved_status,
        "unsupported_runtime_warnings": warnings,
    }


def list_configured_knowledge_dataset_ids(agent_soul: AgentSoulConfig) -> list[str]:
    """Return normalized dataset ids selected by Agent v2 knowledge sets.

    ``build_runtime_feature_manifest()`` and ``build_knowledge_layer_config()``
    stay aligned on the set-based contract: DTO validation rejects blank dataset
    ids before runtime, so this helper only flattens configured set datasets for
    metadata/diagnostic surfaces that still need a dataset-id summary.
    """
    return list_agent_soul_knowledge_dataset_ids(agent_soul)


def _get_nested(value: dict[str, Any], path: str) -> Any:
    current: Any = value
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current
