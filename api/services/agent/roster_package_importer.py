"""Materialize validated Roster Agent packages into a new Agent App."""

from __future__ import annotations

import hashlib
import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass
from typing import BinaryIO, Protocol
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from configs import dify_config
from constants.model_template import default_app_templates
from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models import Account
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import CreatorUserRole
from models.model import App, AppMode, AppModelConfig, UploadFile
from models.tools import ToolFile
from services.agent.composer_validator import ComposerConfigValidator
from services.agent.dsl_entities import AgentPackage, AgentPackageMetadata, make_portable_agent_soul
from services.agent.dsl_service import AgentDslService
from services.agent.errors import (
    AgentNameConflictError,
    InvalidComposerConfigError,
    InvalidRosterAgentPackageError,
    PlaintextSecretNotAllowedError,
    RosterAgentPackageImportFailedError,
    RosterAgentPackageResourceUnavailableError,
    RosterAgentPackageTooLargeError,
)
from services.agent.roster_package_cleanup import CleanupResource, PackageCleanupJob, RosterPackageCleanup
from services.agent.roster_package_dependencies import check_package_dependencies
from services.agent.roster_package_entities import PreparedRosterAgentPackage
from services.agent.roster_package_reader import RosterAgentPackageReader
from services.agent.roster_service import AgentRosterService
from services.agent.skill_package_service import SkillPackageError, SkillPackageService
from services.app_creation_records import create_installed_app_record, create_site_record
from services.app_service import AppService
from services.entities.dsl_entities import DslImportWarning
from services.file_service import FileService
from services.icon_configuration import DEFAULT_ICON, DEFAULT_ICON_BACKGROUND, DEFAULT_ICON_TYPE

logger = logging.getLogger(__name__)


class _Storage(Protocol):
    def save(self, filename: str, data: bytes) -> None: ...

    def delete(self, filename: str) -> None: ...


@dataclass(frozen=True)
class _StagedResource:
    storage_key: str
    row: ToolFile | UploadFile


@dataclass(frozen=True)
class RosterAgentPackageImportResult:
    app_id: str
    agent_id: str
    warnings: list[DslImportWarning]


class RosterAgentPackageImporter:
    """Import one package with storage and database compensation boundaries."""

    def __init__(
        self,
        *,
        storage_backend: _Storage = storage,
        cleanup: RosterPackageCleanup | None = None,
    ) -> None:
        self._reader = RosterAgentPackageReader()
        self._skill_packages = SkillPackageService()
        self._storage = storage_backend
        self._cleanup = cleanup or RosterPackageCleanup(storage_backend=storage_backend)

    def import_package(
        self,
        *,
        source: BinaryIO,
        tenant_id: str,
        account: Account,
    ) -> RosterAgentPackageImportResult:
        with self._reader.read(source) as package:
            if len(package.apps) != 1:
                raise InvalidRosterAgentPackageError("Import requires exactly one Agent App")
            app_dsl = next(iter(package.apps.values()))
            agent_package = app_dsl.package
            agent_package.soul = make_portable_agent_soul(agent_package.soul)
            self._validate_supported_resources(package, soul=agent_package.soul)
            try:
                ComposerConfigValidator.validate_importable_agent_soul(agent_package.soul)
            except (InvalidComposerConfigError, PlaintextSecretNotAllowedError) as exc:
                raise InvalidRosterAgentPackageError("Roster Agent package Soul is invalid") from exc

            check_package_dependencies(tenant_id=tenant_id, account=account, dependencies=app_dsl.dependencies)
            app_id = str(uuid4())
            staged: list[_StagedResource] = []
            skill_warnings: list[DslImportWarning] = []
            try:
                self._ensure_name_available(tenant_id=tenant_id, name=agent_package.metadata.name)
                soul = self._stage_resources(
                    package=package,
                    agent_package=agent_package,
                    tenant_id=tenant_id,
                    account_id=account.id,
                    staged=staged,
                    warnings=skill_warnings,
                )
                with session_factory.create_session() as session:
                    resolved_soul, warnings = AgentDslService(session).resolve_package_soul(
                        tenant_id=tenant_id,
                        package=AgentPackage(metadata=agent_package.metadata, soul=soul),
                        package_path="agent",
                    )
                warnings = [*skill_warnings, *warnings]
                agent_id = self._persist_import(
                    app_id=app_id,
                    tenant_id=tenant_id,
                    account=account,
                    metadata=agent_package.metadata,
                    soul=resolved_soul,
                    staged=staged,
                )
                self._finalize_app(
                    app_id=app_id,
                    agent_id=agent_id,
                    tenant_id=tenant_id,
                    account=account,
                )
                return RosterAgentPackageImportResult(
                    app_id=app_id,
                    agent_id=agent_id,
                    warnings=warnings,
                )
            except Exception as exc:
                self._cleanup_failed_import(app_id=app_id, tenant_id=tenant_id, staged=staged)
                if isinstance(exc, IntegrityError) and "roster_unique_name" in str(exc):
                    raise AgentNameConflictError() from exc
                if isinstance(
                    exc,
                    (
                        AgentNameConflictError,
                        InvalidRosterAgentPackageError,
                        RosterAgentPackageTooLargeError,
                        RosterAgentPackageResourceUnavailableError,
                    ),
                ):
                    raise
                raise RosterAgentPackageImportFailedError() from exc

    @classmethod
    def _validate_supported_resources(cls, package: PreparedRosterAgentPackage, *, soul: AgentSoulConfig) -> None:
        skill_names = [item.name for item in soul.config_skills]
        skill_names.extend(item.name for item in package.manifest.skills if item.scope == "workspace")
        if len(skill_names) != len(set(skill_names)):
            raise InvalidRosterAgentPackageError("Roster Agent package contains duplicate effective Skill names")
        file_names = [item.name for item in soul.config_files]
        if len(file_names) != len(set(file_names)):
            raise InvalidRosterAgentPackageError("Roster Agent package contains duplicate config file names")
        file_refs = {item.file_id: item for item in soul.config_files if not item.is_missing}
        for resource in package.manifest.files:
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

    @staticmethod
    def _ensure_name_available(*, tenant_id: str, name: str) -> None:
        with session_factory.create_session() as session:
            exists = session.scalar(
                select(Agent.id)
                .where(
                    Agent.tenant_id == tenant_id,
                    Agent.scope == AgentScope.ROSTER,
                    Agent.status == AgentStatus.ACTIVE,
                    Agent.name == name,
                )
                .limit(1)
            )
        if exists is not None:
            raise AgentNameConflictError()

    def _stage_resources(
        self,
        *,
        package: PreparedRosterAgentPackage,
        agent_package: AgentPackage,
        tenant_id: str,
        account_id: str,
        staged: list[_StagedResource],
        warnings: list[DslImportWarning],
    ) -> AgentSoulConfig:
        soul_data = agent_package.soul.model_dump(mode="json")
        skill_refs_by_package_id = {
            item["file_id"]: item for item in soul_data["config_skills"] if not item["is_missing"]
        }
        file_refs_by_package_id = {
            item["file_id"]: item for item in soul_data["config_files"] if not item["is_missing"]
        }

        skill_descriptions = {item.name: item.description for item in agent_package.workspace_skills}
        skill_descriptions.update({item.name: item.description for item in agent_package.soul.config_skills})
        for skill_resource in package.manifest.skills:
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
            reason = package.invalid_skills.get(skill_resource.id)
            normalized = None
            try:
                if reason is None:
                    payload = self._reader.read_member_bytes(
                        package,
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
            self._save_resource(storage_key=storage_key, payload=normalized.archive_bytes, staged=staged, row=tool_file)
            target_ref.update(
                {
                    "description": normalized.manifest.description,
                    "file_id": tool_file.id,
                    "is_missing": False,
                    "size": tool_file.size,
                    "hash": normalized.manifest.hash,
                }
            )

        for file_resource in package.manifest.files:
            package_ref = file_refs_by_package_id[file_resource.id]
            file_kind = package_ref["file_kind"]
            mime_type = package_ref["mime_type"] or "application/octet-stream"
            extension = self._extension(package_ref["name"])
            payload = self._reader.read_member_bytes(package, file_resource.path, max_bytes=file_resource.size)
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
                    used=True,
                    used_by=account_id,
                    used_at=now,
                    hash=hashlib.sha3_256(payload).hexdigest(),
                )
                hash_value = row.hash
            self._save_resource(storage_key=storage_key, payload=payload, staged=staged, row=row)
            package_ref.update(
                {
                    "file_id": row.id,
                    "is_missing": False,
                    "size": row.size,
                    "hash": hash_value,
                    "mime_type": mime_type,
                }
            )

        return AgentSoulConfig.model_validate(soul_data)

    def _save_resource(
        self,
        *,
        storage_key: str,
        payload: bytes,
        staged: list[_StagedResource],
        row: ToolFile | UploadFile,
    ) -> None:
        staged_resource = _StagedResource(storage_key=storage_key, row=row)
        staged.append(staged_resource)
        try:
            self._storage.save(storage_key, payload)
        except Exception as exc:
            raise RosterAgentPackageResourceUnavailableError() from exc

    @staticmethod
    def _persist_import(
        *,
        app_id: str,
        tenant_id: str,
        account: Account,
        metadata: AgentPackageMetadata,
        soul: AgentSoulConfig,
        staged: Sequence[_StagedResource],
    ) -> str:
        with session_factory.create_session() as session, session.begin():
            session.add_all([item.row for item in staged])
            app = App(**default_app_templates[AppMode.AGENT]["app"])
            app.id = app_id
            app.tenant_id = tenant_id
            app.name = metadata.name
            app.description = metadata.description
            app.icon_type = DEFAULT_ICON_TYPE
            app.icon = DEFAULT_ICON
            app.icon_background = DEFAULT_ICON_BACKGROUND
            app.api_rph = 0
            app.api_rpm = 0
            app.max_active_requests = None
            app.created_by = account.id
            app.maintainer = account.id
            app.updated_by = account.id
            session.add(app)

            app_model_config = AppModelConfig(app_id=app.id, created_by=account.id, updated_by=account.id)
            session.add(app_model_config)
            app.app_model_config_id = app_model_config.id

            agent = AgentRosterService(session).create_backing_agent_for_app(
                tenant_id=tenant_id,
                account_id=account.id,
                app_id=app.id,
                name=metadata.name,
                description=metadata.description,
                role=metadata.role,
                source=AgentSource.IMPORTED,
                initial_soul=soul,
                revision_operation=AgentConfigRevisionOperation.IMPORT_PACKAGE,
            )
            snapshot = session.get(AgentConfigSnapshot, agent.active_config_snapshot_id)
            if snapshot is None:
                raise RuntimeError("Imported Agent snapshot was not created")
            session.add(
                AgentConfigDraft(
                    tenant_id=tenant_id,
                    agent_id=agent.id,
                    draft_type=AgentConfigDraftType.DRAFT,
                    account_id=None,
                    draft_owner_key="",
                    base_snapshot_id=snapshot.id,
                    home_snapshot_id=snapshot.home_snapshot_id,
                    config_snapshot=soul,
                    created_by=account.id,
                    updated_by=account.id,
                )
            )
            agent.active_config_is_published = False
            create_site_record(app=app, account=account, session=session)
            create_installed_app_record(app=app, session=session)
            return agent.id

    @staticmethod
    def _finalize_app(*, app_id: str, agent_id: str, tenant_id: str, account: Account) -> None:
        with session_factory.create_session() as session:
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id).limit(1))
            if app is None:
                raise RuntimeError("Imported Agent App is unavailable after commit")
            AppService().finalize_created_app(
                app=app,
                backing_agent_id=agent_id,
                account=account,
                session=session,
                created_records_initialized=True,
            )

    def _cleanup_failed_import(self, *, app_id: str, tenant_id: str, staged: Sequence[_StagedResource]) -> None:
        job = PackageCleanupJob(
            app_id=app_id,
            tenant_id=tenant_id,
            resources=[
                CleanupResource(
                    id=item.row.id,
                    kind="tool_file" if isinstance(item.row, ToolFile) else "upload_file",
                    storage_key=item.storage_key,
                )
                for item in staged
            ],
        )
        try:
            self._cleanup.cache.save(job)
            self._cleanup.run(job.key)
        except Exception:
            # The cached job is retried by the periodic worker. In particular,
            # keep every blob when database deletion or its checkpoint fails.
            logger.exception(
                "Roster Agent package cleanup remains pending: tenant_id=%s app_id=%s",
                tenant_id,
                app_id,
            )

    @staticmethod
    def _extension(filename: str) -> str:
        return os.path.splitext(filename)[1].lstrip(".").lower()


__all__ = ["RosterAgentPackageImportResult", "RosterAgentPackageImporter"]
