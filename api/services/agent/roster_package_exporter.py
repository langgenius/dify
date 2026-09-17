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

import yaml
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from configs import dify_config
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
from services.agent.dsl_entities import (
    AgentAppDsl,
    AgentPackageWorkspaceSkill,
    make_agent_app_dsl,
    make_portable_agent_package,
)
from services.agent.errors import (
    AgentNotFoundError,
    AgentVersionNotFoundError,
    RosterAgentPackageExportFailedError,
    RosterAgentPackageTooLargeError,
)
from services.agent.roster_package_entities import (
    ROSTER_AGENT_PACKAGE_FORMAT,
    ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
    RosterAgentPackageApp,
    RosterAgentPackageAudit,
    RosterAgentPackageExport,
    RosterAgentPackageFile,
    RosterAgentPackageManifest,
    RosterAgentPackageSkill,
)
from services.agent.skill_package_service import SkillPackageError, SkillPackageService
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from services.skill_management_service import RuntimeAgentSkillArchive, SkillManagementService


class _Storage(Protocol):
    def load_stream(self, filename: str) -> Generator[bytes, None, None]: ...


@dataclass(frozen=True)
class _SkillSource:
    path: str
    storage_key: str
    id: str
    scope: Literal["agent_config", "workspace"]
    name: str
    display_name: str | None
    description: str
    priority: int | None
    audit_ref: str


@dataclass(frozen=True)
class _FileSource:
    path: str
    storage_key: str
    id: str
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
            row = session.execute(
                select(Agent, App)
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
            ).one_or_none()
            if row is None:
                raise AgentNotFoundError()
            agent, app_model = row

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

            resource_soul, skill_sources, file_sources = self._collect_payloads(
                session=session,
                tenant_id=tenant_id,
                soul=soul,
            )
            package = make_portable_agent_package(agent, resource_soul, include_assets=True)
            app = make_agent_app_dsl(app_model, package_ref="agent_1", packages={"agent_1": package}, dependencies=[])
            audit = RosterAgentPackageAudit(ref=agent.id)
            dependency_ids = extract_agent_soul_dependencies(package.soul)

        workspace_skills = SkillManagementService().list_runtime_agent_skill_archives(
            tenant_id=tenant_id,
            agent_id=agent_id,
            include_draft=draft is not None,
        )
        skill_sources.extend(
            self._workspace_skill_sources(
                soul=package.soul,
                archives=workspace_skills,
                start_index=len(skill_sources),
            )
        )
        package.workspace_skills = [
            AgentPackageWorkspaceSkill(
                name=item.name,
                display_name=item.display_name or "",
                description=item.description,
                priority=item.priority,
            )
            for item in skill_sources
            if item.scope == "workspace" and item.priority is not None
        ]
        app.dependencies = self._dependency_provider(tenant_id, dependency_ids)
        return self._build_archive(
            app=app,
            audit=audit,
            skill_sources=skill_sources,
            file_sources=file_sources,
        )

    def _build_archive(
        self,
        *,
        app: AgentAppDsl,
        skill_sources: Sequence[_SkillSource],
        file_sources: Sequence[_FileSource],
        audit: RosterAgentPackageAudit | None = None,
    ) -> RosterAgentPackageExport:
        required_entries = len(skill_sources) + len(file_sources) + 2
        if required_entries > dify_config.AGENT_PACKAGE_MAX_ENTRIES:
            raise RosterAgentPackageTooLargeError("Roster Agent package has too many members")

        # Ownership is transferred to RosterAgentPackageExport.
        output = cast(
            BinaryIO,
            tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b"),  # noqa: SIM115
        )
        try:
            skills: list[RosterAgentPackageSkill] = []
            files: list[RosterAgentPackageFile] = []
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                total_size = 0
                nested_uncompressed_size = 0
                skill_packages = SkillPackageService()
                sources: list[_SkillSource | _FileSource] = [*skill_sources, *file_sources]
                for source in sources:
                    remaining_bytes = dify_config.AGENT_PACKAGE_MAX_BYTES - total_size
                    if isinstance(source, _SkillSource):
                        remaining_bytes = min(remaining_bytes, dify_config.UPLOAD_SKILL_FILE_SIZE_LIMIT * 1024 * 1024)
                    member_size, member_digest = self._write_storage_member(
                        archive, path=source.path, storage_key=source.storage_key, max_bytes=remaining_bytes
                    )
                    total_size += member_size
                    if isinstance(source, _SkillSource):
                        # Inspect only the embedded Skill; our writer already owns
                        # the outer container, resource sizes, and digests.
                        try:
                            inspection = skill_packages.inspect(content=archive.read(source.path), filename=source.path)
                        except SkillPackageError as exc:
                            raise RosterAgentPackageExportFailedError(
                                f"Roster Agent package contains unusable Skill {source.name!r}"
                            ) from exc
                        if inspection.name != source.name:
                            raise RosterAgentPackageExportFailedError(
                                f"Roster Agent package contains unusable Skill {source.name!r}: name mismatch"
                            )
                        nested_uncompressed_size += inspection.uncompressed_size
                        if nested_uncompressed_size > dify_config.AGENT_PACKAGE_MAX_BYTES:
                            raise RosterAgentPackageTooLargeError(
                                "Roster Agent package nested Skill contents exceed the size limit"
                            )

                        skills.append(
                            RosterAgentPackageSkill(
                                id=source.id,
                                scope=source.scope,
                                name=source.name,
                                path=source.path,
                                size=member_size,
                                sha256=member_digest,
                                audit=RosterAgentPackageAudit(ref=source.audit_ref),
                            )
                        )
                    else:
                        files.append(
                            RosterAgentPackageFile(
                                id=source.id,
                                path=source.path,
                                size=member_size,
                                sha256=member_digest,
                                audit=RosterAgentPackageAudit(ref=source.audit_ref),
                            )
                        )

                app_bytes = yaml.safe_dump(
                    app.model_dump(mode="json", exclude_none=True), allow_unicode=True, sort_keys=False
                ).encode("utf-8")
                manifest = RosterAgentPackageManifest(
                    format=ROSTER_AGENT_PACKAGE_FORMAT,
                    format_version=ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
                    audit=audit,
                    apps=[
                        RosterAgentPackageApp(
                            path="app.yaml", size=len(app_bytes), sha256=hashlib.sha256(app_bytes).hexdigest()
                        )
                    ],
                    skills=skills,
                    files=files,
                )
                manifest.validate_apps({"app.yaml": app})
                manifest_bytes = yaml.safe_dump(
                    manifest.model_dump(mode="json", exclude_none=True), allow_unicode=True, sort_keys=False
                ).encode("utf-8")
                for path, document_bytes in (("app.yaml", app_bytes), ("manifest.yaml", manifest_bytes)):
                    if len(document_bytes) > dify_config.AGENT_PACKAGE_MAX_MANIFEST_BYTES:
                        raise RosterAgentPackageTooLargeError(f"Roster Agent package {path} exceeds the size limit")
                    total_size += len(document_bytes)
                    if total_size > dify_config.AGENT_PACKAGE_MAX_BYTES:
                        raise RosterAgentPackageTooLargeError("Roster Agent package exceeds the size limit")
                    archive.writestr(path, document_bytes)

            size = output.tell()
            if size > dify_config.AGENT_PACKAGE_MAX_BYTES:
                raise RosterAgentPackageTooLargeError("Roster Agent package exceeds the archive size limit")
            output.seek(0)
            return RosterAgentPackageExport(
                archive=output,
                filename=f"{self._safe_slug(app.package.metadata.name)}.ifpkg",
                size=size,
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
        resource_data = soul.model_dump(mode="json")
        skill_sources: list[_SkillSource] = []
        file_sources: list[_FileSource] = []

        skill_file_ids = [item.file_id for item in soul.config_skills if not item.is_missing]
        tool_files = self._tool_files(session=session, tenant_id=tenant_id, file_ids=skill_file_ids)
        for skill_ref, portable_skill_ref in zip(soul.config_skills, resource_data["config_skills"]):
            if skill_ref.is_missing:
                continue
            resource_id = f"s_{len(skill_sources) + 1:06d}"
            tool_file = tool_files.get(skill_ref.file_id)
            if tool_file is None:
                raise RosterAgentPackageExportFailedError(f"Config skill {skill_ref.name!r} payload is unavailable")
            path = f"{resource_id}.zip"
            portable_skill_ref["file_id"] = resource_id
            portable_skill_ref["is_missing"] = False
            skill_sources.append(
                _SkillSource(
                    path=path,
                    storage_key=tool_file.file_key,
                    id=resource_id,
                    scope="agent_config",
                    name=skill_ref.name,
                    display_name=None,
                    description=skill_ref.description,
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
        for file_ref, portable_file_ref in zip(soul.config_files, resource_data["config_files"]):
            if file_ref.is_missing:
                continue
            resource_id = f"f_{len(file_sources) + 1:06d}"
            extension = self._safe_extension(file_ref.name)
            path = f"{resource_id}{extension}"
            if file_ref.file_kind == "tool_file":
                tool_file = file_tool_files.get(file_ref.file_id)
                if tool_file is None:
                    raise RosterAgentPackageExportFailedError(f"Config file {file_ref.name!r} payload is unavailable")
                storage_key = tool_file.file_key
                mime_type = file_ref.mime_type or tool_file.mimetype
                audit_ref = tool_file.id
            else:
                upload_file = upload_files.get(file_ref.file_id)
                if upload_file is None:
                    raise RosterAgentPackageExportFailedError(f"Config file {file_ref.name!r} payload is unavailable")
                storage_key = upload_file.key
                mime_type = file_ref.mime_type or upload_file.mime_type
                audit_ref = upload_file.id
            portable_file_ref["file_id"] = resource_id
            portable_file_ref["is_missing"] = False
            portable_file_ref["mime_type"] = mime_type or "application/octet-stream"
            file_sources.append(
                _FileSource(
                    path=path,
                    storage_key=storage_key,
                    id=resource_id,
                    audit_ref=audit_ref,
                )
            )

        return AgentSoulConfig.model_validate(resource_data), skill_sources, file_sources

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
                    path=path,
                    storage_key=archive.storage_key,
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

    def _write_storage_member(
        self,
        archive: zipfile.ZipFile,
        *,
        path: str,
        storage_key: str,
        max_bytes: int,
    ) -> tuple[int, str]:
        digest = hashlib.sha256()
        size = 0
        try:
            with archive.open(path, "w", force_zip64=True) as target:
                for chunk in self._storage.load_stream(storage_key):
                    if not isinstance(chunk, bytes):
                        raise TypeError("storage stream returned a non-bytes chunk")
                    if size + len(chunk) > max_bytes:
                        raise RosterAgentPackageTooLargeError("Roster Agent package payload exceeds the size limit")
                    size += len(chunk)
                    digest.update(chunk)
                    target.write(chunk)
        except RosterAgentPackageTooLargeError:
            raise
        except Exception as exc:
            raise RosterAgentPackageExportFailedError(f"Unable to read package resource {path!r}") from exc
        return size, digest.hexdigest()

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
