"""Materialize validated Roster Agent packages into a new Agent App."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import BinaryIO
from urllib.parse import urlsplit
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from configs import dify_config
from constants.model_template import default_app_templates
from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models import Account
from models.agent import (
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentIconType,
    AgentSource,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import App, AppMode, AppModelConfig, IconType, UploadFile
from services.agent.dsl_entities import AgentAppDsl, AgentPackage, AgentPackageMetadata
from services.agent.dsl_service import AgentDslService
from services.agent.errors import (
    AgentNameConflictError,
    InvalidRosterAgentPackageError,
    RosterAgentPackageImportFailedError,
    RosterAgentPackageResourceUnavailableError,
    RosterAgentPackageTooLargeError,
)
from services.agent.package_resource_importer import AgentPackageResourceImporter, _Storage
from services.agent.roster_package_entities import AgentPackageResources, PackageIcon
from services.agent.roster_package_exporter import RosterAgentPackageExporter
from services.agent.roster_package_reader import RosterAgentPackageReader
from services.agent.roster_service import AgentRosterService
from services.app_creation_records import create_installed_app_record, create_site_record
from services.app_dsl_service import AppDslService
from services.app_import_source import download_app_import_source
from services.app_service import AppService
from services.entities.dsl_entities import DslImportWarning
from services.entities.site_dsl import SiteDsl, apply_site_dsl
from services.feature_service import FeatureService
from services.icon_configuration import DEFAULT_ICON, DEFAULT_ICON_BACKGROUND, DEFAULT_ICON_TYPE, is_valid_image_icon
from services.recommended_app_package_service import RecommendedAgentPackageSource

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RosterAgentPackageImportResult:
    app_id: str
    agent_id: str
    warnings: list[DslImportWarning]


class RosterAgentPackageImporter:
    """Commit uploaded file records before creating the Agent in a separate transaction."""

    def __init__(self, *, storage_backend: _Storage = storage) -> None:
        self._resources = AgentPackageResourceImporter(storage_backend=storage_backend)

    def import_template(
        self,
        *,
        source: RecommendedAgentPackageSource,
        tenant_id: str,
        account: Account,
        name: str | None = None,
        description: str | None = None,
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> RosterAgentPackageImportResult:
        """Import a catalog-admitted published source without an outer archive."""
        app, resources, _ = RosterAgentPackageExporter().collect(
            tenant_id=source.tenant_id, agent_id=source.agent_id, version_id=source.version_id
        )
        payloads, resource_index, icons = resources.read_local_resources(app.agent.package_ref)

        return self.import_collected(
            app_dsl=app,
            resources=resource_index,
            icons=icons,
            # Local payloads already passed per-resource and aggregate limits during collection.
            read_member=lambda path, _limit: payloads[path],
            invalid_skills={},
            tenant_id=tenant_id,
            account=account,
            name=name,
            description=description,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
        )

    def import_package_url(
        self,
        *,
        url: str,
        tenant_id: str,
        account: Account,
        name: str | None = None,
        description: str | None = None,
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> RosterAgentPackageImportResult:
        try:
            parsed = urlsplit(url)
            credential_free = not parsed.username and not parsed.password
        except ValueError:
            credential_free = False
        if not credential_free:
            raise InvalidRosterAgentPackageError("Package URL must be an HTTP(S) URL without credentials")
        with download_app_import_source(url, max_bytes=dify_config.AGENT_PACKAGE_MAX_BYTES) as source:
            return self.import_package(
                source=source,
                tenant_id=tenant_id,
                account=account,
                name=name,
                description=description,
                icon_type=icon_type,
                icon=icon,
                icon_background=icon_background,
            )

    def import_package(
        self,
        *,
        source: BinaryIO,
        tenant_id: str,
        account: Account,
        name: str | None = None,
        description: str | None = None,
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> RosterAgentPackageImportResult:
        with RosterAgentPackageReader().read(source) as package:
            if len(package.apps) != 1:
                raise InvalidRosterAgentPackageError("Import requires exactly one Agent App")
            return self.import_collected(
                app_dsl=next(iter(package.apps.values())),
                resources=package.manifest,
                icons=package.manifest.icons,
                read_member=lambda path, limit: RosterAgentPackageReader().read_member_bytes(
                    package, path, max_bytes=limit
                ),
                invalid_skills=package.invalid_skills,
                tenant_id=tenant_id,
                account=account,
                name=name,
                description=description,
                icon_type=icon_type,
                icon=icon,
                icon_background=icon_background,
            )

    def import_collected(
        self,
        *,
        app_dsl: AgentAppDsl,
        resources: AgentPackageResources,
        icons: list[PackageIcon],
        read_member: Callable[[str, int], bytes],
        invalid_skills: dict[str, str],
        tenant_id: str,
        account: Account,
        name: str | None = None,
        description: str | None = None,
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> RosterAgentPackageImportResult:
        if icon_type is not None:
            try:
                IconType(icon_type)
            except ValueError as exc:
                raise InvalidRosterAgentPackageError("Invalid icon type") from exc
        with session_factory.create_session() as session:
            if not is_valid_image_icon(session=session, tenant_id=tenant_id, icon_type=icon_type, icon=icon):
                raise InvalidRosterAgentPackageError("Image icon must belong to the current workspace")
        agent_package = app_dsl.package
        self._resources.validate(resources=resources, agent_package=agent_package)
        overrides = {
            key: value for key, value in {"name": name, "description": description}.items() if value is not None
        }
        try:
            agent_package.metadata = AgentPackageMetadata.model_validate(
                {**agent_package.metadata.model_dump(), **overrides}
            )
        except ValidationError as exc:
            raise InvalidRosterAgentPackageError("Invalid Agent metadata overrides") from exc

        # Resolve billing before uploading package members or opening the write transaction.
        allow_premium_site_settings = app_dsl.site is None or FeatureService.can_import_premium_site_settings(tenant_id)
        try:
            materialized_icons = self._resources.materialize_icon_resources(
                read_member=read_member, icons=icons, tenant_id=tenant_id, account_id=account.id
            )
            if agent_package.metadata.icon_type == "image" and agent_package.metadata.icon in materialized_icons:
                agent_package.metadata.icon = materialized_icons[agent_package.metadata.icon]
            app_metadata = AgentPackageMetadata(
                name=agent_package.metadata.name,
                icon_type=app_dsl.app.get("icon_type"),
                icon=app_dsl.app.get("icon"),
                icon_background=app_dsl.app.get("icon_background"),
            )
            if app_metadata.icon_type == "image" and app_metadata.icon in materialized_icons:
                app_metadata.icon = materialized_icons[app_metadata.icon]
            site_data = app_dsl.site.model_copy(deep=True) if app_dsl.site is not None else None
            if site_data is not None and site_data.icon_type == "image":
                site_icon = site_data.icon
                if site_icon is not None and site_icon in materialized_icons:
                    site_data = site_data.model_copy(update={"icon": materialized_icons[site_icon]})
            for field_name, value in {
                "icon_type": icon_type,
                "icon": icon,
                "icon_background": icon_background,
            }.items():
                if value is not None:
                    setattr(agent_package.metadata, field_name, value)
                    setattr(app_metadata, field_name, value)
            materialized, skill_warnings = self._resources.materialize_resources(
                read_member=read_member,
                invalid_skills=invalid_skills,
                resources=resources,
                agent_package=agent_package,
                tenant_id=tenant_id,
                account_id=account.id,
            )
            with session_factory.create_session() as session:
                resolved_soul, warnings = AgentDslService(session).resolve_package_soul(
                    tenant_id=tenant_id,
                    package=AgentPackage(metadata=agent_package.metadata, soul=materialized.soul),
                    package_path="agent",
                )
            warnings = [*skill_warnings, *warnings]
            app_id, agent_id = self._persist_import(
                tenant_id=tenant_id,
                account=account,
                metadata=agent_package.metadata,
                app_metadata=app_metadata,
                site_data=site_data,
                allow_premium_site_settings=allow_premium_site_settings,
                soul=resolved_soul,
            )
        except Exception as exc:
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

        try:
            self._finalize_app(app_id=app_id, agent_id=agent_id, tenant_id=tenant_id, account=account)
        except Exception:
            logger.warning(
                "Imported Agent App post-commit initialization failed: tenant_id=%s app_id=%s",
                tenant_id,
                app_id,
                exc_info=True,
            )
        if app_dsl.dependencies:
            try:
                AppDslService.cache_import_dependencies(app_id=app_id, dependencies=app_dsl.dependencies)
            except Exception:
                logger.warning(
                    "Imported Agent App dependency check could not be cached: tenant_id=%s app_id=%s",
                    tenant_id,
                    app_id,
                    exc_info=True,
                )
        return RosterAgentPackageImportResult(app_id=app_id, agent_id=agent_id, warnings=warnings)

    @staticmethod
    def _persist_import(
        *,
        tenant_id: str,
        account: Account,
        metadata: AgentPackageMetadata,
        soul: AgentSoulConfig,
        app_metadata: AgentPackageMetadata | None = None,
        site_data: SiteDsl | None = None,
        allow_premium_site_settings: bool,
    ) -> tuple[str, str]:
        with session_factory.create_session() as session, session.begin():
            name = AgentDslService(session).unique_roster_name(tenant_id=tenant_id, requested=metadata.name)
            app = App(**default_app_templates[AppMode.AGENT]["app"])
            app.id = str(uuid4())
            app.tenant_id = tenant_id
            app.name = name
            app.description = metadata.description
            app.icon_type = DEFAULT_ICON_TYPE
            app.icon = DEFAULT_ICON
            app.icon_background = DEFAULT_ICON_BACKGROUND
            app_metadata = app_metadata or metadata
            if app_metadata.icon_type in {item.value for item in IconType} and is_valid_image_icon(
                session=session, tenant_id=tenant_id, icon_type=app_metadata.icon_type, icon=app_metadata.icon
            ):
                app.icon_type = IconType(app_metadata.icon_type)
                app.icon = app_metadata.icon or DEFAULT_ICON
                app.icon_background = app_metadata.icon_background or DEFAULT_ICON_BACKGROUND
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
                name=name,
                description=metadata.description,
                role=metadata.role,
                icon_type=app.icon_type,
                icon=app.icon,
                icon_background=app.icon_background,
                source=AgentSource.IMPORTED,
                initial_soul=soul,
                revision_operation=AgentConfigRevisionOperation.IMPORT_PACKAGE,
            )
            if metadata.icon_type in {item.value for item in AgentIconType} and is_valid_image_icon(
                session=session, tenant_id=tenant_id, icon_type=metadata.icon_type, icon=metadata.icon
            ):
                agent.icon_type = AgentIconType(metadata.icon_type)
                agent.icon = metadata.icon
                agent.icon_background = metadata.icon_background
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
            upload_file_ids = [
                item.file_id for item in soul.config_files if item.file_kind == "upload_file" and not item.is_missing
            ]
            if upload_file_ids:
                session.execute(
                    update(UploadFile)
                    .where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(upload_file_ids))
                    .values(used=True, used_by=account.id, used_at=naive_utc_now())
                )
            create_site_record(app=app, account=account, session=session)
            if site_data is not None:
                site = app.site_with_session(session=session)
                if site is None:
                    raise RuntimeError("Imported App Site is unavailable")
                apply_site_dsl(
                    site=site,
                    app=app,
                    data=site_data,
                    session=session,
                    allow_premium_settings=allow_premium_site_settings,
                )
            create_installed_app_record(app=app, session=session)
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


__all__ = ["RosterAgentPackageImportResult", "RosterAgentPackageImporter"]
