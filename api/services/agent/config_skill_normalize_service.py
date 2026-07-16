"""Normalize uploaded config skills into one canonical ToolFile reference.

Config skills are Agent Soul-backed assets, not drive rows. This service keeps
the existing skill package validation rules, enforces the requested stable name,
stores the normalized archive as one ToolFile, and returns the persisted Soul
reference metadata used by ``AgentConfigService``.
"""

from __future__ import annotations

from core.tools.tool_file_manager import ToolFileManager
from models.agent_config_entities import AgentConfigSkillRefConfig, validate_config_skill_name
from services.agent.skill_package_service import NormalizedSkillPackage, SkillPackageError, SkillPackageService


class ConfigSkillNormalizeService:
    """Validate, normalize, and persist one config skill archive."""

    def __init__(
        self,
        *,
        package_service: SkillPackageService | None = None,
        tool_file_manager: ToolFileManager | None = None,
    ) -> None:
        self._package = package_service or SkillPackageService()
        self._tool_files = tool_file_manager or ToolFileManager()

    def normalize(
        self,
        *,
        content: bytes,
        filename: str,
        requested_name: str | None,
        tenant_id: str,
        user_id: str,
    ) -> tuple[AgentConfigSkillRefConfig, NormalizedSkillPackage]:
        package = self._package.validate_and_normalize(content=content, filename=filename)
        normalized_name = validate_config_skill_name(requested_name or package.manifest.name)
        if package.manifest.name != normalized_name:
            raise SkillPackageError(
                "skill_name_mismatch",
                "skill package name must match the requested config skill name",
                status_code=400,
            )

        tool_file = self._tool_files.create_file_by_raw(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=package.archive_bytes,
            mimetype="application/zip",
            filename=f"{normalized_name}.zip",
        )
        return (
            AgentConfigSkillRefConfig(
                name=normalized_name,
                description=package.manifest.description,
                file_id=tool_file.id,
                size=tool_file.size,
                hash=package.manifest.hash,
                mime_type=tool_file.mimetype,
            ),
            package,
        )


__all__ = ["ConfigSkillNormalizeService"]
