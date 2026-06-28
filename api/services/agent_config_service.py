"""Agent Soul-backed config assets for skills, files, env, and note text.

This service is the single API-side control plane for Agent config assets. It
resolves the requested config version (published snapshot, shared draft, or
per-user build draft), reads only from ``AgentSoulConfig.config_skills``,
``config_files``, ``env.variables``, and ``config_note``, and mutates only the
target Soul JSON. It intentionally does not manage object-storage lifecycle:
removing or replacing a config asset drops the Soul reference only.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import DataError, SQLAlchemyError
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.tools.tool_file_manager import ToolFileManager
from extensions.ext_storage import storage
from models.agent import Agent, AgentConfigDraft, AgentConfigDraftType, AgentConfigSnapshot
from models.agent_config_entities import (
    AgentConfigFileRefConfig,
    AgentConfigSkillRefConfig,
    AgentEnvVariableConfig,
    AgentSoulConfig,
    validate_config_name,
    validate_config_skill_name,
)
from models.model import UploadFile
from models.tools import ToolFile
from services.agent.config_skill_normalize_service import ConfigSkillNormalizeService
from services.agent.skill_package_service import SkillPackageError
from services.agent_drive_service import DriveFileRef


class AgentConfigVersionKind(StrEnum):
    SNAPSHOT = "snapshot"
    DRAFT = "draft"
    BUILD_DRAFT = "build_draft"


class AgentConfigMutationSurface(StrEnum):
    AGENT_STUB = "agent_stub"
    CONSOLE = "console"


class AgentConfigServiceError(Exception):
    """Config operation failure mapped to HTTP status at controller boundaries."""

    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class ConfigPushFileItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    file_ref: DriveFileRef | None = None


class ConfigPushSkillItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    file_ref: DriveFileRef | None = None


class ConfigPushPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    files: list[ConfigPushFileItem] = Field(default_factory=list)
    skills: list[ConfigPushSkillItem] = Field(default_factory=list)
    env_text: str | None = None
    note: str | None = None


@dataclass(slots=True)
class AgentConfigTarget:
    agent_id: str
    version_id: str
    kind: AgentConfigVersionKind
    writable: bool
    version: AgentConfigSnapshot | AgentConfigDraft
    agent_soul: AgentSoulConfig


@dataclass(frozen=True, slots=True)
class ConfigDownload:
    filename: str
    mime_type: str
    payload: bytes


class AgentConfigService:
    """Read and update Agent Soul-backed config assets for one version target."""

    def __init__(
        self,
        *,
        tool_file_manager: ToolFileManager | None = None,
        skill_normalize_service: ConfigSkillNormalizeService | None = None,
    ) -> None:
        self._tool_files = tool_file_manager or ToolFileManager()
        self._skill_normalizer = skill_normalize_service or ConfigSkillNormalizeService()

    def resolve_target(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        user_id: str | None = None,
    ) -> AgentConfigTarget:
        with session_factory.create_session() as session:
            target = self._resolve_target_in_session(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                config_version_id=config_version_id,
                config_version_kind=config_version_kind,
                user_id=user_id,
            )
            return AgentConfigTarget(
                agent_id=target.agent_id,
                version_id=target.version_id,
                kind=target.kind,
                writable=target.writable,
                version=target.version,
                agent_soul=target.agent_soul.model_copy(deep=True),
            )

    def manifest(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        user_id: str | None = None,
    ) -> dict[str, object]:
        target = self.resolve_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            config_version_id=config_version_id,
            config_version_kind=config_version_kind,
            user_id=user_id,
        )
        return self._manifest_for_target(target)

    def pull_skill(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        name: str,
        user_id: str | None = None,
    ) -> ConfigDownload:
        target = self.resolve_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            config_version_id=config_version_id,
            config_version_kind=config_version_kind,
            user_id=user_id,
        )
        skill = self._require_skill(target.agent_soul, name=name)
        payload, mime_type = self._load_tool_file_bytes(tenant_id=tenant_id, file_id=skill.file_id)
        return ConfigDownload(filename=f"{skill.name}.zip", mime_type=mime_type or "application/zip", payload=payload)

    def inspect_skill(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        name: str,
        user_id: str | None = None,
    ) -> dict[str, object]:
        target = self.resolve_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            config_version_id=config_version_id,
            config_version_kind=config_version_kind,
            user_id=user_id,
        )
        skill = self._require_skill(target.agent_soul, name=name)
        archive_bytes, _mime_type = self._load_tool_file_bytes(tenant_id=tenant_id, file_id=skill.file_id)
        try:
            with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
                files = sorted(info.filename for info in archive.infolist() if not info.is_dir())
                skill_md = archive.read("SKILL.md").decode("utf-8")
        except (KeyError, OSError, ValueError, zipfile.BadZipFile, UnicodeDecodeError) as exc:
            raise AgentConfigServiceError(
                "skill_archive_invalid",
                "stored config skill archive is invalid",
                status_code=500,
            ) from exc
        return {
            "name": skill.name,
            "description": skill.description,
            "files": files,
            "skill_md": skill_md,
        }

    def pull_file(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        name: str,
        user_id: str | None = None,
    ) -> ConfigDownload:
        target = self.resolve_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            config_version_id=config_version_id,
            config_version_kind=config_version_kind,
            user_id=user_id,
        )
        file_ref = self._require_file(target.agent_soul, name=name)
        payload, filename, mime_type = self._load_file_ref_bytes(
            tenant_id=tenant_id,
            file_kind=file_ref.file_kind,
            file_id=file_ref.file_id,
        )
        return ConfigDownload(filename=filename or file_ref.name, mime_type=mime_type or "application/octet-stream", payload=payload)

    def upload_skill(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        user_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        content: bytes,
        filename: str,
    ) -> dict[str, object]:
        return self._upload_skill(
            tenant_id=tenant_id,
            agent_id=agent_id,
            user_id=user_id,
            config_version_id=config_version_id,
            config_version_kind=config_version_kind,
            content=content,
            filename=filename,
            surface=AgentConfigMutationSurface.AGENT_STUB,
        )

    def upload_skill_for_console(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        user_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        content: bytes,
        filename: str,
    ) -> dict[str, object]:
        return self._upload_skill(
            tenant_id=tenant_id,
            agent_id=agent_id,
            user_id=user_id,
            config_version_id=config_version_id,
            config_version_kind=config_version_kind,
            content=content,
            filename=filename,
            surface=AgentConfigMutationSurface.CONSOLE,
        )

    def _upload_skill(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        user_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        content: bytes,
        filename: str,
        surface: AgentConfigMutationSurface,
    ) -> dict[str, object]:
        with session_factory.create_session() as session:
            target = self._resolve_target_in_session(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                config_version_id=config_version_id,
                config_version_kind=config_version_kind,
                user_id=user_id,
            )
            self._require_writable(target, surface=surface)
            skill_ref, _package = self._skill_normalizer.normalize(
                content=content,
                filename=filename,
                requested_name=None,
                tenant_id=tenant_id,
                user_id=user_id,
            )
            agent_soul = target.agent_soul.model_copy(deep=True)
            existing = {item.name: item for item in agent_soul.config_skills}
            order = [item.name for item in agent_soul.config_skills]
            if skill_ref.name not in order:
                order.append(skill_ref.name)
            existing[skill_ref.name] = skill_ref
            agent_soul.config_skills = [existing[name] for name in order if name in existing]
            target.version.config_snapshot = agent_soul
            session.commit()
            target.agent_soul = agent_soul
            return self._manifest_for_target(target)

    def push(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        user_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        payload: ConfigPushPayload,
    ) -> dict[str, object]:
        return self._push(
            tenant_id=tenant_id,
            agent_id=agent_id,
            user_id=user_id,
            config_version_id=config_version_id,
            config_version_kind=config_version_kind,
            payload=payload,
            surface=AgentConfigMutationSurface.AGENT_STUB,
        )

    def push_for_console(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        user_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        payload: ConfigPushPayload,
    ) -> dict[str, object]:
        return self._push(
            tenant_id=tenant_id,
            agent_id=agent_id,
            user_id=user_id,
            config_version_id=config_version_id,
            config_version_kind=config_version_kind,
            payload=payload,
            surface=AgentConfigMutationSurface.CONSOLE,
        )

    def push_file_for_console(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        user_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        upload_file_id: str,
    ) -> dict[str, object]:
        with session_factory.create_session() as session:
            target = self._resolve_target_in_session(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                config_version_id=config_version_id,
                config_version_kind=config_version_kind,
                user_id=user_id,
            )
            self._require_writable(target, surface=AgentConfigMutationSurface.CONSOLE)
            upload_file = self._require_console_upload_file_source(session, tenant_id=tenant_id, file_id=upload_file_id)
            agent_soul = target.agent_soul.model_copy(deep=True)
            agent_soul.config_files = self._upsert_upload_file(
                current=agent_soul.config_files,
                upload_file=upload_file,
            )
            target.version.config_snapshot = agent_soul
            session.commit()
            target.agent_soul = agent_soul
            return self._manifest_for_target(target)

    def _push(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        user_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        payload: ConfigPushPayload,
        surface: AgentConfigMutationSurface,
    ) -> dict[str, object]:
        with session_factory.create_session() as session:
            target = self._resolve_target_in_session(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                config_version_id=config_version_id,
                config_version_kind=config_version_kind,
                user_id=user_id,
            )
            self._require_writable(target, surface=surface)
            agent_soul = target.agent_soul.model_copy(deep=True)
            if payload.files:
                agent_soul.config_files = self._apply_file_updates(
                    session,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    current=agent_soul.config_files,
                    updates=payload.files,
                )
            if payload.skills:
                agent_soul.config_skills = self._apply_skill_updates(
                    session,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    current=agent_soul.config_skills,
                    updates=payload.skills,
                )
            if payload.env_text is not None:
                agent_soul.env.variables = self._apply_env_text(agent_soul.env.variables, payload.env_text)
            if payload.note is not None:
                agent_soul.config_note = payload.note
            target.version.config_snapshot = agent_soul
            session.commit()
            target.agent_soul = agent_soul
            return self._manifest_for_target(target)

    def preview_file(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        name: str,
        user_id: str | None = None,
    ) -> dict[str, object]:
        target = self.resolve_target(
            tenant_id=tenant_id,
            agent_id=agent_id,
            config_version_id=config_version_id,
            config_version_kind=config_version_kind,
            user_id=user_id,
        )
        file_ref = self._require_file(target.agent_soul, name=name)
        payload, filename, _mime_type = self._load_file_ref_bytes(
            tenant_id=tenant_id,
            file_kind=file_ref.file_kind,
            file_id=file_ref.file_id,
        )
        return self._preview_bytes(key=filename or file_ref.name, size=file_ref.size, payload=payload)

    def update_env(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        user_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        env_text: str,
    ) -> dict[str, object]:
        return self._update_env(
            tenant_id=tenant_id,
            agent_id=agent_id,
            user_id=user_id,
            config_version_id=config_version_id,
            config_version_kind=config_version_kind,
            env_text=env_text,
            surface=AgentConfigMutationSurface.AGENT_STUB,
        )

    def _update_env(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        user_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        env_text: str,
        surface: AgentConfigMutationSurface,
    ) -> dict[str, object]:
        with session_factory.create_session() as session:
            target = self._resolve_target_in_session(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                config_version_id=config_version_id,
                config_version_kind=config_version_kind,
                user_id=user_id,
            )
            self._require_writable(target, surface=surface)
            agent_soul = target.agent_soul.model_copy(deep=True)
            agent_soul.env.variables = self._apply_env_text(agent_soul.env.variables, env_text)
            target.version.config_snapshot = agent_soul
            session.commit()
            return {"env_keys": self._env_keys(agent_soul)}

    def update_note(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        user_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        note: str,
    ) -> dict[str, object]:
        return self._update_note(
            tenant_id=tenant_id,
            agent_id=agent_id,
            user_id=user_id,
            config_version_id=config_version_id,
            config_version_kind=config_version_kind,
            note=note,
            surface=AgentConfigMutationSurface.AGENT_STUB,
        )

    def _update_note(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        user_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        note: str,
        surface: AgentConfigMutationSurface,
    ) -> dict[str, object]:
        with session_factory.create_session() as session:
            target = self._resolve_target_in_session(
                session,
                tenant_id=tenant_id,
                agent_id=agent_id,
                config_version_id=config_version_id,
                config_version_kind=config_version_kind,
                user_id=user_id,
            )
            self._require_writable(target, surface=surface)
            agent_soul = target.agent_soul.model_copy(deep=True)
            agent_soul.config_note = note
            target.version.config_snapshot = agent_soul
            session.commit()
            return {"note": agent_soul.config_note}

    def _resolve_target_in_session(
        self,
        session: Session,
        *,
        tenant_id: str,
        agent_id: str,
        config_version_id: str,
        config_version_kind: AgentConfigVersionKind,
        user_id: str | None,
    ) -> AgentConfigTarget:
        self._assert_agent_belongs_to_tenant(session, tenant_id=tenant_id, agent_id=agent_id)
        try:
            match config_version_kind:
                case AgentConfigVersionKind.SNAPSHOT:
                    version = session.scalar(
                        select(AgentConfigSnapshot).where(
                            AgentConfigSnapshot.tenant_id == tenant_id,
                            AgentConfigSnapshot.agent_id == agent_id,
                            AgentConfigSnapshot.id == config_version_id,
                        )
                    )
                    writable = False
                case AgentConfigVersionKind.DRAFT:
                    version = session.scalar(
                        select(AgentConfigDraft).where(
                            AgentConfigDraft.tenant_id == tenant_id,
                            AgentConfigDraft.agent_id == agent_id,
                            AgentConfigDraft.id == config_version_id,
                            AgentConfigDraft.draft_type == AgentConfigDraftType.DRAFT,
                            AgentConfigDraft.account_id.is_(None),
                        )
                    )
                    writable = False
                case AgentConfigVersionKind.BUILD_DRAFT:
                    if not user_id:
                        raise AgentConfigServiceError(
                            "missing_user_id",
                            "user_id is required for build draft config access",
                            status_code=400,
                        )
                    version = session.scalar(
                        select(AgentConfigDraft).where(
                            AgentConfigDraft.tenant_id == tenant_id,
                            AgentConfigDraft.agent_id == agent_id,
                            AgentConfigDraft.id == config_version_id,
                            AgentConfigDraft.draft_type == AgentConfigDraftType.DEBUG_BUILD,
                            AgentConfigDraft.account_id == user_id,
                        )
                    )
                    writable = True
                case _:
                    raise AgentConfigServiceError("invalid_config_version_kind", "unsupported config version kind")
        except (DataError, SQLAlchemyError) as exc:
            session.rollback()
            raise AgentConfigServiceError(
                "config_version_not_found",
                "agent config version was not found",
                status_code=404,
            ) from exc
        if version is None:
            raise AgentConfigServiceError(
                "config_version_not_found",
                "agent config version was not found",
                status_code=404,
            )
        return AgentConfigTarget(
            agent_id=agent_id,
            version_id=version.id,
            kind=config_version_kind,
            writable=writable,
            version=version,
            agent_soul=AgentSoulConfig.model_validate(version.config_snapshot_dict),
        )

    @staticmethod
    def _assert_agent_belongs_to_tenant(session: Session, *, tenant_id: str, agent_id: str) -> None:
        try:
            found = session.scalar(select(Agent.id).where(Agent.id == agent_id, Agent.tenant_id == tenant_id))
        except (DataError, SQLAlchemyError) as exc:
            session.rollback()
            raise AgentConfigServiceError("agent_not_found", "agent does not belong to this tenant", status_code=404) from exc
        if found is None:
            raise AgentConfigServiceError("agent_not_found", "agent does not belong to this tenant", status_code=404)

    @staticmethod
    def _require_writable(target: AgentConfigTarget, *, surface: AgentConfigMutationSurface) -> None:
        if target.writable:
            return
        if surface == AgentConfigMutationSurface.CONSOLE and target.kind == AgentConfigVersionKind.DRAFT:
            return
        if surface == AgentConfigMutationSurface.CONSOLE:
            raise AgentConfigServiceError(
                "config_not_writable",
                "config mutations are only allowed for editable drafts",
                status_code=403,
            )
        raise AgentConfigServiceError(
            "config_not_writable",
            "config push is only allowed for build drafts",
            status_code=403,
        )

    def _apply_file_updates(
        self,
        session: Session,
        *,
        tenant_id: str,
        user_id: str,
        current: list[AgentConfigFileRefConfig],
        updates: list[ConfigPushFileItem],
    ) -> list[AgentConfigFileRefConfig]:
        by_name = {item.name: item for item in current}
        order = [item.name for item in current]
        for update in updates:
            name = validate_config_name(update.name)
            if update.file_ref is None:
                by_name.pop(name, None)
                continue
            size, hash_value, mime_type = self._validate_source_ref(
                session,
                tenant_id=tenant_id,
                user_id=user_id,
                file_ref=update.file_ref,
            )
            if name not in order:
                order.append(name)
            by_name[name] = AgentConfigFileRefConfig(
                name=name,
                file_kind=update.file_ref.kind,
                file_id=update.file_ref.id,
                size=size,
                hash=hash_value,
                mime_type=mime_type,
            )
        return [by_name[name] for name in order if name in by_name]

    @staticmethod
    def _upsert_upload_file(
        *,
        current: list[AgentConfigFileRefConfig],
        upload_file: UploadFile,
    ) -> list[AgentConfigFileRefConfig]:
        name = validate_config_name(upload_file.name)
        by_name = {item.name: item for item in current}
        order = [item.name for item in current]
        if name not in order:
            order.append(name)
        by_name[name] = AgentConfigFileRefConfig(
            name=name,
            file_kind="upload_file",
            file_id=upload_file.id,
            size=upload_file.size,
            hash=upload_file.hash,
            mime_type=upload_file.mime_type,
        )
        return [by_name[item_name] for item_name in order if item_name in by_name]

    def _apply_skill_updates(
        self,
        session: Session,
        *,
        tenant_id: str,
        user_id: str,
        current: list[AgentConfigSkillRefConfig],
        updates: list[ConfigPushSkillItem],
    ) -> list[AgentConfigSkillRefConfig]:
        by_name = {item.name: item for item in current}
        order = [item.name for item in current]
        for update in updates:
            name = validate_config_skill_name(update.name)
            if update.file_ref is None:
                by_name.pop(name, None)
                continue
            if update.file_ref.kind != "tool_file":
                raise AgentConfigServiceError(
                    "invalid_skill_file_ref",
                    "config skills must be uploaded as tool files",
                    status_code=400,
                )
            tool_file = self._require_tool_file_source(
                session,
                tenant_id=tenant_id,
                user_id=user_id,
                file_id=update.file_ref.id,
            )
            archive_bytes = storage.load_once(tool_file.file_key)
            try:
                skill_ref, _package = self._skill_normalizer.normalize(
                    content=archive_bytes,
                    filename=tool_file.name,
                    requested_name=name,
                    tenant_id=tenant_id,
                    user_id=user_id,
                )
            except SkillPackageError as exc:
                raise AgentConfigServiceError(exc.code, exc.message, status_code=exc.status_code) from exc
            if name not in order:
                order.append(name)
            by_name[name] = skill_ref
        return [by_name[name] for name in order if name in by_name]

    def _validate_source_ref(
        self,
        session: Session,
        *,
        tenant_id: str,
        user_id: str,
        file_ref: DriveFileRef,
    ) -> tuple[int | None, str | None, str | None]:
        if file_ref.kind == "tool_file":
            tool_file = self._require_tool_file_source(
                session,
                tenant_id=tenant_id,
                user_id=user_id,
                file_id=file_ref.id,
            )
            return tool_file.size, None, tool_file.mimetype
        upload_file = self._require_upload_file_source(session, tenant_id=tenant_id, file_id=file_ref.id)
        return upload_file.size, upload_file.hash, upload_file.mime_type

    @staticmethod
    def _require_tool_file_source(
        session: Session,
        *,
        tenant_id: str,
        user_id: str,
        file_id: str,
    ) -> ToolFile:
        try:
            tool_file = session.scalar(
                select(ToolFile).where(
                    ToolFile.id == file_id,
                    ToolFile.tenant_id == tenant_id,
                    ToolFile.user_id == user_id,
                )
            )
        except (DataError, SQLAlchemyError) as exc:
            session.rollback()
            raise AgentConfigServiceError("source_not_found", "source tool file ref is invalid", status_code=404) from exc
        if tool_file is None:
            raise AgentConfigServiceError(
                "source_not_found",
                "source ToolFile not found for this tenant/user",
                status_code=404,
            )
        return tool_file

    @staticmethod
    def _require_console_upload_file_source(session: Session, *, tenant_id: str, file_id: str) -> UploadFile:
        try:
            upload_file = session.scalar(
                select(UploadFile).where(
                    UploadFile.id == file_id,
                    UploadFile.tenant_id == tenant_id,
                )
            )
        except (DataError, SQLAlchemyError) as exc:
            session.rollback()
            raise AgentConfigServiceError(
                "upload_file_not_found",
                "upload file not found in this workspace",
                status_code=404,
            ) from exc
        if upload_file is None:
            raise AgentConfigServiceError(
                "upload_file_not_found",
                "upload file not found in this workspace",
                status_code=404,
            )
        return upload_file

    @staticmethod
    def _require_upload_file_source(session: Session, *, tenant_id: str, file_id: str) -> UploadFile:
        try:
            upload_file = session.scalar(
                select(UploadFile).where(
                    UploadFile.id == file_id,
                    UploadFile.tenant_id == tenant_id,
                )
            )
        except (DataError, SQLAlchemyError) as exc:
            session.rollback()
            raise AgentConfigServiceError("source_not_found", "source upload file ref is invalid", status_code=404) from exc
        if upload_file is None:
            raise AgentConfigServiceError(
                "source_not_found",
                "source UploadFile not found for this tenant",
                status_code=404,
            )
        return upload_file

    @staticmethod
    def _env_keys(agent_soul: AgentSoulConfig) -> list[str]:
        keys = [item.key or item.name or item.env_name or item.variable for item in agent_soul.env.variables]
        return [key for key in keys if key]

    @staticmethod
    def _apply_env_text(current: list[AgentEnvVariableConfig], env_text: str) -> list[AgentEnvVariableConfig]:
        updates = AgentConfigService._parse_env_text(env_text)
        order: list[str] = []
        by_key: dict[str, AgentEnvVariableConfig] = {}
        for item in current:
            key = AgentConfigService._env_variable_key(item)
            if key and key not in by_key:
                by_key[key] = item
                order.append(key)
        for key, value in updates:
            if value is None:
                by_key.pop(key, None)
                continue
            if key not in order:
                order.append(key)
            by_key[key] = AgentEnvVariableConfig(key=key, name=key, value=value)
        return [by_key[key] for key in order if key in by_key]

    @staticmethod
    def _env_variable_key(item: AgentEnvVariableConfig) -> str | None:
        for candidate in (item.key, item.name, item.env_name, item.variable):
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        return None

    @staticmethod
    def _parse_env_text(env_text: str) -> list[tuple[str, str | None]]:
        updates: list[tuple[str, str | None]] = []
        for raw_line in env_text.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line.removeprefix("export ").strip()
            if "=" not in line:
                raise AgentConfigServiceError("invalid_env_file", "env line must contain '='", status_code=400)
            key, raw_value = line.split("=", 1)
            key = key.strip()
            AgentConfigService._validate_env_key(key)
            if raw_value == "":
                updates.append((key, None))
                continue
            parsed = dotenv_values(stream=io.StringIO(f"{key}={raw_value}\n"))
            value = parsed.get(key)
            if value is None:
                raise AgentConfigServiceError("invalid_env_file", f"env value for {key} is invalid", status_code=400)
            updates.append((key, value))
        return updates

    @staticmethod
    def _validate_env_key(key: str) -> None:
        normalized = key.strip()
        if not normalized:
            raise AgentConfigServiceError("invalid_env_file", "env key must not be blank", status_code=400)
        if not (normalized[0].isalpha() or normalized[0] == "_"):
            raise AgentConfigServiceError("invalid_env_file", f"invalid env key {normalized!r}", status_code=400)
        if any(not (ch.isalnum() or ch == "_") for ch in normalized[1:]):
            raise AgentConfigServiceError("invalid_env_file", f"invalid env key {normalized!r}", status_code=400)

    @staticmethod
    def _manifest_for_target(target: AgentConfigTarget) -> dict[str, object]:
        return {
            "agent_id": target.agent_id,
            "config_version": {
                "id": target.version_id,
                "kind": target.kind.value,
                "writable": target.writable,
            },
            "skills": [
                {
                    "name": skill.name,
                    "description": skill.description,
                    "size": skill.size,
                    "hash": skill.hash,
                    "mime_type": skill.mime_type,
                }
                for skill in target.agent_soul.config_skills
            ],
            "files": [
                {
                    "name": file_ref.name,
                    "size": file_ref.size,
                    "hash": file_ref.hash,
                    "mime_type": file_ref.mime_type,
                }
                for file_ref in target.agent_soul.config_files
            ],
            "env_keys": AgentConfigService._env_keys(target.agent_soul),
            "note": target.agent_soul.config_note,
        }

    @staticmethod
    def _preview_bytes(*, key: str, size: int | None, payload: bytes) -> dict[str, object]:
        preview_max_bytes = 16384
        truncated = len(payload) > preview_max_bytes
        sample = payload[:preview_max_bytes]
        if b"\x00" in sample:
            return {"key": key, "size": size, "truncated": truncated, "binary": True, "text": None}
        try:
            text = sample.decode("utf-8")
        except UnicodeDecodeError:
            if truncated:
                try:
                    text = sample[:-3].decode("utf-8", errors="strict")
                except UnicodeDecodeError:
                    return {"key": key, "size": size, "truncated": truncated, "binary": True, "text": None}
            else:
                return {"key": key, "size": size, "truncated": truncated, "binary": True, "text": None}
        return {"key": key, "size": size, "truncated": truncated, "binary": False, "text": text}

    @staticmethod
    def _require_skill(agent_soul: AgentSoulConfig, *, name: str) -> AgentConfigSkillRefConfig:
        normalized = validate_config_skill_name(name)
        for item in agent_soul.config_skills:
            if item.name == normalized:
                return item
        raise AgentConfigServiceError("config_skill_not_found", "config skill not found", status_code=404)

    @staticmethod
    def _require_file(agent_soul: AgentSoulConfig, *, name: str) -> AgentConfigFileRefConfig:
        normalized = validate_config_name(name)
        for item in agent_soul.config_files:
            if item.name == normalized:
                return item
        raise AgentConfigServiceError("config_file_not_found", "config file not found", status_code=404)

    def _load_tool_file_bytes(self, *, tenant_id: str, file_id: str) -> tuple[bytes, str | None]:
        with session_factory.create_session() as session:
            tool_file = session.scalar(select(ToolFile).where(ToolFile.id == file_id, ToolFile.tenant_id == tenant_id))
        if tool_file is None:
            raise AgentConfigServiceError("config_skill_not_found", "config skill payload is missing", status_code=404)
        return storage.load_once(tool_file.file_key), tool_file.mimetype

    def _load_file_ref_bytes(
        self,
        *,
        tenant_id: str,
        file_kind: Literal["upload_file", "tool_file"],
        file_id: str,
    ) -> tuple[bytes, str | None, str | None]:
        with session_factory.create_session() as session:
            if file_kind == "tool_file":
                tool_file = session.scalar(
                    select(ToolFile).where(ToolFile.id == file_id, ToolFile.tenant_id == tenant_id)
                )
                if tool_file is None:
                    raise AgentConfigServiceError("config_file_not_found", "config file payload is missing", status_code=404)
                return storage.load_once(tool_file.file_key), tool_file.name, tool_file.mimetype
            upload_file = session.scalar(
                select(UploadFile).where(UploadFile.id == file_id, UploadFile.tenant_id == tenant_id)
            )
        if upload_file is None:
            raise AgentConfigServiceError("config_file_not_found", "config file payload is missing", status_code=404)
        return storage.load_once(upload_file.key), upload_file.name, upload_file.mime_type


__all__ = [
    "AgentConfigService",
    "AgentConfigServiceError",
    "AgentConfigMutationSurface",
    "AgentConfigTarget",
    "AgentConfigVersionKind",
    "ConfigDownload",
    "ConfigPushFileItem",
    "ConfigPushPayload",
    "ConfigPushSkillItem",
]
