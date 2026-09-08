"""Export active Roster Agents as portable ``.ifpkg`` archives."""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
import zipfile
from collections.abc import Callable, Generator, Sequence
from dataclasses import dataclass
from typing import BinaryIO, Literal, Protocol, cast

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.plugin.entities.plugin import PluginDependency
from extensions.ext_storage import storage
from models.agent import (
    APP_BACKED_AGENT_SOURCES,
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentScope,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus
from models.model import App, AppMode, UploadFile
from models.tools import ToolFile
from services.agent.dependency_service import extract_agent_soul_dependencies
from services.agent.dsl_entities import make_portable_agent_soul
from services.agent.errors import (
    AgentNotFoundError,
    AgentVersionNotFoundError,
    RosterAgentPackageExportFailedError,
    RosterAgentPackageTooLargeError,
)
from services.agent.roster_package_entities import (
    ROSTER_AGENT_PACKAGE_FORMAT,
    ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
    ROSTER_AGENT_PACKAGE_MAX_BYTES,
    ROSTER_AGENT_PACKAGE_MAX_ENTRIES,
    ROSTER_AGENT_PACKAGE_MAX_MANIFEST_BYTES,
    RosterAgentPackageAudit,
    RosterAgentPackageExport,
    RosterAgentPackageFile,
    RosterAgentPackageManifest,
    RosterAgentPackageMember,
    RosterAgentPackageMetadata,
    RosterAgentPackageSkill,
)
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from services.skill_management_service import RuntimeAgentSkillArchive, SkillManagementService


class _Storage(Protocol):
    def load_stream(self, filename: str) -> Generator[bytes, None, None]: ...


@dataclass(frozen=True)
class _PayloadSource:
    path: str
    storage_key: str


@dataclass(frozen=True)
class _SkillSource:
    payload: _PayloadSource
    id: str
    scope: Literal["agent_config", "workspace"]
    name: str
    display_name: str | None
    description: str
    priority: int | None
    audit_ref: str


@dataclass(frozen=True)
class _FileSource:
    payload: _PayloadSource
    id: str
    original_name: str
    mime_type: str
    audit_ref: str


class RosterAgentPackageExporter:
    """Collect a Roster Agent through a dedicated read Session and build its archive."""

    def __init__(
        self,
        *,
        storage_backend: _Storage = storage,
        dependency_provider: Callable[[str, list[str]], list[PluginDependency]] | None = None,
    ) -> None:
        self._storage = storage_backend
        self._dependency_provider = dependency_provider or DependenciesAnalysisService.generate_dependencies

    def export(self, *, tenant_id: str, agent_id: str) -> RosterAgentPackageExport:
        with session_factory.create_session() as session:
            agent = session.scalar(
                select(Agent)
                .join(
                    App,
                    (App.id == Agent.app_id) & (App.tenant_id == Agent.tenant_id),
                )
                .where(
                    Agent.id == agent_id,
                    Agent.tenant_id == tenant_id,
                    Agent.scope == AgentScope.ROSTER,
                    Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                    Agent.status == AgentStatus.ACTIVE,
                    Agent.app_id.is_not(None),
                    or_(Agent.backing_app_id == Agent.app_id, Agent.backing_app_id.is_(None)),
                    App.mode == AppMode.AGENT,
                    App.status == AppStatus.NORMAL,
                )
                .limit(1)
            )
            if agent is None:
                raise AgentNotFoundError()

            draft = session.scalar(
                select(AgentConfigDraft)
                .where(
                    AgentConfigDraft.tenant_id == tenant_id,
                    AgentConfigDraft.agent_id == agent.id,
                    AgentConfigDraft.draft_type == AgentConfigDraftType.DRAFT,
                    AgentConfigDraft.draft_owner_key == "",
                )
                .limit(1)
            )
            if draft is not None:
                soul = AgentSoulConfig.model_validate(draft.config_snapshot_dict)
            else:
                snapshot = session.scalar(
                    select(AgentConfigSnapshot)
                    .where(
                        AgentConfigSnapshot.id == agent.active_config_snapshot_id,
                        AgentConfigSnapshot.tenant_id == tenant_id,
                        AgentConfigSnapshot.agent_id == agent.id,
                    )
                    .limit(1)
                )
                if snapshot is None:
                    raise AgentVersionNotFoundError()
                soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)

            portable_soul, skill_sources, file_sources = self._collect_payloads(
                session=session,
                tenant_id=tenant_id,
                soul=soul,
            )
            metadata = RosterAgentPackageMetadata(
                name=agent.name,
                description=agent.description or "",
                role=agent.role or "",
                audit=RosterAgentPackageAudit(ref=agent.id),
            )
            dependency_ids = extract_agent_soul_dependencies(portable_soul)

        workspace_skills = SkillManagementService().list_runtime_agent_skill_archives(
            tenant_id=tenant_id,
            agent_id=agent_id,
            include_draft=draft is not None,
        )
        skill_sources.extend(
            self._workspace_skill_sources(
                soul=portable_soul,
                archives=workspace_skills,
                start_index=len(skill_sources),
            )
        )
        dependencies = self._dependency_provider(tenant_id, dependency_ids)
        return self._build_archive(
            metadata=metadata,
            soul=portable_soul,
            skill_sources=skill_sources,
            file_sources=file_sources,
            dependencies=dependencies,
        )

    def _build_archive(
        self,
        *,
        metadata: RosterAgentPackageMetadata,
        soul: AgentSoulConfig,
        skill_sources: Sequence[_SkillSource],
        file_sources: Sequence[_FileSource],
        dependencies: list[PluginDependency],
    ) -> RosterAgentPackageExport:
        required_entries = len(skill_sources) + len(file_sources) + 1
        if required_entries > ROSTER_AGENT_PACKAGE_MAX_ENTRIES:
            raise RosterAgentPackageTooLargeError("Roster Agent package has too many members")

        # Ownership is transferred to RosterAgentPackageExport.
        output = cast(
            BinaryIO,
            tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b"),  # noqa: SIM115
        )
        try:
            member_metadata: dict[str, RosterAgentPackageMember] = {}
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                total_size = 0
                for payload in [
                    *(item.payload for item in skill_sources),
                    *(item.payload for item in file_sources),
                ]:
                    member = self._write_storage_member(archive, payload)
                    total_size += member.size
                    if total_size > ROSTER_AGENT_PACKAGE_MAX_BYTES:
                        raise RosterAgentPackageTooLargeError("Roster Agent package payloads exceed the size limit")
                    member_metadata[payload.path] = member

                manifest = RosterAgentPackageManifest(
                    format=ROSTER_AGENT_PACKAGE_FORMAT,
                    format_version=ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
                    metadata=metadata,
                    soul=soul,
                    skills=[
                        RosterAgentPackageSkill(
                            id=item.id,
                            scope=item.scope,
                            name=item.name,
                            display_name=item.display_name,
                            description=item.description,
                            priority=item.priority,
                            path=item.payload.path,
                            size=member_metadata[item.payload.path].size,
                            sha256=member_metadata[item.payload.path].sha256,
                            audit=RosterAgentPackageAudit(ref=item.audit_ref),
                        )
                        for item in skill_sources
                    ],
                    files=[
                        RosterAgentPackageFile(
                            id=item.id,
                            role="agent_config_file",
                            path=item.payload.path,
                            original_name=item.original_name,
                            mime_type=item.mime_type,
                            size=member_metadata[item.payload.path].size,
                            sha256=member_metadata[item.payload.path].sha256,
                            audit=RosterAgentPackageAudit(ref=item.audit_ref),
                        )
                        for item in file_sources
                    ],
                    dependencies=dependencies,
                )
                manifest_bytes = manifest.model_dump_json(indent=2, exclude_none=True).encode("utf-8")
                if len(manifest_bytes) > ROSTER_AGENT_PACKAGE_MAX_MANIFEST_BYTES:
                    raise RosterAgentPackageTooLargeError("Roster Agent package manifest exceeds the size limit")
                if total_size + len(manifest_bytes) > ROSTER_AGENT_PACKAGE_MAX_BYTES:
                    raise RosterAgentPackageTooLargeError("Roster Agent package exceeds the size limit")
                archive.writestr("manifest.json", manifest_bytes)

            size = output.tell()
            if size > ROSTER_AGENT_PACKAGE_MAX_BYTES:
                raise RosterAgentPackageTooLargeError("Roster Agent package exceeds the archive size limit")
            output.seek(0)
            return RosterAgentPackageExport(
                archive=output,
                filename=f"{self._safe_slug(metadata.name)}.ifpkg",
                size=size,
                manifest=manifest,
            )
        except Exception:
            output.close()
            raise

    def _collect_payloads(
        self,
        *,
        session: Session,
        tenant_id: str,
        soul: AgentSoulConfig,
    ) -> tuple[AgentSoulConfig, list[_SkillSource], list[_FileSource]]:
        portable_data = make_portable_agent_soul(soul).model_dump(mode="json")
        skill_sources: list[_SkillSource] = []
        file_sources: list[_FileSource] = []

        skill_file_ids = [item.file_id for item in soul.config_skills if not item.is_missing]
        tool_files = self._tool_files(session=session, tenant_id=tenant_id, file_ids=skill_file_ids)
        for ref, portable_ref in zip(soul.config_skills, portable_data["config_skills"]):
            if ref.is_missing:
                continue
            resource_id = f"s_{len(skill_sources) + 1:06d}"
            tool_file = tool_files.get(ref.file_id)
            if tool_file is None:
                raise RosterAgentPackageExportFailedError(f"Config skill {ref.name!r} payload is unavailable")
            path = f"{resource_id}.zip"
            portable_ref["file_id"] = resource_id
            portable_ref["is_missing"] = False
            skill_sources.append(
                _SkillSource(
                    payload=_PayloadSource(path, tool_file.file_key),
                    id=resource_id,
                    scope="agent_config",
                    name=ref.name,
                    display_name=None,
                    description=ref.description,
                    priority=None,
                    audit_ref=tool_file.id,
                )
            )

        tool_file_refs = [
            item.file_id for item in soul.config_files if not item.is_missing and item.file_kind == "tool_file"
        ]
        upload_file_refs = [
            item.file_id for item in soul.config_files if not item.is_missing and item.file_kind == "upload_file"
        ]
        file_tool_files = self._tool_files(session=session, tenant_id=tenant_id, file_ids=tool_file_refs)
        upload_files = self._upload_files(session=session, tenant_id=tenant_id, file_ids=upload_file_refs)
        for ref, portable_ref in zip(soul.config_files, portable_data["config_files"]):
            if ref.is_missing:
                continue
            resource_id = f"f_{len(file_sources) + 1:06d}"
            extension = self._safe_extension(ref.name)
            path = f"{resource_id}{extension}"
            if ref.file_kind == "tool_file":
                record = file_tool_files.get(ref.file_id)
                storage_key = record.file_key if record else None
                mime_type = ref.mime_type or (record.mimetype if record else None)
            else:
                record = upload_files.get(ref.file_id)
                storage_key = record.key if record else None
                mime_type = ref.mime_type or (record.mime_type if record else None)
            if record is None or storage_key is None:
                raise RosterAgentPackageExportFailedError(f"Config file {ref.name!r} payload is unavailable")
            portable_ref["file_id"] = resource_id
            portable_ref["is_missing"] = False
            file_sources.append(
                _FileSource(
                    payload=_PayloadSource(path, storage_key),
                    id=resource_id,
                    original_name=ref.name,
                    mime_type=mime_type or "application/octet-stream",
                    audit_ref=record.id,
                )
            )

        return AgentSoulConfig.model_validate(portable_data), skill_sources, file_sources

    @staticmethod
    def _workspace_skill_sources(
        *, soul: AgentSoulConfig, archives: Sequence[RuntimeAgentSkillArchive], start_index: int
    ) -> list[_SkillSource]:
        sources: list[_SkillSource] = []
        effective_skill_names = {item.name for item in soul.config_skills if not item.is_missing}
        for archive in sorted(archives, key=lambda item: item.priority):
            if archive.name in effective_skill_names:
                continue
            effective_skill_names.add(archive.name)
            resource_id = f"s_{start_index + len(sources) + 1:06d}"
            path = f"{resource_id}.zip"
            sources.append(
                _SkillSource(
                    payload=_PayloadSource(path, archive.storage_key),
                    id=resource_id,
                    scope="workspace",
                    name=archive.name,
                    display_name=archive.display_name,
                    description=archive.description,
                    priority=archive.priority,
                    audit_ref=archive.version_id,
                )
            )
        return sources

    @staticmethod
    def _tool_files(*, session: Session, tenant_id: str, file_ids: Sequence[str]) -> dict[str, ToolFile]:
        if not file_ids:
            return {}
        rows = session.scalars(
            select(ToolFile).where(ToolFile.tenant_id == tenant_id, ToolFile.id.in_(set(file_ids)))
        ).all()
        return {item.id: item for item in rows}

    @staticmethod
    def _upload_files(*, session: Session, tenant_id: str, file_ids: Sequence[str]) -> dict[str, UploadFile]:
        if not file_ids:
            return {}
        rows = session.scalars(
            select(UploadFile).where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(set(file_ids)))
        ).all()
        return {item.id: item for item in rows}

    def _write_storage_member(self, archive: zipfile.ZipFile, payload: _PayloadSource) -> RosterAgentPackageMember:
        digest = hashlib.sha256()
        size = 0
        try:
            with archive.open(payload.path, "w", force_zip64=True) as target:
                for chunk in self._storage.load_stream(payload.storage_key):
                    if not isinstance(chunk, bytes):
                        raise TypeError("storage stream returned a non-bytes chunk")
                    size += len(chunk)
                    if size > ROSTER_AGENT_PACKAGE_MAX_BYTES:
                        raise RosterAgentPackageTooLargeError("Roster Agent package payload exceeds the size limit")
                    digest.update(chunk)
                    target.write(chunk)
        except RosterAgentPackageTooLargeError:
            raise
        except Exception as exc:
            raise RosterAgentPackageExportFailedError(f"Unable to read package resource {payload.path!r}") from exc
        return RosterAgentPackageMember(path=payload.path, size=size, sha256=digest.hexdigest())

    @staticmethod
    def _safe_extension(filename: str) -> str:
        extension = os.path.splitext(filename)[1].lower()
        if not extension or not re.fullmatch(r"\.[a-z0-9]{1,16}", extension):
            return ".bin"
        return extension

    @staticmethod
    def _safe_slug(name: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        return slug[:80] or "agent"


__all__ = ["RosterAgentPackageExporter"]
