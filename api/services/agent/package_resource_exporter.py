"""Collect and stream Agent assets for roster and workflow package exports."""

from __future__ import annotations

import hashlib
import os
import re
import zipfile
from collections.abc import Generator, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from constants import IMAGE_EXTENSIONS
from extensions.ext_storage import storage
from models.agent import Agent
from models.agent_config_entities import AgentSoulConfig
from models.model import UploadFile
from models.tools import ToolFile
from services.agent.dsl_entities import AgentPackage, AgentPackageWorkspaceSkill, make_portable_agent_package
from services.agent.errors import RosterAgentPackageExportFailedError, RosterAgentPackageTooLargeError
from services.agent.roster_package_entities import (
    AgentPackageResources,
    PackageIcon,
    RosterAgentPackageAudit,
    RosterAgentPackageFile,
    RosterAgentPackageSkill,
)
from services.agent.skill_package_service import SkillPackageError, SkillPackageService
from services.skill_management_service import SkillManagementService


class _Storage(Protocol):
    def load_stream(self, filename: str) -> Generator[bytes, None, None]: ...


@dataclass(frozen=True)
class _SkillSource:
    path: str
    storage_key: str
    id: str
    scope: Literal["agent_config", "workspace"]
    name: str
    audit_ref: str


@dataclass(frozen=True)
class _FileSource:
    path: str
    storage_key: str
    id: str
    audit_ref: str


class AgentPackageResourceExporter:
    """Collect database references, resolve workspace Skills, then stream the archive."""

    def __init__(self, *, storage_backend: _Storage = storage) -> None:
        self._storage = storage_backend
        self.sources: dict[str, tuple[list[_SkillSource], list[_FileSource]]] = {}
        self.icon_sources: dict[str, tuple[str, str]] = {}
        self.packages: dict[str, AgentPackage] = {}
        self._workspace_sources: dict[str, tuple[str, str, str | None, bool]] = {}

    def collect_package(
        self,
        *,
        session: Session,
        agent: Agent,
        soul: AgentSoulConfig,
        snapshot_id: str | None,
        package_ref: str,
        include_draft: bool = False,
    ) -> AgentPackage:
        soul, skills, files = self._collect_payloads(
            session=session,
            tenant_id=agent.tenant_id,
            soul=soul,
            skill_offset=sum(len(skills) for skills, _ in self.sources.values()),
            file_offset=sum(len(files) for _, files in self.sources.values()),
        )
        self.sources[package_ref] = skills, files
        package = make_portable_agent_package(agent, soul, include_assets=True)
        metadata = package.metadata.model_dump()
        self.collect_icon(session=session, tenant_id=agent.tenant_id, metadata=metadata)
        package.metadata.icon = metadata["icon"]
        self.packages[package_ref] = package
        self._workspace_sources[package_ref] = agent.tenant_id, agent.id, snapshot_id, include_draft
        return package

    def collect_icon(self, *, session: Session, tenant_id: str, metadata: dict[str, Any]) -> None:
        if metadata.get("icon_type") != "image" or not metadata.get("icon"):
            return
        file_id = metadata["icon"]
        if file_id not in self.icon_sources:
            upload = self._upload_files(session=session, tenant_id=tenant_id, file_ids=[file_id]).get(file_id)
            if upload is None:
                raise RosterAgentPackageExportFailedError("App icon payload is unavailable")
            extension = upload.extension.lower()
            if extension not in IMAGE_EXTENSIONS:
                raise RosterAgentPackageExportFailedError("App icon must be an image")
            resource_id = f"i_{len(self.icon_sources) + 1:06d}"
            self.icon_sources[file_id] = f"{resource_id}.{extension}", upload.key
        metadata["icon"] = self.icon_sources[file_id][0].split(".")[0]

    def write_icons(self, archive: zipfile.ZipFile, *, total_size: int) -> tuple[list[PackageIcon], int]:
        if len(archive.infolist()) + len(self.icon_sources) + 2 > dify_config.AGENT_PACKAGE_MAX_ENTRIES:
            raise RosterAgentPackageTooLargeError("Agent package has too many members")
        icons = []
        for path, key in self.icon_sources.values():
            size, digest = self._write_storage_member(
                archive,
                path=path,
                storage_key=key,
                max_bytes=min(
                    dify_config.AGENT_PACKAGE_MAX_BYTES - total_size,
                    dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024,
                ),
            )
            total_size += size
            icons.append(PackageIcon(id=path.split(".")[0], path=path, size=size, sha256=digest))
        return icons, total_size

    def collect_workspace_skills(self) -> None:
        """Resolve legacy Skill metadata after the caller closes its database read session."""
        for ref, (tenant_id, agent_id, snapshot_id, include_draft) in self._workspace_sources.items():
            package = self.packages[ref]
            archives = SkillManagementService().list_runtime_agent_skill_archives(
                tenant_id=tenant_id,
                agent_id=agent_id,
                config_snapshot_id=snapshot_id,
                include_draft=include_draft,
            )
            skill_sources = self.sources[ref][0]
            skill_index = sum(len(skills) for skills, _ in self.sources.values())
            names = {item.name for item in package.soul.config_skills if not item.is_missing}
            for archive in sorted(archives, key=lambda item: item.priority):
                if archive.name in names:
                    continue
                names.add(archive.name)
                skill_index += 1
                resource_id = f"s_{skill_index:06d}"
                skill_sources.append(
                    _SkillSource(
                        path=f"{resource_id}.zip",
                        storage_key=archive.storage_key,
                        id=resource_id,
                        scope="workspace",
                        name=archive.name,
                        audit_ref=archive.version_id,
                    )
                )
                package.workspace_skills.append(
                    AgentPackageWorkspaceSkill(
                        name=archive.name,
                        display_name=archive.display_name,
                        description=archive.description,
                        priority=archive.priority,
                    )
                )
        self._workspace_sources.clear()

    def write_resources(self, archive: zipfile.ZipFile) -> tuple[dict[str, AgentPackageResources], int]:
        entry_count = sum(len(skills) + len(files) for skills, files in self.sources.values()) + 2
        if entry_count > dify_config.AGENT_PACKAGE_MAX_ENTRIES:
            raise RosterAgentPackageTooLargeError("Agent package has too many members")
        total_size = 0
        nested_uncompressed_size = 0
        skill_packages = SkillPackageService()
        resources: dict[str, AgentPackageResources] = {}
        for ref, (skill_sources, file_sources) in self.sources.items():
            skills: list[RosterAgentPackageSkill] = []
            files: list[RosterAgentPackageFile] = []
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
            resources[ref] = AgentPackageResources(skills=skills, files=files)
        return resources, total_size

    def _collect_payloads(
        self,
        *,
        session: Session,
        tenant_id: str,
        soul: AgentSoulConfig,
        skill_offset: int = 0,
        file_offset: int = 0,
    ) -> tuple[AgentSoulConfig, list[_SkillSource], list[_FileSource]]:
        resource_data = soul.model_dump(mode="json")
        skill_sources: list[_SkillSource] = []
        file_sources: list[_FileSource] = []

        skill_file_ids = [item.file_id for item in soul.config_skills if not item.is_missing]
        tool_files = self._tool_files(session=session, tenant_id=tenant_id, file_ids=skill_file_ids)
        for skill_ref, portable_skill_ref in zip(soul.config_skills, resource_data["config_skills"]):
            if skill_ref.is_missing:
                continue
            resource_id = f"s_{skill_offset + len(skill_sources) + 1:06d}"
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
            resource_id = f"f_{file_offset + len(file_sources) + 1:06d}"
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
