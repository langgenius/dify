"""Normalize uploaded config skills into one canonical ToolFile reference.

This service keeps the existing skill package validation rules, enforces the
requested stable name, stores the normalized archive as one ToolFile, and
returns the persisted Soul reference metadata used by ``AgentConfigService``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from extensions.ext_storage import storage
from models.agent_config_entities import AgentConfigSkillRefConfig, validate_config_skill_name
from repositories.knowledge.upload_file_repository import (
    AgentConfigToolFileCleanup,
    create_pending_agent_config_skill_file,
)
from services.agent.skill_package_service import SkillPackageError, SkillPackageService


class ConfigSkillNormalizeService:
    """Validate, normalize, and persist one config skill archive."""

    def __init__(self, *, package_service: SkillPackageService | None = None) -> None:
        self._package = package_service or SkillPackageService()

    def normalize(
        self,
        *,
        content: bytes,
        filename: str,
        requested_name: str | None,
        tenant_id: str,
        user_id: str,
    ) -> AgentConfigSkillRefConfig:
        package = self._package.validate_and_normalize(content=content, filename=filename)
        normalized_name = validate_config_skill_name(requested_name or package.manifest.name)
        if package.manifest.name != normalized_name:
            raise SkillPackageError(
                "skill_name_mismatch",
                "skill package name must match the requested config skill name",
                status_code=400,
            )

        pending = self._create_pending_tool_file(
            archive=package.archive_bytes,
            normalized_name=normalized_name,
            tenant_id=tenant_id,
            user_id=user_id,
        )
        return AgentConfigSkillRefConfig(
            name=normalized_name,
            description=package.manifest.description,
            file_id=pending.id,
            size=len(package.archive_bytes),
            hash=package.manifest.hash,
            mime_type="application/zip",
        )

    @staticmethod
    def _create_pending_tool_file(
        *,
        archive: bytes,
        normalized_name: str,
        tenant_id: str,
        user_id: str,
    ) -> AgentConfigToolFileCleanup:
        pending = create_pending_agent_config_skill_file(
            tenant_id=tenant_id,
            user_id=user_id,
            normalized_name=normalized_name,
            size=len(archive),
            cleanup_started_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=10),
        )

        # The durable marker precedes storage I/O. A failed save or interrupted
        # caller therefore leaves the exact key discoverable by recovery.
        storage.save(pending.key, archive)
        return pending


__all__ = ["ConfigSkillNormalizeService"]
