"""Standardize an uploaded Skill into the agent drive (ENG-594).

A validated Skill package is normalized into two **drive-owned** objects committed
to the agent drive (Agent Files §5.4 / §4):

* ``<slug>/SKILL.md`` — the canonical entry, the source of truth for loading.
* ``<slug>/.DIFY-SKILL-FULL.zip`` — the full archive, kept only to restore the
  complete skill contents.

Both are stored as ``ToolFile`` records and bound via ``AgentDriveService.commit``
with ``value_owned_by_drive=True`` (the drive owns their lifecycle). The returned
skill ref records the stable drive paths + file ids (not just the raw upload id),
so the Composer can reload the bound skill list. The console ``/skills/upload``
endpoints delegate to this service so "upload" now always means drive-backed skill
normalization.
"""

from __future__ import annotations

import re
from typing import Any

from core.tools.tool_file_manager import ToolFileManager
from models.agent_config_entities import AgentSkillRefConfig
from services.agent.skill_package_service import SkillPackageService
from services.agent_drive_service import AgentDriveService, DriveCommitItem, DriveFileRef, DriveSkillMetadata

_FULL_ARCHIVE_NAME = ".DIFY-SKILL-FULL.zip"
_SKILL_MD_NAME = "SKILL.md"
_SLUG_RE = re.compile(r"[^a-z0-9._-]+")


def slugify_skill_name(name: str) -> str:
    slug = _SLUG_RE.sub("-", (name or "").strip().lower()).strip("-._")
    return slug or "skill"


class SkillStandardizeService:
    """Validate + standardize a Skill package into a per-agent drive upload result."""

    def __init__(
        self,
        *,
        package_service: SkillPackageService | None = None,
        drive_service: AgentDriveService | None = None,
        tool_file_manager: ToolFileManager | None = None,
    ) -> None:
        self._package = package_service or SkillPackageService()
        self._drive = drive_service or AgentDriveService()
        self._tool_files = tool_file_manager or ToolFileManager()

    def standardize(
        self,
        *,
        content: bytes,
        filename: str,
        tenant_id: str,
        user_id: str,
        agent_id: str,
    ) -> dict[str, Any]:
        manifest = self._package.validate_and_extract(content=content, filename=filename)
        skill_md_bytes = self._package.read_member_bytes(content=content, member_path=manifest.entry_path)
        slug = slugify_skill_name(manifest.name)

        # Two drive-owned ToolFiles: canonical SKILL.md + the full archive.
        md_tool_file = self._tool_files.create_file_by_raw(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=skill_md_bytes,
            mimetype="text/markdown",
            filename=_SKILL_MD_NAME,
        )
        archive_tool_file = self._tool_files.create_file_by_raw(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=content,
            mimetype="application/zip",
            filename=_FULL_ARCHIVE_NAME,
        )

        skill_md_key = f"{slug}/{_SKILL_MD_NAME}"
        archive_key = f"{slug}/{_FULL_ARCHIVE_NAME}"
        self._drive.commit(
            tenant_id=tenant_id,
            user_id=user_id,
            agent_id=agent_id,
            items=[
                DriveCommitItem(
                    key=skill_md_key,
                    file_ref=DriveFileRef(kind="tool_file", id=md_tool_file.id),
                    value_owned_by_drive=True,
                    is_skill=True,
                    skill_metadata=DriveSkillMetadata(
                        name=manifest.name,
                        description=manifest.description,
                        manifest_files=manifest.files,
                    ),
                ),
                DriveCommitItem(
                    key=archive_key,
                    file_ref=DriveFileRef(kind="tool_file", id=archive_tool_file.id),
                    value_owned_by_drive=True,
                ),
            ],
        )

        skill_ref = AgentSkillRefConfig.model_validate(
            {
                "id": manifest.hash,
                "name": manifest.name,
                "description": manifest.description,
                "file_id": archive_tool_file.id,
                "path": slug,
                "size": manifest.size,
                "hash": manifest.hash,
                "entry_path": skill_md_key,
                "skill_md_file_id": md_tool_file.id,
                "skill_md_key": skill_md_key,
                "full_archive_file_id": archive_tool_file.id,
                "full_archive_key": archive_key,
                # ENG-371: zip member listing — strong signals (scripts/*.sh) for infer-tools.
                "manifest_files": manifest.files,
            }
        )
        return {
            "skill": skill_ref.model_dump(exclude_none=True),
            "manifest": manifest.model_dump(),
        }


__all__ = ["SkillStandardizeService", "slugify_skill_name"]
