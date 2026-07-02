"""Standardize an uploaded Skill into the agent drive (ENG-594).

A validated Skill package is normalized into two **drive-owned** objects committed
to the agent drive (Agent Files §5.4 / §4):

* ``<slug>/SKILL.md`` — the canonical entry, the source of truth for loading.
* ``<slug>/.DIFY-SKILL-FULL.zip`` — the full archive, kept only to restore the
  complete skill contents.

The archive's member list is stored in skill metadata and resolved lazily for
inspect/preview/runtime. Upload must not eagerly materialize every archive member
as a separate ToolFile; small archives with many files would otherwise perform
hundreds of storage writes and DB commits inside the request.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy.orm import Session, scoped_session

from core.tools.tool_file_manager import ToolFileManager
from services.agent.skill_package_service import SkillPackageService
from services.agent_drive_service import AgentDriveService, DriveCommitItem, DriveFileRef, DriveSkillMetadata

_FULL_ARCHIVE_NAME = ".DIFY-SKILL-FULL.zip"
_SKILL_MD_NAME = "SKILL.md"
_SLUG_RE = re.compile(r"[^a-z0-9._-]+")


def slugify_skill_name(name: str) -> str:
    slug = _SLUG_RE.sub("-", (name or "").strip().lower()).strip("-._")
    return slug or "skill"


class SkillStandardizeService:
    """Persist a normalized skill package into drive-owned files for one agent.

    Instances are intentionally stateful: ``standardize()`` updates
    ``last_committed_items`` with the drive commit result for the most recent call.
    """

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
        self.last_committed_items: list[dict[str, Any]] = []

    def standardize(
        self,
        *,
        content: bytes,
        filename: str,
        tenant_id: str,
        user_id: str,
        agent_id: str,
        session: Session | scoped_session,
    ) -> dict[str, Any]:
        """Create two ToolFiles, commit two drive-owned keys, and return skill metadata.

        This writes ``<slug>/SKILL.md`` and ``<slug>/.DIFY-SKILL-FULL.zip``,
        stores the drive commit rows in ``last_committed_items``, and returns the
        console response shape ``{"skill": ..., "manifest": ...}``.
        """
        package = self._package.validate_and_normalize(content=content, filename=filename)
        manifest = package.manifest
        slug = slugify_skill_name(manifest.name)

        # Drive-owned files: canonical SKILL.md and the full archive. The
        # archive member tree is preserved in metadata and resolved lazily.
        md_tool_file = self._tool_files.create_file_by_raw(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=package.skill_md_bytes,
            mimetype="text/markdown",
            filename=_SKILL_MD_NAME,
        )
        archive_tool_file = self._tool_files.create_file_by_raw(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=package.archive_bytes,
            mimetype="application/zip",
            filename=_FULL_ARCHIVE_NAME,
        )

        skill_md_key = f"{slug}/{_SKILL_MD_NAME}"
        archive_key = f"{slug}/{_FULL_ARCHIVE_NAME}"
        committed_items = self._drive.commit(
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
            session=session,
        )
        self.last_committed_items = committed_items

        return {
            "skill": {
                "name": manifest.name,
                "description": manifest.description,
                "path": slug,
                "skill_md_key": skill_md_key,
                "archive_key": archive_key,
            },
            "manifest": manifest.model_dump(),
        }


__all__ = ["SkillStandardizeService", "slugify_skill_name"]
