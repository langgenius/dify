"""Validate and export portable Roster Agent ``.ifpkg`` archives.

This module owns the archive boundary only. Import materialization, HTTP
transport, and package signatures are deliberately outside the first phase.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import posixpath
import re
import stat
import tempfile
import zipfile
import zlib
from collections.abc import Callable, Generator, Sequence
from dataclasses import dataclass
from typing import Any, BinaryIO, Literal, Protocol, cast

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
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
from models.skill import AgentSkillBinding, AgentSkillBindingSnapshot, Skill, SkillVersion
from models.tools import ToolFile
from services.agent.dependency_service import extract_agent_soul_dependencies
from services.agent.dsl_entities import make_portable_agent_soul
from services.agent.roster_package_entities import (
    RosterAgentPackageAudit,
    RosterAgentPackageFile,
    RosterAgentPackageManifest,
    RosterAgentPackageMetadata,
    RosterAgentPackageSkill,
)
from services.agent.skill_package_service import SkillPackageError, SkillPackageService
from services.plugin.dependencies_analysis import DependenciesAnalysisService

_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
_MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
_MAX_MANIFEST_BYTES = 1024 * 1024
_MAX_SIGNATURE_BYTES = 64 * 1024
_MAX_ENTRIES = 5000
_MAX_COMPRESSION_RATIO = 1000
_COPY_CHUNK_SIZE = 1024 * 1024
_ALLOWED_COMPRESSIONS = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}


class _Storage(Protocol):
    def load_stream(self, filename: str) -> Generator[bytes, None, None]: ...


class RosterAgentPackageError(Exception):
    code: str
    message: str
    status_code: int

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class RosterAgentPackageMember:
    path: str
    size: int
    sha256: str


@dataclass
class PreparedRosterAgentPackage:
    """Validated archive retained in a bounded spool for later materialization."""

    archive: BinaryIO
    manifest: RosterAgentPackageManifest
    members: dict[str, RosterAgentPackageMember]

    def close(self) -> None:
        self.archive.close()

    def __enter__(self) -> PreparedRosterAgentPackage:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


@dataclass
class RosterAgentPackageExport:
    archive: BinaryIO
    filename: str
    size: int
    manifest: RosterAgentPackageManifest

    def close(self) -> None:
        self.archive.close()

    def __enter__(self) -> RosterAgentPackageExport:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


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


class RosterAgentPackageService:
    """Own strict package validation and side-effect-free archive export."""

    def __init__(
        self,
        session: Session,
        *,
        storage_backend: _Storage = storage,
        skill_package_service: SkillPackageService | None = None,
        dependency_provider: Callable[[str, list[str]], list[PluginDependency]] | None = None,
    ) -> None:
        self._session = session
        self._storage = storage_backend
        self._skill_packages = skill_package_service or SkillPackageService()
        self._dependency_provider = dependency_provider or DependenciesAnalysisService.generate_dependencies

    def preflight(self, source: BinaryIO) -> PreparedRosterAgentPackage:
        """Fully validate an uploaded archive without external or database writes."""

        # Ownership is transferred to PreparedRosterAgentPackage.
        spool = cast(
            BinaryIO,
            tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b"),  # noqa: SIM115
        )
        try:
            self._copy_bounded(source, spool)
            spool.seek(0)
            manifest, members = self._validate_archive(spool)
            spool.seek(0)
            return PreparedRosterAgentPackage(archive=spool, manifest=manifest, members=members)
        except Exception:
            spool.close()
            raise

    def export(self, *, tenant_id: str, agent_id: str) -> RosterAgentPackageExport:
        """Build a portable package for one active app-backed Roster Agent.

        Export requires a clean request session. All ORM state is projected to
        immutable package values before the read transaction is released and
        object storage is accessed.
        """

        if self._session.new or self._session.dirty or self._session.deleted:
            raise RuntimeError("Roster Agent package export requires a clean database session")

        agent = self._session.scalar(
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
                Agent.backing_app_id == Agent.app_id,
                App.mode == AppMode.AGENT,
                App.status == AppStatus.NORMAL,
            )
            .limit(1)
        )
        if agent is None:
            raise RosterAgentPackageError("agent_not_found", "Roster Agent is unavailable", status_code=404)

        draft = self._session.scalar(
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
            snapshot = self._session.scalar(
                select(AgentConfigSnapshot)
                .where(
                    AgentConfigSnapshot.id == agent.active_config_snapshot_id,
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    AgentConfigSnapshot.agent_id == agent.id,
                )
                .limit(1)
            )
            if snapshot is None:
                raise RosterAgentPackageError(
                    "agent_config_unavailable", "Roster Agent has no exportable configuration", status_code=409
                )
            soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)

        portable_soul, skill_sources, file_sources = self._collect_payloads(
            tenant_id=tenant_id,
            agent=agent,
            soul=soul,
            draft=draft,
        )
        metadata = RosterAgentPackageMetadata(
            name=agent.name,
            description=agent.description or "",
            role=agent.role or "",
            audit=RosterAgentPackageAudit(ref=agent.id),
        )
        dependency_ids = extract_agent_soul_dependencies(portable_soul)
        if self._session.in_transaction():
            self._session.rollback()
        dependencies = self._dependency_provider(tenant_id, dependency_ids)

        # Ownership is transferred to RosterAgentPackageExport.
        output = cast(
            BinaryIO,
            tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b"),  # noqa: SIM115
        )
        try:
            member_metadata: dict[str, RosterAgentPackageMember] = {}
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                total_size = 0
                for payload in [
                    *(item.payload for item in skill_sources),
                    *(item.payload for item in file_sources),
                ]:
                    member = self._write_storage_member(archive, payload)
                    total_size += member.size
                    if total_size > _MAX_UNCOMPRESSED_BYTES:
                        raise RosterAgentPackageError(
                            "package_too_large", "Roster Agent package payloads exceed the size limit", status_code=413
                        )
                    member_metadata[payload.path] = member

                skills = [
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
                ]
                files = [
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
                ]
                manifest = RosterAgentPackageManifest(
                    metadata=metadata,
                    soul=portable_soul,
                    skills=skills,
                    files=files,
                    dependencies=dependencies,
                )
                archive.writestr(
                    "manifest.json",
                    manifest.model_dump_json(indent=2, exclude_none=True).encode("utf-8"),
                )

            size = output.tell()
            if size > _MAX_ARCHIVE_BYTES:
                raise RosterAgentPackageError(
                    "package_too_large", "Roster Agent package exceeds the archive size limit", status_code=413
                )
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
        tenant_id: str,
        agent: Agent,
        soul: AgentSoulConfig,
        draft: AgentConfigDraft | None,
    ) -> tuple[
        AgentSoulConfig,
        list[_SkillSource],
        list[_FileSource],
    ]:
        portable_data = make_portable_agent_soul(soul).model_dump(mode="json")
        skill_sources: list[_SkillSource] = []
        file_sources: list[_FileSource] = []

        skill_file_ids = [item.file_id for item in soul.config_skills if item.file_id and not item.is_missing]
        if len(skill_file_ids) != len(soul.config_skills):
            raise RosterAgentPackageError(
                "resource_unavailable", "Roster Agent contains a missing config skill", status_code=409
            )
        tool_files = self._tool_files(tenant_id=tenant_id, file_ids=skill_file_ids)
        for index, (ref, portable_ref) in enumerate(zip(soul.config_skills, portable_data["config_skills"]), start=1):
            resource_id = f"s_{index:06d}"
            tool_file = tool_files.get(ref.file_id)
            if tool_file is None:
                raise RosterAgentPackageError(
                    "resource_unavailable", f"Config skill {ref.name!r} payload is unavailable", status_code=409
                )
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

        workspace_rows = self._workspace_skill_rows(
            tenant_id=tenant_id,
            agent_id=agent.id,
            snapshot_id=agent.active_config_snapshot_id,
            include_draft=draft is not None,
        )
        effective_skill_names = {item.name for item in soul.config_skills}
        for binding, skill in workspace_rows:
            if skill.name in effective_skill_names:
                raise RosterAgentPackageError(
                    "duplicate_skill_name",
                    f"Workspace and config Skills share the name {skill.name!r}",
                    status_code=409,
                )
            effective_skill_names.add(skill.name)
            if not skill.latest_published_version_id:
                raise RosterAgentPackageError(
                    "resource_unavailable", f"Workspace Skill {skill.name!r} is not published", status_code=409
                )
            version = self._session.scalar(
                select(SkillVersion).where(
                    SkillVersion.id == skill.latest_published_version_id,
                    SkillVersion.skill_id == skill.id,
                )
            )
            if version is None:
                raise RosterAgentPackageError(
                    "resource_unavailable", f"Workspace Skill {skill.name!r} version is unavailable", status_code=409
                )
            tool_file = self._tool_files(tenant_id=tenant_id, file_ids=[version.archive_tool_file_id]).get(
                version.archive_tool_file_id
            )
            if tool_file is None:
                raise RosterAgentPackageError(
                    "resource_unavailable", f"Workspace Skill {skill.name!r} archive is unavailable", status_code=409
                )
            resource_id = f"s_{len(skill_sources) + 1:06d}"
            path = f"{resource_id}.zip"
            skill_sources.append(
                _SkillSource(
                    payload=_PayloadSource(path, tool_file.file_key),
                    id=resource_id,
                    scope="workspace",
                    name=skill.name,
                    display_name=skill.display_name,
                    description=skill.description,
                    priority=binding.priority,
                    audit_ref=version.id,
                )
            )

        config_file_ids = [item.file_id for item in soul.config_files if item.file_id and not item.is_missing]
        if len(config_file_ids) != len(soul.config_files):
            raise RosterAgentPackageError(
                "resource_unavailable", "Roster Agent contains a missing config file", status_code=409
            )
        tool_file_refs = [item.file_id for item in soul.config_files if item.file_kind == "tool_file"]
        upload_file_refs = [item.file_id for item in soul.config_files if item.file_kind == "upload_file"]
        file_tool_files = self._tool_files(tenant_id=tenant_id, file_ids=tool_file_refs)
        upload_files = self._upload_files(tenant_id=tenant_id, file_ids=upload_file_refs)
        for index, (ref, portable_ref) in enumerate(zip(soul.config_files, portable_data["config_files"]), start=1):
            resource_id = f"f_{index:06d}"
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
                raise RosterAgentPackageError(
                    "resource_unavailable", f"Config file {ref.name!r} payload is unavailable", status_code=409
                )
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

    def _workspace_skill_rows(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        snapshot_id: str | None,
        include_draft: bool,
    ) -> Sequence[tuple[AgentSkillBinding | AgentSkillBindingSnapshot, Skill]]:
        if include_draft:
            rows = (
                self._session.execute(
                    select(AgentSkillBinding, Skill)
                    .join(Skill, Skill.id == AgentSkillBinding.skill_id)
                    .where(AgentSkillBinding.tenant_id == tenant_id, AgentSkillBinding.agent_id == agent_id)
                    .order_by(AgentSkillBinding.priority)
                )
                .tuples()
                .all()
            )
            if rows or not snapshot_id:
                return rows
        if not snapshot_id:
            return []
        return (
            self._session.execute(
                select(AgentSkillBindingSnapshot, Skill)
                .join(Skill, Skill.id == AgentSkillBindingSnapshot.skill_id)
                .where(
                    AgentSkillBindingSnapshot.tenant_id == tenant_id,
                    AgentSkillBindingSnapshot.agent_id == agent_id,
                    AgentSkillBindingSnapshot.config_snapshot_id == snapshot_id,
                )
                .order_by(AgentSkillBindingSnapshot.priority)
            )
            .tuples()
            .all()
        )

    def _tool_files(self, *, tenant_id: str, file_ids: Sequence[str]) -> dict[str, ToolFile]:
        if not file_ids:
            return {}
        rows = self._session.scalars(
            select(ToolFile).where(ToolFile.tenant_id == tenant_id, ToolFile.id.in_(set(file_ids)))
        ).all()
        return {item.id: item for item in rows}

    def _upload_files(self, *, tenant_id: str, file_ids: Sequence[str]) -> dict[str, UploadFile]:
        if not file_ids:
            return {}
        rows = self._session.scalars(
            select(UploadFile).where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(set(file_ids)))
        ).all()
        return {item.id: item for item in rows}

    def _validate_archive(
        self, archive_file: BinaryIO
    ) -> tuple[RosterAgentPackageManifest, dict[str, RosterAgentPackageMember]]:
        try:
            with zipfile.ZipFile(archive_file) as archive:
                infos = archive.infolist()
                if not infos:
                    raise RosterAgentPackageError("invalid_package", "Roster Agent package is empty")
                if len(infos) > _MAX_ENTRIES:
                    raise RosterAgentPackageError("invalid_package", "Roster Agent package has too many members")

                info_by_path: dict[str, zipfile.ZipInfo] = {}
                casefold_paths: set[str] = set()
                total_uncompressed = 0
                for info in infos:
                    path = self._validate_member_info(info)
                    if path in info_by_path or path.casefold() in casefold_paths:
                        raise RosterAgentPackageError(
                            "invalid_package", "Roster Agent package contains duplicate member paths"
                        )
                    info_by_path[path] = info
                    casefold_paths.add(path.casefold())
                    total_uncompressed += info.file_size
                if total_uncompressed > _MAX_UNCOMPRESSED_BYTES:
                    raise RosterAgentPackageError(
                        "package_too_large", "Roster Agent package uncompressed size exceeds the limit", status_code=413
                    )

                manifest_info = info_by_path.get("manifest.json")
                if manifest_info is None:
                    raise RosterAgentPackageError("invalid_package", "Roster Agent package is missing manifest.json")
                if manifest_info.file_size > _MAX_MANIFEST_BYTES:
                    raise RosterAgentPackageError("invalid_package", "Roster Agent package manifest is too large")
                manifest_bytes, _ = self._read_member(
                    archive,
                    manifest_info,
                    collect=True,
                    max_bytes=_MAX_MANIFEST_BYTES,
                )
                try:
                    manifest_data = json.loads(manifest_bytes, object_pairs_hook=self._reject_duplicate_json_keys)
                    manifest = RosterAgentPackageManifest.model_validate(manifest_data)
                except (UnicodeDecodeError, json.JSONDecodeError, ValidationError, ValueError) as exc:
                    raise RosterAgentPackageError(
                        "invalid_package", "Roster Agent package manifest is invalid"
                    ) from exc

                expected_paths = {
                    "manifest.json",
                    *(item.path for item in manifest.skills),
                    *(item.path for item in manifest.files),
                }
                actual_paths = set(info_by_path)
                if "signature.sig" in actual_paths:
                    if info_by_path["signature.sig"].file_size > _MAX_SIGNATURE_BYTES:
                        raise RosterAgentPackageError("invalid_package", "Roster Agent package signature is too large")
                    actual_paths.remove("signature.sig")
                if actual_paths != expected_paths:
                    raise RosterAgentPackageError(
                        "invalid_package", "Roster Agent package members do not match the manifest"
                    )

                members: dict[str, RosterAgentPackageMember] = {}
                for resource in [*manifest.skills, *manifest.files]:
                    info = info_by_path[resource.path]
                    payload = b""
                    if isinstance(resource, RosterAgentPackageSkill):
                        max_skill_bytes = dify_config.UPLOAD_SKILL_FILE_SIZE_LIMIT * 1024 * 1024
                        if info.file_size > max_skill_bytes:
                            raise RosterAgentPackageError(
                                "package_too_large",
                                f"Roster Agent package Skill {resource.name!r} exceeds the size limit",
                                status_code=413,
                            )
                        payload, digest = self._read_member(
                            archive,
                            info,
                            collect=True,
                            max_bytes=max_skill_bytes,
                        )
                    else:
                        _, digest = self._read_member(archive, info, collect=False)
                    if info.file_size != resource.size or digest != resource.sha256:
                        raise RosterAgentPackageError(
                            "invalid_package",
                            f"Roster Agent package resource {resource.path!r} failed integrity checks",
                        )
                    members[resource.path] = RosterAgentPackageMember(
                        path=resource.path,
                        size=resource.size,
                        sha256=digest,
                    )
                    if isinstance(resource, RosterAgentPackageSkill):
                        try:
                            normalized = self._skill_packages.validate_and_normalize(
                                content=payload, filename=resource.path
                            )
                        except SkillPackageError as exc:
                            raise RosterAgentPackageError(
                                "invalid_package", f"Roster Agent package Skill {resource.name!r} is invalid"
                            ) from exc
                        if normalized.manifest.name != resource.name:
                            raise RosterAgentPackageError(
                                "invalid_package",
                                f"Roster Agent package Skill {resource.name!r} does not match SKILL.md",
                            )
                return manifest, members
        except RosterAgentPackageError:
            raise
        except (OSError, zipfile.BadZipFile, EOFError, RuntimeError, ValueError, zlib.error) as exc:
            raise RosterAgentPackageError("invalid_package", "Roster Agent package is not a valid ZIP") from exc

    def _write_storage_member(self, archive: zipfile.ZipFile, payload: _PayloadSource) -> RosterAgentPackageMember:
        digest = hashlib.sha256()
        size = 0
        try:
            with archive.open(payload.path, "w", force_zip64=True) as target:
                for chunk in self._storage.load_stream(payload.storage_key):
                    if not isinstance(chunk, bytes):
                        raise TypeError("storage stream returned a non-bytes chunk")
                    size += len(chunk)
                    if size > _MAX_UNCOMPRESSED_BYTES:
                        raise RosterAgentPackageError(
                            "package_too_large", "Roster Agent package payload exceeds the size limit", status_code=413
                        )
                    digest.update(chunk)
                    target.write(chunk)
        except RosterAgentPackageError:
            raise
        except Exception as exc:
            raise RosterAgentPackageError(
                "resource_unavailable", f"Unable to read package resource {payload.path!r}", status_code=409
            ) from exc
        return RosterAgentPackageMember(path=payload.path, size=size, sha256=digest.hexdigest())

    @staticmethod
    def _copy_bounded(source: BinaryIO, target: BinaryIO) -> None:
        size = 0
        while True:
            chunk = source.read(_COPY_CHUNK_SIZE)
            if not chunk:
                break
            if not isinstance(chunk, bytes):
                raise RosterAgentPackageError("invalid_package", "Roster Agent package must be binary")
            size += len(chunk)
            if size > _MAX_ARCHIVE_BYTES:
                raise RosterAgentPackageError(
                    "package_too_large", "Roster Agent package exceeds the archive size limit", status_code=413
                )
            target.write(chunk)

    @staticmethod
    def _validate_member_info(info: zipfile.ZipInfo) -> str:
        name = info.filename
        if info.is_dir():
            raise RosterAgentPackageError("invalid_package", "Roster Agent package must use root-level files")
        if "\x00" in name or "\\" in name or any(ord(char) < 0x20 for char in name):
            raise RosterAgentPackageError("invalid_package", "Roster Agent package contains an unsafe path")
        normalized = posixpath.normpath(name)
        if normalized != name or normalized in {"", ".", ".."} or normalized.startswith("/") or "/" in normalized:
            raise RosterAgentPackageError("invalid_package", "Roster Agent package contains an unsafe path")
        if stat.S_ISLNK(info.external_attr >> 16):
            raise RosterAgentPackageError("invalid_package", "Roster Agent package must not contain symbolic links")
        if info.flag_bits & 0x1:
            raise RosterAgentPackageError("invalid_package", "Roster Agent package must not contain encrypted members")
        if info.compress_type not in _ALLOWED_COMPRESSIONS:
            raise RosterAgentPackageError("invalid_package", "Roster Agent package uses unsupported compression")
        if info.file_size < 0 or info.compress_size < 0:
            raise RosterAgentPackageError("invalid_package", "Roster Agent package contains invalid ZIP metadata")
        if info.file_size and (info.compress_size == 0 or info.file_size / info.compress_size > _MAX_COMPRESSION_RATIO):
            raise RosterAgentPackageError("invalid_package", "Roster Agent package compression ratio is too high")
        return normalized

    @staticmethod
    def _read_member(
        archive: zipfile.ZipFile,
        info: zipfile.ZipInfo,
        *,
        collect: bool,
        max_bytes: int | None = None,
    ) -> tuple[bytes, str]:
        digest = hashlib.sha256()
        output = io.BytesIO() if collect else None
        size = 0
        with archive.open(info) as member:
            while chunk := member.read(_COPY_CHUNK_SIZE):
                size += len(chunk)
                if max_bytes is not None and size > max_bytes:
                    raise RosterAgentPackageError(
                        "package_too_large",
                        "Roster Agent package member exceeds the size limit",
                        status_code=413,
                    )
                digest.update(chunk)
                if output is not None:
                    output.write(chunk)
        return output.getvalue() if output is not None else b"", digest.hexdigest()

    @staticmethod
    def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result

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


__all__ = [
    "PreparedRosterAgentPackage",
    "RosterAgentPackageError",
    "RosterAgentPackageExport",
    "RosterAgentPackageMember",
    "RosterAgentPackageService",
]
