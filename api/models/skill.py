"""Workspace-level Skill Management models.

These tables are the source of truth for reusable workspace Skills. Agent Soul
``config_skills`` and Agent Drive skill rows remain per-agent runtime/config
assets; they may consume a published Skill snapshot but do not own the Skill's
draft, metadata, version history, or Agent binding priority.
"""

from enum import StrEnum

import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict
from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, DefaultFieldsMixin
from models.types import EnumText, JSONModelColumn, LongText, StringUUID


class SkillFileKind(StrEnum):
    """Draft file entry kind."""

    FILE = "file"
    DIRECTORY = "directory"


class SkillFileStorage(StrEnum):
    """How a draft file's content is stored."""

    TEXT = "text"
    TOOL_FILE = "tool_file"


class SkillVersionManifestFile(BaseModel):
    """One file entry captured in a published Skill snapshot manifest."""

    path: str
    mime_type: str | None = None
    size: int
    hash: str

    model_config = ConfigDict(extra="forbid")


class SkillVersionManifest(BaseModel):
    """Published Skill snapshot file index."""

    files: list[SkillVersionManifestFile]

    model_config = ConfigDict(extra="forbid")


class Skill(DefaultFieldsMixin, Base):
    """Workspace-level reusable Skill metadata and draft status."""

    __tablename__ = "skills"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="skill_pkey"),
        UniqueConstraint("tenant_id", "name", name="skill_tenant_name_unique"),
        Index("skills_tenant_updated_at_idx", "tenant_id", "updated_at"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    icon: Mapped[str] = mapped_column(sa.String(16), nullable=False, default="📄", server_default="📄")
    description: Mapped[str] = mapped_column(sa.String(1024), nullable=False, default="", server_default="")
    name_manually_edited: Mapped[bool] = mapped_column(
        sa.Boolean,
        nullable=False,
        default=False,
        server_default=sa.false(),
    )
    visibility: Mapped[str] = mapped_column(
        sa.String(32),
        nullable=False,
        default="workspace",
        server_default="workspace",
    )
    latest_published_version_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    updated_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)


class SkillDraftFile(DefaultFieldsMixin, Base):
    """One draft file or directory in a workspace Skill."""

    __tablename__ = "skill_draft_files"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="skill_draft_file_pkey"),
        UniqueConstraint("skill_id", "path", name="skill_draft_file_skill_path_unique"),
        Index("skill_draft_files_skill_path_idx", "skill_id", "path"),
    )

    skill_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    path: Mapped[str] = mapped_column(sa.String(512), nullable=False)
    kind: Mapped[SkillFileKind] = mapped_column(EnumText(SkillFileKind, length=32), nullable=False)
    storage: Mapped[SkillFileStorage | None] = mapped_column(EnumText(SkillFileStorage, length=32), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)
    content_text: Mapped[str | None] = mapped_column(LongText, nullable=True)
    tool_file_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    size: Mapped[int | None] = mapped_column(sa.BigInteger, nullable=True)
    hash: Mapped[str | None] = mapped_column(sa.String(255), nullable=True)


class SkillVersion(DefaultFieldsMixin, Base):
    """Immutable published Skill snapshot.

    ``hash_code`` uniquely identifies a published version for downstream
    execution audit. It includes Skill identity, version number, and archive
    content digest instead of being only the archive content hash.
    """

    __tablename__ = "skill_versions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="skill_version_pkey"),
        UniqueConstraint("skill_id", "version_number", name="skill_version_skill_number_unique"),
        Index("skill_versions_skill_created_at_idx", "skill_id", "created_at"),
    )

    skill_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    version_number: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    version_name: Mapped[str] = mapped_column(sa.String(128), nullable=False, default="", server_default="")
    publish_note: Mapped[str] = mapped_column(sa.String(1024), nullable=False, default="", server_default="")
    manifest: Mapped[SkillVersionManifest] = mapped_column(JSONModelColumn(SkillVersionManifest), nullable=False)
    archive_tool_file_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    hash_code: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    archive_size: Mapped[int] = mapped_column(sa.BigInteger, nullable=False)
    published_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)


class AgentSkillBinding(DefaultFieldsMixin, Base):
    """Direct Agent-to-workspace-Skill binding.

    ``priority`` is retained as an internal ordering column for the current
    schema constraints. Runtime Skill selection is Agent-driven and must not
    treat it as a matching priority.
    """

    __tablename__ = "agent_skill_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="agent_skill_binding_pkey"),
        UniqueConstraint("tenant_id", "agent_id", "skill_id", name="agent_skill_binding_unique"),
        UniqueConstraint("tenant_id", "agent_id", "priority", name="agent_skill_binding_priority_unique"),
        Index("agent_skill_bindings_skill_idx", "tenant_id", "skill_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    agent_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    skill_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    priority: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)


__all__ = [
    "AgentSkillBinding",
    "Skill",
    "SkillDraftFile",
    "SkillFileKind",
    "SkillFileStorage",
    "SkillVersion",
    "SkillVersionManifest",
    "SkillVersionManifestFile",
]
