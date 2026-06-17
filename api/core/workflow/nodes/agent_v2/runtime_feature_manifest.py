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
        "knowledge",
        "env",
        "sandbox",
        # ENG-623: exposed at runtime as the dify.drive declaration layer
        # (an index the agent pulls through the back proxy).
        "skills_files",
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


def build_runtime_feature_manifest(
    agent_soul: AgentSoulConfig,
    *,
    drive_manifest_enabled: bool = False,
) -> dict[str, Any]:
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

    has_skills_files = bool(agent_soul.skills_files.skills or agent_soul.skills_files.files)
    if has_skills_files and not drive_manifest_enabled:
        warnings.append(
            {
                "section": "agent_soul.skills_files",
                "code": "drive_manifest_disabled",
                "message": (
                    "skills_files is configured but AGENT_DRIVE_MANIFEST_ENABLED is off; "
                    "the drive declaration layer is not injected into this run."
                ),
            }
        )
    for skill in agent_soul.skills_files.skills:
        if not skill.skill_md_key:
            warnings.append(
                {
                    "section": "agent_soul.skills_files",
                    "code": "skill_ref_dangling",
                    "message": (
                        f"skill_ref_dangling: skill '{skill.name or skill.id or 'unknown'}' has no drive key; "
                        "re-standardize it to expose it at runtime."
                    ),
                }
            )

    reserved_status = dict.fromkeys(sorted(RESERVED_AGENT_BACKEND_FEATURES), "reserved_not_executed")
    reserved_status["knowledge"] = (
        "supported_by_knowledge_layer" if list_configured_knowledge_dataset_ids(agent_soul) else "not_configured"
    )
    reserved_status["skills_files"] = (
        "supported_by_drive_manifest" if drive_manifest_enabled else "drive_manifest_disabled"
    )
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
    """Return the normalized knowledge dataset ids that can produce a runtime layer.

    ``build_runtime_feature_manifest()`` and ``build_knowledge_layer_config()``
    must stay aligned: both decide knowledge support from this effective,
    non-blank dataset-id set rather than from raw
    ``agent_soul.knowledge.datasets`` entries.
    """
    return [dataset_id for dataset in agent_soul.knowledge.datasets if (dataset_id := (dataset.id or "").strip())]


def _get_nested(value: dict[str, Any], path: str) -> Any:
    current: Any = value
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current
