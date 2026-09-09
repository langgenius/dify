"""Materialize validated Roster Agent packages into a new Agent App."""

from __future__ import annotations

import hashlib
import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass
from typing import BinaryIO, Protocol
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from configs import dify_config
from constants.model_template import default_app_templates
from core.db.session_factory import session_factory
from core.plugin.entities.plugin import PluginDependency
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models import Account
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentDebugConversation,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import CreatorUserRole
from models.model import App, AppMode, AppModelConfig, Conversation, InstalledApp, Site, UploadFile
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
from services.agent.roster_package_entities import (
    PreparedRosterAgentPackage,
    RosterAgentPackageMetadata,
)
from services.agent.roster_package_reader import RosterAgentPackageReader
from services.agent.roster_service import AgentRosterService
from services.agent.skill_package_service import SkillPackageError, SkillPackageService
from services.app_creation_records import create_installed_app_record, create_site_record
from services.app_dsl_service import (
    CHECK_DEPENDENCIES_REDIS_KEY_PREFIX,
    IMPORT_INFO_REDIS_EXPIRY,
    CheckDependenciesPendingData,
)
from services.app_service import AppService
from services.entities.dsl_entities import DslImportWarning
from services.file_service import FileService
from services.icon_configuration import DEFAULT_ICON, DEFAULT_ICON_BACKGROUND, DEFAULT_ICON_TYPE

logger = logging.getLogger(__name__)


class _Storage(Protocol):
    def save(self, filename: str, data: bytes) -> None: ...

    def delete(self, filename: str) -> None: ...


class _DependencyState(Protocol):
    def store(self, *, app_id: str, dependencies: list[PluginDependency]) -> None: ...

    def delete(self, *, app_id: str) -> None: ...


class _RedisDependencyState:
    def store(self, *, app_id: str, dependencies: list[PluginDependency]) -> None:
        if not dependencies:
            return
        redis_client.setex(
            f"{CHECK_DEPENDENCIES_REDIS_KEY_PREFIX}{app_id}",
            IMPORT_INFO_REDIS_EXPIRY,
            CheckDependenciesPendingData(app_id=app_id, dependencies=dependencies).model_dump_json(),
        )

    def delete(self, *, app_id: str) -> None:
        redis_client.delete(f"{CHECK_DEPENDENCIES_REDIS_KEY_PREFIX}{app_id}")


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
        reader: RosterAgentPackageReader | None = None,
        skill_packages: SkillPackageService | None = None,
        storage_backend: _Storage = storage,
        dependency_state: _DependencyState | None = None,
    ) -> None:
        self._reader = reader or RosterAgentPackageReader()
        self._skill_packages = skill_packages or SkillPackageService()
        self._storage = storage_backend
        self._dependency_state = dependency_state or _RedisDependencyState()

    def import_package(
        self,
        *,
        source: BinaryIO,
        tenant_id: str,
        account: Account,
    ) -> RosterAgentPackageImportResult:
        with self._reader.read(source) as package:
            package.manifest = package.manifest.model_copy(
                update={"soul": make_portable_agent_soul(package.manifest.soul)}
            )
            self._validate_supported_resources(package)
            try:
                ComposerConfigValidator.validate_importable_agent_soul(package.manifest.soul)
            except (InvalidComposerConfigError, PlaintextSecretNotAllowedError) as exc:
                raise InvalidRosterAgentPackageError("Roster Agent package Soul is invalid") from exc

            app_id = str(uuid4())
            staged: list[_StagedResource] = []
            database_committed = False
            try:
                self._ensure_name_available(tenant_id=tenant_id, name=package.manifest.metadata.name)
                soul = self._stage_resources(
                    package=package,
                    tenant_id=tenant_id,
                    account_id=account.id,
                    staged=staged,
                )
                resolved_soul, warnings = self._resolve_target_soul(
                    tenant_id=tenant_id,
                    metadata=package.manifest.metadata,
                    soul=soul,
                )
                try:
                    ComposerConfigValidator.validate_importable_agent_soul(resolved_soul)
                except (InvalidComposerConfigError, PlaintextSecretNotAllowedError) as exc:
                    raise InvalidRosterAgentPackageError("Roster Agent package Soul is invalid") from exc
                self._dependency_state.store(app_id=app_id, dependencies=package.manifest.dependencies)
                app_id, agent_id = self._persist_import(
                    app_id=app_id,
                    tenant_id=tenant_id,
                    account=account,
                    metadata=package.manifest.metadata,
                    soul=resolved_soul,
                    staged=staged,
                )
                database_committed = True
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
            except IntegrityError as exc:
                if database_committed:
                    self._compensate_database(app_id=app_id, tenant_id=tenant_id, staged=staged)
                self._cleanup_external_state(app_id=app_id, staged=staged)
                if "roster_unique_name" in str(exc):
                    raise AgentNameConflictError() from exc
                raise RosterAgentPackageImportFailedError() from exc
            except (AgentNameConflictError, InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError):
                if database_committed:
                    self._compensate_database(app_id=app_id, tenant_id=tenant_id, staged=staged)
                self._cleanup_external_state(app_id=app_id, staged=staged)
                raise
            except RosterAgentPackageResourceUnavailableError:
                self._cleanup_external_state(app_id=app_id, staged=staged)
                raise
            except Exception as exc:
                if database_committed:
                    self._compensate_database(app_id=app_id, tenant_id=tenant_id, staged=staged)
                self._cleanup_external_state(app_id=app_id, staged=staged)
                raise RosterAgentPackageImportFailedError() from exc

    @classmethod
    def _validate_supported_resources(cls, package: PreparedRosterAgentPackage) -> None:
        if any(item.role == "binary_dependency" for item in package.manifest.files):
            raise InvalidRosterAgentPackageError(
                "Roster Agent package binary_dependency resources are not supported yet"
            )
        skill_names = [item.name for item in package.manifest.soul.config_skills]
        skill_names.extend(item.name for item in package.manifest.skills if item.scope == "workspace")
        if len(skill_names) != len(set(skill_names)):
            raise InvalidRosterAgentPackageError("Roster Agent package contains duplicate effective Skill names")
        file_names = [item.name for item in package.manifest.soul.config_files]
        if len(file_names) != len(set(file_names)):
            raise InvalidRosterAgentPackageError("Roster Agent package contains duplicate config file names")
        for resource in package.manifest.files:
            extension = cls._extension(resource.original_name)
            limit = FileService.file_size_limit(extension=extension)
            if resource.size > limit:
                raise InvalidRosterAgentPackageError(
                    f"Roster Agent package file {resource.original_name!r} exceeds its file size limit"
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
        tenant_id: str,
        account_id: str,
        staged: list[_StagedResource],
    ) -> AgentSoulConfig:
        soul_data = package.manifest.soul.model_dump(mode="json")
        skill_refs_by_package_id = {
            item["file_id"]: item for item in soul_data["config_skills"] if not item["is_missing"]
        }
        file_refs_by_package_id = {
            item["file_id"]: item for item in soul_data["config_files"] if not item["is_missing"]
        }

        for skill_resource in package.manifest.skills:
            payload = self._reader.read_member_bytes(
                package,
                skill_resource.path,
                max_bytes=dify_config.UPLOAD_SKILL_FILE_SIZE_LIMIT * 1024 * 1024,
            )
            try:
                normalized = self._skill_packages.validate_and_normalize(
                    content=payload,
                    filename=skill_resource.path,
                )
            except SkillPackageError as exc:
                raise InvalidRosterAgentPackageError(
                    f"Roster Agent package Skill {skill_resource.name!r} is invalid"
                ) from exc
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
            localized_ref = {
                "name": skill_resource.name,
                "description": normalized.manifest.description,
                "file_kind": "tool_file",
                "file_id": tool_file.id,
                "is_missing": False,
                "size": tool_file.size,
                "hash": normalized.manifest.hash,
                "mime_type": tool_file.mimetype,
            }
            if skill_resource.scope == "agent_config":
                skill_refs_by_package_id[skill_resource.id].update(localized_ref)
            else:
                soul_data["config_skills"].append(localized_ref)

        for file_resource in package.manifest.files:
            package_ref = file_refs_by_package_id[file_resource.id]
            file_kind = package_ref["file_kind"]
            extension = self._extension(file_resource.original_name)
            limit = FileService.file_size_limit(extension=extension)
            payload = self._reader.read_member_bytes(package, file_resource.path, max_bytes=limit)
            if file_kind == "tool_file":
                storage_key = f"tools/{tenant_id}/{uuid4().hex}.{extension or 'bin'}"
                row: ToolFile | UploadFile = ToolFile(
                    user_id=account_id,
                    tenant_id=tenant_id,
                    conversation_id=None,
                    file_key=storage_key,
                    mimetype=file_resource.mime_type,
                    name=file_resource.original_name,
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
                    name=file_resource.original_name,
                    size=len(payload),
                    extension=extension,
                    mime_type=file_resource.mime_type,
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
                    "mime_type": file_resource.mime_type,
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
    def _resolve_target_soul(
        *,
        tenant_id: str,
        metadata: RosterAgentPackageMetadata,
        soul: AgentSoulConfig,
    ) -> tuple[AgentSoulConfig, list[DslImportWarning]]:
        package = AgentPackage(
            metadata=AgentPackageMetadata(
                name=metadata.name,
                description=metadata.description,
                role=metadata.role,
            ),
            soul=soul,
        )
        with session_factory.create_session() as session:
            return AgentDslService(session).resolve_package_soul(
                tenant_id=tenant_id,
                package=package,
                package_path="agent",
            )

    @staticmethod
    def _persist_import(
        *,
        app_id: str,
        tenant_id: str,
        account: Account,
        metadata: RosterAgentPackageMetadata,
        soul: AgentSoulConfig,
        staged: Sequence[_StagedResource],
    ) -> tuple[str, str]:
        with session_factory.create_session() as session, session.begin():
            session.add_all([item.row for item in staged])
            app_template = dict(default_app_templates[AppMode.AGENT]["app"])
            app = App(**app_template)
            app.id = app_id
            app.tenant_id = tenant_id
            app.name = metadata.name
            app.description = metadata.description
            app.mode = AppMode.AGENT
            app.icon_type = DEFAULT_ICON_TYPE
            app.icon = DEFAULT_ICON
            app.icon_background = DEFAULT_ICON_BACKGROUND
            app.enable_site = False
            app.enable_api = False
            app.api_rph = 0
            app.api_rpm = 0
            app.max_active_requests = None
            app.created_by = account.id
            app.maintainer = account.id
            app.updated_by = account.id
            session.add(app)
            session.flush()

            app_model_config = AppModelConfig(app_id=app.id, created_by=account.id, updated_by=account.id)
            session.add(app_model_config)
            session.flush()
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
            session.flush()
            return app.id, agent.id

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

    @staticmethod
    def _compensate_database(
        *,
        app_id: str,
        tenant_id: str,
        staged: Sequence[_StagedResource],
    ) -> None:
        tool_file_ids = [item.row.id for item in staged if isinstance(item.row, ToolFile)]
        upload_file_ids = [item.row.id for item in staged if isinstance(item.row, UploadFile)]
        try:
            with session_factory.create_session() as session, session.begin():
                agent_ids = list(
                    session.scalars(
                        select(Agent.id).where(
                            Agent.tenant_id == tenant_id,
                            Agent.app_id == app_id,
                            Agent.scope == AgentScope.ROSTER,
                        )
                    ).all()
                )
                if agent_ids:
                    session.execute(
                        delete(AgentDebugConversation).where(
                            AgentDebugConversation.tenant_id == tenant_id,
                            AgentDebugConversation.agent_id.in_(agent_ids),
                        )
                    )
                    session.execute(
                        delete(AgentConfigDraft).where(
                            AgentConfigDraft.tenant_id == tenant_id,
                            AgentConfigDraft.agent_id.in_(agent_ids),
                        )
                    )
                    session.execute(
                        delete(AgentConfigRevision).where(
                            AgentConfigRevision.tenant_id == tenant_id,
                            AgentConfigRevision.agent_id.in_(agent_ids),
                        )
                    )
                    session.execute(
                        delete(AgentConfigSnapshot).where(
                            AgentConfigSnapshot.tenant_id == tenant_id,
                            AgentConfigSnapshot.agent_id.in_(agent_ids),
                        )
                    )
                    session.execute(delete(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(agent_ids)))
                session.execute(delete(Conversation).where(Conversation.app_id == app_id))
                session.execute(delete(Site).where(Site.app_id == app_id))
                session.execute(
                    delete(InstalledApp).where(InstalledApp.tenant_id == tenant_id, InstalledApp.app_id == app_id)
                )
                session.execute(delete(AppModelConfig).where(AppModelConfig.app_id == app_id))
                session.execute(delete(App).where(App.tenant_id == tenant_id, App.id == app_id))
                if tool_file_ids:
                    session.execute(
                        delete(ToolFile).where(ToolFile.tenant_id == tenant_id, ToolFile.id.in_(tool_file_ids))
                    )
                if upload_file_ids:
                    session.execute(
                        delete(UploadFile).where(
                            UploadFile.tenant_id == tenant_id,
                            UploadFile.id.in_(upload_file_ids),
                        )
                    )
        except Exception:
            logger.exception("Failed to compensate Roster Agent package database import: app_id=%s", app_id)

    def _cleanup_external_state(self, *, app_id: str, staged: Sequence[_StagedResource]) -> None:
        try:
            self._dependency_state.delete(app_id=app_id)
        except Exception:
            logger.exception("Failed to clear Roster Agent package dependency state: app_id=%s", app_id)
        for item in reversed(staged):
            try:
                self._storage.delete(item.storage_key)
            except Exception:
                logger.exception("Failed to delete staged Roster Agent package resource: key=%s", item.storage_key)

    @staticmethod
    def _extension(filename: str) -> str:
        return os.path.splitext(filename)[1].lstrip(".").lower()


__all__ = ["RosterAgentPackageImportResult", "RosterAgentPackageImporter"]
