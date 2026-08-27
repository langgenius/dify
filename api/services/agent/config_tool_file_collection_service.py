"""Reference-aware collection for ToolFiles retired from Agent config assets."""

from __future__ import annotations

import logging
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from extensions.ext_storage import storage
from models.agent import AgentConfigDraft, AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig
from models.skill import Skill, SkillDraftFile, SkillVersion
from models.tools import ToolFile

logger = logging.getLogger(__name__)


class AgentConfigToolFileCollectionService:
    """Delete candidate ToolFiles only after every durable config reference is gone."""

    @classmethod
    def collect_unreferenced(
        cls,
        *,
        tenant_id: str,
        candidate_ids: Iterable[str],
        session: Session,
    ) -> list[str]:
        candidates = {file_id for file_id in candidate_ids if file_id}
        if not candidates:
            return []

        tool_files = list(
            session.scalars(
                select(ToolFile)
                .where(ToolFile.tenant_id == tenant_id, ToolFile.id.in_(candidates))
                .order_by(ToolFile.id)
                .with_for_update()
            )
        )
        if not tool_files:
            return []

        existing_ids = {tool_file.id for tool_file in tool_files}
        referenced_ids = cls._referenced_ids(tenant_id=tenant_id, candidate_ids=existing_ids, session=session)
        deleted_ids: list[str] = []
        for tool_file in tool_files:
            if tool_file.id in referenced_ids:
                continue
            cls._delete_storage_object(tool_file.file_key)
            session.delete(tool_file)
            deleted_ids.append(tool_file.id)
        return deleted_ids

    @classmethod
    def _referenced_ids(
        cls,
        *,
        tenant_id: str,
        candidate_ids: set[str],
        session: Session,
    ) -> set[str]:
        referenced_ids: set[str] = set()
        for model in (AgentConfigSnapshot, AgentConfigDraft):
            souls = session.scalars(select(model.config_snapshot).where(model.tenant_id == tenant_id))
            for soul_value in souls:
                soul = (
                    soul_value
                    if isinstance(soul_value, AgentSoulConfig)
                    else AgentSoulConfig.model_validate(soul_value)
                )
                referenced_ids.update(cls._soul_tool_file_ids(soul) & candidate_ids)
                if referenced_ids == candidate_ids:
                    return referenced_ids

        referenced_ids.update(
            file_id
            for file_id in session.scalars(
                select(SkillDraftFile.tool_file_id)
                .join(Skill, Skill.id == SkillDraftFile.skill_id)
                .where(Skill.tenant_id == tenant_id, SkillDraftFile.tool_file_id.in_(candidate_ids))
            )
            if file_id
        )
        referenced_ids.update(
            session.scalars(
                select(SkillVersion.archive_tool_file_id)
                .join(Skill, Skill.id == SkillVersion.skill_id)
                .where(Skill.tenant_id == tenant_id, SkillVersion.archive_tool_file_id.in_(candidate_ids))
            )
        )
        return referenced_ids

    @staticmethod
    def _soul_tool_file_ids(soul: AgentSoulConfig) -> set[str]:
        ids = {skill.file_id for skill in soul.config_skills if not skill.is_missing and skill.file_id}
        ids.update(
            file_ref.file_id
            for file_ref in soul.config_files
            if file_ref.file_kind == "tool_file" and not file_ref.is_missing and file_ref.file_id
        )
        return ids

    @staticmethod
    def _delete_storage_object(file_key: str) -> None:
        try:
            storage.delete(file_key)
        except Exception:
            if storage.exists(file_key):
                raise
            logger.info("Agent config ToolFile object %s was already absent", file_key)


__all__ = ["AgentConfigToolFileCollectionService"]
