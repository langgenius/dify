"""Restore packaged Agent assets before persisting their owning application."""

from __future__ import annotations

import hashlib
import mimetypes
import os
from typing import Protocol
from uuid import uuid4

from configs import dify_config
from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models.agent_config_entities import AgentSoulConfig
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.tools import ToolFile
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.dsl_entities import AgentPackage, make_portable_agent_soul
from services.agent.errors import (
    InvalidComposerConfigError,
    InvalidRosterAgentPackageError,
    PlaintextSecretNotAllowedError,
    RosterAgentPackageResourceUnavailableError,
)
from services.agent.roster_package_entities import AgentPackageResources, PackageIcon, PreparedPackageArchive
from services.agent.roster_package_reader import RosterAgentPackageReader
from services.agent.skill_package_service import SkillPackageError, SkillPackageService
from services.entities.dsl_entities import DslImportWarning
from services.file_service import FileService


class _Storage(Protocol):
    def save(self, filename: str, data: bytes) -> None: ...


class AgentPackageResourceImporter:
    def __init__(self, *, storage_backend: _Storage = storage) -> None:
        self._reader = RosterAgentPackageReader()
        self._skill_packages = SkillPackageService()
        self._storage = storage_backend

    def validate(self, *, resources: AgentPackageResources, agent_package: AgentPackage) -> None:
        agent_package.soul = make_portable_agent_soul(agent_package.soul)
        self._validate_supported_resources(resources, soul=agent_package.soul)
        try:
            ComposerConfigValidator.validate_importable_agent_soul(agent_package.soul)
        except (InvalidComposerConfigError, PlaintextSecretNotAllowedError) as exc:
            raise InvalidRosterAgentPackageError("Agent package Soul is invalid") from exc

    @classmethod
    def _validate_supported_resources(cls, resources: AgentPackageResources, *, soul: AgentSoulConfig) -> None:
        skill_names = [item.name for item in soul.config_skills]
        skill_names.extend(item.name for item in resources.skills if item.scope == "workspace")
        if len(skill_names) != len(set(skill_names)):
            raise InvalidRosterAgentPackageError("Roster Agent package contains duplicate effective Skill names")
        file_names = [item.name for item in soul.config_files]
        if len(file_names) != len(set(file_names)):
            raise InvalidRosterAgentPackageError("Roster Agent package contains duplicate config file names")
        file_refs = {item.file_id: item for item in soul.config_files if not item.is_missing}
        for resource in resources.files:
            filename = file_refs[resource.id].name
            extension = cls._extension(filename)
            limit = FileService.file_size_limit(extension=extension)
            if resource.size > limit:
                raise InvalidRosterAgentPackageError(
                    f"Roster Agent package file {filename!r} exceeds its file size limit"
                )
            if extension and extension in dify_config.UPLOAD_FILE_EXTENSION_BLACKLIST:
                raise InvalidRosterAgentPackageError(
                    f"Roster Agent package file extension '.{extension}' is not allowed"
                )

    def materialize(
        self,
        *,
        archive: PreparedPackageArchive,
        resources: AgentPackageResources,
        agent_package: AgentPackage,
        tenant_id: str,
        account_id: str,
    ) -> tuple[AgentPackage, list[DslImportWarning]]:
        """Upload outside database transactions, then commit all file records together."""
        files: list[ToolFile | UploadFile] = []
        warnings: list[DslImportWarning] = []
        soul_data = agent_package.soul.model_dump(mode="json")
        skill_refs_by_package_id = {
            item["file_id"]: item for item in soul_data["config_skills"] if not item["is_missing"]
        }
        file_refs_by_package_id = {
            item["file_id"]: item for item in soul_data["config_files"] if not item["is_missing"]
        }

        skill_descriptions = {item.name: item.description for item in agent_package.workspace_skills}
        skill_descriptions.update({item.name: item.description for item in agent_package.soul.config_skills})
        for skill_resource in resources.skills:
            target_ref = skill_refs_by_package_id.get(skill_resource.id)
            if target_ref is None:
                target_ref = {}
                soul_data["config_skills"].append(target_ref)
            target_ref.update(
                {
                    "name": skill_resource.name,
                    "description": skill_descriptions.get(skill_resource.name, ""),
                    "file_kind": "tool_file",
                    "file_id": "",
                    "is_missing": True,
                    "size": skill_resource.size,
                    "hash": skill_resource.sha256,
                    "mime_type": "application/zip",
                }
            )
            reason = archive.invalid_skills.get(skill_resource.id)
            normalized = None
            try:
                if reason is None:
                    payload = self._reader.read_member_bytes(
                        archive,
                        skill_resource.path,
                        max_bytes=dify_config.UPLOAD_SKILL_FILE_SIZE_LIMIT * 1024 * 1024,
                    )
                    normalized = self._skill_packages.validate_and_normalize(
                        content=payload, filename=skill_resource.path
                    )
            except SkillPackageError as exc:
                reason = exc.code
            except InvalidRosterAgentPackageError:
                reason = "archive_integrity_failed"
            if normalized is None:
                warnings.append(
                    DslImportWarning(
                        code="agent_skill_missing",
                        path=f"skills.{skill_resource.id}",
                        message=f"Skill {skill_resource.name!r} is damaged and must be uploaded again.",
                        details={"name": skill_resource.name, "reason": reason, "path": skill_resource.path},
                    )
                )
                continue
            storage_key = f"tools/{tenant_id}/{uuid4().hex}.zip"
            tool_file = ToolFile(
                user_id=account_id,
                tenant_id=tenant_id,
                conversation_id=None,
                file_key=storage_key,
                mimetype="application/zip",
                name=f"{skill_resource.name}.zip",
                size=len(normalized.archive_bytes),
                original_url=None,
            )
            self._save_resource(storage_key=storage_key, payload=normalized.archive_bytes, files=files, row=tool_file)
            target_ref.update(
                {
                    "description": normalized.manifest.description,
                    "file_id": tool_file.id,
                    "is_missing": False,
                    "size": tool_file.size,
                    "hash": normalized.manifest.hash,
                }
            )

        for file_resource in resources.files:
            package_ref = file_refs_by_package_id[file_resource.id]
            file_kind = package_ref["file_kind"]
            mime_type = package_ref["mime_type"] or "application/octet-stream"
            extension = self._extension(package_ref["name"])
            payload = self._reader.read_member_bytes(archive, file_resource.path, max_bytes=file_resource.size)
            if file_kind == "tool_file":
                storage_key = f"tools/{tenant_id}/{uuid4().hex}.{extension or 'bin'}"
                row: ToolFile | UploadFile = ToolFile(
                    user_id=account_id,
                    tenant_id=tenant_id,
                    conversation_id=None,
                    file_key=storage_key,
                    mimetype=mime_type,
                    name=package_ref["name"],
                    size=len(payload),
                    original_url=None,
                )
                hash_value = None
            else:
                storage_key = f"upload_files/{tenant_id}/{uuid4()}.{extension or 'bin'}"
                now = naive_utc_now()
                row = UploadFile(
                    tenant_id=tenant_id,
                    storage_type=StorageType(dify_config.STORAGE_TYPE),
                    key=storage_key,
                    name=package_ref["name"],
                    size=len(payload),
                    extension=extension,
                    mime_type=mime_type,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=account_id,
                    created_at=now,
                    used=False,
                    hash=hashlib.sha3_256(payload).hexdigest(),
                )
                hash_value = row.hash
            self._save_resource(storage_key=storage_key, payload=payload, files=files, row=row)
            package_ref.update(
                {
                    "file_id": row.id,
                    "is_missing": False,
                    "size": row.size,
                    "hash": hash_value,
                    "mime_type": mime_type,
                }
            )

        soul = AgentSoulConfig.model_validate(soul_data)
        with session_factory.create_session() as session, session.begin():
            session.add_all(files)
        # Localized Skills must not bind to same-named Skills in the target workspace.
        return agent_package.model_copy(update={"soul": soul, "workspace_skills": []}), warnings

    def materialize_icons(
        self, *, archive: PreparedPackageArchive, icons: list[PackageIcon], tenant_id: str, account_id: str
    ) -> dict[str, str]:
        files: list[ToolFile | UploadFile] = []
        mapping: dict[str, str] = {}
        for icon in icons:
            payload = self._reader.read_member_bytes(
                archive, icon.path, max_bytes=dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT * 1024 * 1024
            )
            extension = self._extension(icon.path)
            file_id = str(uuid4())
            key = f"upload_files/{tenant_id}/{file_id}.{extension}"
            row = UploadFile(
                tenant_id=tenant_id,
                storage_type=StorageType(dify_config.STORAGE_TYPE),
                key=key,
                name=icon.path,
                size=len(payload),
                extension=extension,
                mime_type=mimetypes.guess_type(icon.path)[0] or "application/octet-stream",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account_id,
                created_at=naive_utc_now(),
                used=False,
                hash=hashlib.sha3_256(payload).hexdigest(),
            )
            row.id = file_id
            self._save_resource(storage_key=key, payload=payload, files=files, row=row)
            mapping[icon.id] = file_id
        if files:
            with session_factory.create_session() as session, session.begin():
                session.add_all(files)
        return mapping

    def _save_resource(
        self,
        *,
        storage_key: str,
        payload: bytes,
        files: list[ToolFile | UploadFile],
        row: ToolFile | UploadFile,
    ) -> None:
        try:
            self._storage.save(storage_key, payload)
        except Exception as exc:
            raise RosterAgentPackageResourceUnavailableError() from exc
        files.append(row)

    @staticmethod
    def _extension(filename: str) -> str:
        return os.path.splitext(filename)[1].lstrip(".").lower()
