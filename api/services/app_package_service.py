"""Package App DSLs and their node-bound Agent resources."""

from __future__ import annotations

import hashlib
import re
import tempfile
import zipfile
import zlib
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, BinaryIO, Literal, Self, cast

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from core.db.session_factory import session_factory
from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidator
from models.agent import WorkflowAgentBindingType
from models.agent_config_entities import WorkflowNodeJobConfig
from models.model import App
from services.agent.dsl_entities import AgentPackage
from services.agent.errors import InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError
from services.agent.package_resource_exporter import AgentPackageResourceExporter
from services.agent.package_resource_importer import AgentPackageResourceImporter
from services.agent.roster_package_entities import (
    AgentPackageResources,
    PackageIcon,
    PreparedPackageArchive,
    RosterAgentPackageApp,
    RosterAgentPackageExport,
    RosterAgentPackageFile,
    RosterAgentPackageMember,
    RosterAgentPackageSkill,
    validate_icon_references,
)
from services.agent.roster_package_reader import RosterAgentPackageReader
from services.dsl_content import DSL_MAX_SIZE
from services.entities.dsl_entities import DslImportWarning


class AppPackageManifest(BaseModel):
    """Index Agent resources by the same package references used in the workflow DSL."""

    model_config = ConfigDict(extra="forbid")

    format: Literal["dify.app"]
    format_version: Literal[1]
    apps: list[RosterAgentPackageApp] = Field(min_length=1, max_length=1)
    agent_resources: dict[str, AgentPackageResources] = Field(default_factory=dict)
    icons: list[PackageIcon] = Field(default_factory=list)

    def iter_resources(self) -> Iterator[RosterAgentPackageSkill | RosterAgentPackageFile | PackageIcon]:
        yield from self.icons
        for group in self.agent_resources.values():
            yield from group.skills
            yield from group.files

    @model_validator(mode="after")
    def validate_resource_paths(self) -> Self:
        resources = list(self.iter_resources())
        paths = [item.path.casefold() for item in [*self.apps, *resources]]
        ids = [item.id for item in resources]
        if len(paths) != len(set(paths)) or len(ids) != len(set(ids)):
            raise ValueError("App package resources must have unique paths and ids")
        return self


@dataclass(kw_only=True)
class PreparedAppPackage(PreparedPackageArchive):
    dsl: str
    agents: dict[str, AgentPackage]
    agent_resources: dict[str, AgentPackageResources]
    icons: list[PackageIcon] = field(default_factory=list)

    def materialize_icons(self, *, data: dict[str, Any], tenant_id: str, account_id: str) -> None:
        importer = AgentPackageResourceImporter()
        for ref, resources in self.agent_resources.items():
            importer.validate(resources=resources, agent_package=self.agents[ref])
        mapping = importer.materialize_icons(archive=self, icons=self.icons, tenant_id=tenant_id, account_id=account_id)
        metadata = [data["app"], *(agent.metadata for agent in self.agents.values())]
        for item in metadata:
            if isinstance(item, dict):
                if item.get("icon_type") == "image" and item.get("icon") in mapping:
                    item["icon"] = mapping[item["icon"]]
            elif item.icon_type == "image" and item.icon in mapping:
                item.icon = mapping[item.icon]

    def materialize_agents(self, *, tenant_id: str, account_id: str) -> tuple[dict[str, Any], list[DslImportWarning]]:
        importer = AgentPackageResourceImporter()
        # Validate every Agent before uploading any resource.
        for ref, resources in self.agent_resources.items():
            importer.validate(resources=resources, agent_package=self.agents[ref])
        agents = dict(self.agents)
        warnings: list[DslImportWarning] = []
        for ref, resources in self.agent_resources.items():
            agents[ref], resource_warnings = importer.materialize(
                archive=self, resources=resources, agent_package=agents[ref], tenant_id=tenant_id, account_id=account_id
            )
            warnings.extend(
                warning.model_copy(update={"path": f"agent_packages.{ref}.{warning.path}"})
                for warning in resource_warnings
            )
        return {ref: agent.model_dump(mode="json") for ref, agent in agents.items()}, warnings


class AppPackageService(RosterAgentPackageReader):
    """Reuse the bounded ZIP reader; Apps retain DSL import semantics."""

    def read_package(self, source: BinaryIO) -> PreparedAppPackage | None:
        """Validate an App archive, or rewind a Roster package for its importer."""
        spool = cast(BinaryIO, tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b"))  # noqa: SIM115
        try:
            self._copy_bounded(source, spool)
            spool.seek(0)
            with zipfile.ZipFile(spool) as archive:
                infos = self._index_archive(archive)
                data, manifest_size = self._read_yaml_document(archive, infos, "manifest.yaml")
                if isinstance(data, dict) and data.get("format") == "dify.roster-agent":
                    spool.close()
                    return None
                try:
                    manifest = AppPackageManifest.model_validate(data)
                except ValidationError as exc:
                    raise InvalidRosterAgentPackageError("App package manifest is invalid") from exc
                resource = manifest.apps[0]
                resources = list(manifest.iter_resources())
                if set(infos) != {"manifest.yaml", resource.path, *(item.path for item in resources)}:
                    raise InvalidRosterAgentPackageError("App package members do not match the manifest")
                app_data, app_size = self._read_yaml_document(
                    archive, infos, resource.path, resource=resource, max_bytes=DSL_MAX_SIZE
                )
                if (
                    not isinstance(app_data, dict)
                    or app_data.get("kind") != "app"
                    or not isinstance(app_data.get("app"), dict)
                    or app_data["app"].get("mode")
                    not in {"workflow", "advanced-chat", "chat", "completion", "agent-chat", "channel", "rag-pipeline"}
                ):
                    raise InvalidRosterAgentPackageError("App package DSL is invalid")
                agents = self._validate_agents(app_data, manifest)
                try:
                    validate_icon_references(
                        manifest.icons, [app_data["app"], *(agent.metadata.model_dump() for agent in agents.values())]
                    )
                except ValueError as exc:
                    raise InvalidRosterAgentPackageError("App package icon references are invalid") from exc
                members: dict[str, RosterAgentPackageMember] = {}
                invalid_skills: dict[str, str] = {}
                self._validate_resource_members(
                    archive,
                    infos,
                    resources,
                    members=members,
                    invalid_skills=invalid_skills,
                    streamed_size=manifest_size + app_size,
                )
                # Preserve the original text for version confirmation and legacy DSL handling.
                dsl = archive.read(resource.path).decode("utf-8")
            spool.seek(0)
            return PreparedAppPackage(
                archive=spool,
                dsl=dsl,
                agents=agents,
                agent_resources=manifest.agent_resources,
                icons=manifest.icons,
                members=members,
                invalid_skills=invalid_skills,
            )
        except (InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError):
            spool.close()
            raise
        except (OSError, zipfile.BadZipFile, EOFError, RuntimeError, ValueError, zlib.error) as exc:
            spool.close()
            raise InvalidRosterAgentPackageError("App package is not a valid ZIP") from exc
        except BaseException:
            spool.close()
            raise
        finally:
            source.seek(0)

    @staticmethod
    def _validate_agents(data: dict[str, Any], manifest: AppPackageManifest) -> dict[str, AgentPackage]:
        if not manifest.agent_resources:
            return {}
        try:
            if data["app"]["mode"] not in {"workflow", "advanced-chat"}:
                raise ValueError("Agent resources require a workflow App")
            agents = {ref: AgentPackage.model_validate(value) for ref, value in data["agent_packages"].items()}
            references: set[str] = set()
            for _, node_data in WorkflowAgentNodeValidator.iter_agent_v2_nodes(data["workflow"]["graph"]):
                binding = node_data["agent_binding"]
                WorkflowAgentBindingType(binding["binding_type"])
                reference = binding["package_ref"]
                if not isinstance(reference, str):
                    raise ValueError("Agent package reference must be a string")
                references.add(reference)
                WorkflowNodeJobConfig.model_validate(node_data.get("agent_job") or {})
            if set(agents) != set(manifest.agent_resources) or references != set(agents):
                raise ValueError("Agent resources must match workflow package references")
            for ref, group in manifest.agent_resources.items():
                group.validate_packages([agents[ref]])
            return agents
        except (KeyError, TypeError, AttributeError, ValueError) as exc:
            raise InvalidRosterAgentPackageError("App package Agent references are invalid") from exc

    def export_app(
        self, *, app_model: App, include_secret: bool = False, workflow_id: str | None = None
    ) -> RosterAgentPackageExport:
        from services.app_dsl_service import AppDslService

        resources = AgentPackageResourceExporter()
        with session_factory.create_session() as session:
            data = AppDslService.export_data(
                app_model=app_model,
                session=session,
                include_secret=include_secret,
                workflow_id=workflow_id,
                resource_exporter=resources,
            )
            resources.collect_icon(session=session, tenant_id=app_model.tenant_id, metadata=data["app"])
        resources.collect_workspace_skills()
        if resources.packages:
            data["agent_packages"] = {
                ref: package.model_dump(mode="json") for ref, package in resources.packages.items()
            }
        return self.export(dsl=yaml.dump(data, allow_unicode=True), name=app_model.name, resources=resources)

    def export(
        self, *, dsl: str, name: str, resources: AgentPackageResourceExporter | None = None
    ) -> RosterAgentPackageExport:
        payload = dsl.encode("utf-8")
        if len(payload) > DSL_MAX_SIZE:
            raise RosterAgentPackageTooLargeError("App package DSL exceeds the size limit")
        archive = cast(BinaryIO, tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b"))  # noqa: SIM115
        try:
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
                agent_resources, total_size = resources.write_resources(package) if resources is not None else ({}, 0)
                icons, _ = resources.write_icons(package, total_size=total_size) if resources is not None else ([], 0)
                manifest = AppPackageManifest(
                    format="dify.app",
                    format_version=1,
                    apps=[
                        RosterAgentPackageApp(
                            path="app.yaml", size=len(payload), sha256=hashlib.sha256(payload).hexdigest()
                        )
                    ],
                    agent_resources=agent_resources,
                    icons=icons,
                )
                package.writestr(
                    "manifest.yaml", yaml.safe_dump(manifest.model_dump(mode="json", exclude_defaults=True))
                )
                package.writestr("app.yaml", payload)
            size = archive.tell()
            archive.seek(0)
            # Validate exported containers against the same limits as imports.
            validated = self.read_package(archive)
            if validated is None:
                raise InvalidRosterAgentPackageError("Expected an App package")
            validated.close()
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80] or "app"
            return RosterAgentPackageExport(archive=archive, filename=f"{slug}.ifpkg", size=size)
        except Exception:
            archive.close()
            raise
