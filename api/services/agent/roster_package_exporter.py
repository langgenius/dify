"""Export active Roster Agents as portable ``.ifpkg`` archives."""

from __future__ import annotations

import hashlib
import re
import tempfile
import zipfile
from collections.abc import Callable
from typing import BinaryIO, cast
from uuid import UUID

import yaml
from sqlalchemy import or_, select

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
from models.model import App, AppMode
from services.agent.dependency_service import extract_agent_soul_dependencies
from services.agent.dsl_entities import (
    AgentAppDsl,
    make_agent_app_dsl,
)
from services.agent.errors import (
    AgentNotFoundError,
    AgentVersionNotFoundError,
    RosterAgentPackageTooLargeError,
)
from services.agent.package_resource_exporter import AgentPackageResourceExporter, _Storage
from services.agent.roster_package_entities import (
    ROSTER_AGENT_PACKAGE_FORMAT,
    ROSTER_AGENT_PACKAGE_FORMAT_VERSION,
    RosterAgentPackageApp,
    RosterAgentPackageAudit,
    RosterAgentPackageExport,
    RosterAgentPackageManifest,
)
from services.agent.roster_service import AgentRosterService
from services.plugin.dependencies_analysis import DependenciesAnalysisService


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

    def export(self, *, tenant_id: str, agent_id: str, version_id: UUID | None) -> RosterAgentPackageExport:
        """Export a visible version, or the shared draft with an active snapshot fallback."""
        resources = AgentPackageResourceExporter(storage_backend=self._storage)
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

            draft = None
            snapshot_id = agent.active_config_snapshot_id
            if version_id is not None:
                snapshot = AgentRosterService(session).get_visible_agent_version_snapshot(
                    tenant_id=tenant_id, agent_id=agent.id, version_id=version_id
                )
                snapshot_id = snapshot.id
                soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
            else:
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
                    active_snapshot = session.scalar(
                        select(AgentConfigSnapshot)
                        .where(
                            AgentConfigSnapshot.id == snapshot_id,
                            AgentConfigSnapshot.tenant_id == tenant_id,
                            AgentConfigSnapshot.agent_id == agent.id,
                        )
                        .limit(1)
                    )
                    if active_snapshot is None:
                        raise AgentVersionNotFoundError()
                    soul = AgentSoulConfig.model_validate(active_snapshot.config_snapshot_dict)

            package = resources.collect_package(
                session=session,
                agent=agent,
                soul=soul,
                snapshot_id=snapshot_id,
                package_ref="agent_1",
                include_draft=draft is not None,
            )
            app = make_agent_app_dsl(app_model, package_ref="agent_1", packages={"agent_1": package}, dependencies=[])
            resources.collect_icon(session=session, tenant_id=tenant_id, metadata=app.app)
            audit = RosterAgentPackageAudit(ref=agent.id)
            dependency_ids = extract_agent_soul_dependencies(package.soul)

        resources.collect_workspace_skills()
        app.dependencies = self._dependency_provider(tenant_id, dependency_ids)
        return self._build_archive(
            app=app,
            audit=audit,
            resources=resources,
        )

    def _build_archive(
        self,
        *,
        app: AgentAppDsl,
        resources: AgentPackageResourceExporter,
        audit: RosterAgentPackageAudit | None = None,
    ) -> RosterAgentPackageExport:
        # Ownership is transferred to RosterAgentPackageExport.
        output = cast(
            BinaryIO,
            tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b"),  # noqa: SIM115
        )
        try:
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                groups, total_size = resources.write_resources(archive)
                group = groups[app.agent.package_ref]
                icons, total_size = resources.write_icons(archive, total_size=total_size)
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
                    icons=icons,
                    skills=group.skills,
                    files=group.files,
                )
                manifest.validate_apps({"app.yaml": app})
                manifest_bytes = yaml.safe_dump(
                    manifest.model_dump(mode="json", exclude_none=True, exclude={"icons"} if not icons else set()),
                    allow_unicode=True,
                    sort_keys=False,
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

    @staticmethod
    def _safe_slug(name: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        return slug[:80] or "agent"


__all__ = ["RosterAgentPackageExporter"]
