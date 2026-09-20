"""Collect node-bound Agent assets into a shared workflow App archive."""

from __future__ import annotations

import zipfile

from sqlalchemy.orm import Session

from extensions.ext_storage import storage
from models.agent import Agent, AgentConfigSnapshot
from models.agent_config_entities import AgentSoulConfig
from services.agent.dsl_entities import AgentPackage, AgentPackageWorkspaceSkill, make_portable_agent_package
from services.agent.package_resource_exporter import AgentPackageResourceExporter, _FileSource, _SkillSource, _Storage
from services.agent.roster_package_entities import AgentPackageResources
from services.skill_management_service import SkillManagementService


class WorkflowAgentPackageExporter(AgentPackageResourceExporter):
    def __init__(self, *, storage_backend: _Storage = storage) -> None:
        super().__init__(storage_backend=storage_backend)
        self._sources: dict[str, tuple[list[_SkillSource], list[_FileSource]]] = {}

    def collect_package(
        self, *, session: Session, agent: Agent, snapshot: AgentConfigSnapshot, package_ref: str
    ) -> AgentPackage:
        soul, skills, files = self._collect_payloads(
            session=session,
            tenant_id=agent.tenant_id,
            soul=AgentSoulConfig.model_validate(snapshot.config_snapshot_dict),
            skill_offset=sum(len(skills) for skills, _ in self._sources.values()),
            file_offset=sum(len(files) for _, files in self._sources.values()),
        )
        workspace_skills = self._workspace_skill_sources(
            soul=soul,
            archives=SkillManagementService(session=session).list_runtime_agent_skill_archives(
                tenant_id=agent.tenant_id, agent_id=agent.id, config_snapshot_id=snapshot.id
            ),
            start_index=sum(len(skills) for skills, _ in self._sources.values()) + len(skills),
        )
        skills.extend(workspace_skills)
        self._sources[package_ref] = skills, files
        return make_portable_agent_package(
            agent,
            soul,
            include_assets=True,
            workspace_skills=[
                AgentPackageWorkspaceSkill(
                    name=skill.name,
                    display_name=skill.display_name or "",
                    description=skill.description,
                    priority=skill.priority,
                )
                for skill in workspace_skills
                if skill.priority is not None
            ],
        )

    def write_resources(self, archive: zipfile.ZipFile) -> dict[str, AgentPackageResources]:
        skills, files, _ = self._write_resources(
            archive,
            skill_sources=[item for skills, _ in self._sources.values() for item in skills],
            file_sources=[item for _, files in self._sources.values() for item in files],
        )
        skill_by_id = {item.id: item for item in skills}
        file_by_id = {item.id: item for item in files}
        return {
            ref: AgentPackageResources(
                skills=[skill_by_id[item.id] for item in skill_sources],
                files=[file_by_id[item.id] for item in file_sources],
            )
            for ref, (skill_sources, file_sources) in self._sources.items()
        }
