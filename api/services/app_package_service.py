"""Package App DSLs with Site icons, node-bound Agent resources and the workflows called as Workflow Tools."""

from __future__ import annotations

import hashlib
import re
import tempfile
import zipfile
import zlib
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, BinaryIO, Literal, Self, cast

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import select

from configs import dify_config
from constants.dsl_version import CURRENT_APP_DSL_VERSION
from core.db.session_factory import session_factory
from core.tools.entities.tool_entities import ToolProviderType, emoji_icon_adapter
from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidator
from models.agent import WorkflowAgentBindingType
from models.agent_config_entities import WorkflowNodeJobConfig
from models.model import App, AppMode
from models.tools import ToolLabelBinding, WorkflowToolProvider
from models.workflow import Workflow
from services.agent.dsl_entities import AGENT_NODE_JOB_DSL_KEY, AGENT_PACKAGE_REF_KEY, AgentPackage
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
from services.app_dsl_service import AppDslService
from services.dsl_content import DSL_MAX_SIZE
from services.dsl_version import check_version_compatibility
from services.entities.dsl_entities import AppDslExportData, DslImportWarning, ImportStatus, PackagedWorkflowTool
from services.entities.site_dsl import SiteDsl
from services.workflow_tool_references import iter_workflow_tool_references

_COPY_CHUNK_SIZE = 1024 * 1024

_AGENT_ID_KEY = "agent_id"


class AppPackageManifest(BaseModel):
    """Index Agent resources by the same package references used in the workflow DSL.

    Version 2 also bundles the workflows the App calls through Workflow Tools; other packages stay version 1.
    """

    model_config = ConfigDict(extra="ignore")

    format: Literal["dify.app"]
    format_version: Literal[1, 2]
    apps: list[RosterAgentPackageApp] = Field(min_length=1, max_length=1)
    agent_resources: dict[str, AgentPackageResources] = Field(default_factory=dict)
    icons: list[PackageIcon] = Field(default_factory=list)
    workflow_tools: list[PackagedWorkflowTool] = Field(default_factory=list)

    def iter_resources(self) -> Iterator[RosterAgentPackageSkill | RosterAgentPackageFile | PackageIcon]:
        yield from self.icons
        for group in self.agent_resources.values():
            yield from group.skills
            yield from group.files

    @model_validator(mode="after")
    def validate_resource_paths(self) -> Self:
        resources = [*self.iter_resources(), *self.workflow_tools]
        paths = [item.path.casefold() for item in [*self.apps, *resources]]
        ids = [item.id for item in resources]
        if len(paths) != len(set(paths)) or len(ids) != len(set(ids)):
            raise ValueError("App package resources must have unique paths and ids")
        if len({tool.provider_id for tool in self.workflow_tools}) != len(self.workflow_tools):
            raise ValueError("App package workflow tools must have unique provider ids")
        if (self.format_version == 2) != bool(self.workflow_tools):
            raise ValueError("App package format version 2 is used exactly when workflow tools are bundled")
        return self


@dataclass(kw_only=True)
class PreparedAppPackage(PreparedPackageArchive):
    dsl: str
    agents: dict[str, AgentPackage]
    agent_resources: dict[str, AgentPackageResources]
    workflow_tools: list[PackagedWorkflowTool]
    icons: list[PackageIcon] = field(default_factory=list)

    @property
    def has_resources(self) -> bool:
        return bool(self.agent_resources or self.icons)

    def materialize_icons(self, *, data: dict[str, Any], tenant_id: str, account_id: str) -> None:
        importer = AgentPackageResourceImporter()
        for ref, resources in self.agent_resources.items():
            importer.validate(resources=resources, agent_package=self.agents[ref])
        mapping = importer.materialize_icons(archive=self, icons=self.icons, tenant_id=tenant_id, account_id=account_id)
        metadata = [data["app"], *(agent.metadata for agent in self.agents.values())]
        if isinstance(data.get("site"), dict):
            metadata.append(data["site"])
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

    def open_workflow_tool(self, tool: PackagedWorkflowTool) -> PreparedAppPackage:
        return AppPackageService().read_workflow_tool(self, tool)


@dataclass(frozen=True)
class _WorkflowToolExport:
    definition: dict[str, Any]
    package: RosterAgentPackageExport


class AppPackageService(RosterAgentPackageReader):
    """Reuse the bounded ZIP reader; Apps retain DSL import semantics."""

    def read_package(self, source: BinaryIO, *, accept_roster_references: bool = False) -> PreparedAppPackage | None:
        """Validate an App archive, or rewind a Roster package for its importer."""
        return self._read_package(source, bundled=False, accept_roster_references=accept_roster_references)

    def read_workflow_tool(self, package: PreparedPackageArchive, tool: PackagedWorkflowTool) -> PreparedAppPackage:
        """Validate the nested archive of a workflow called through a packaged Workflow Tool."""
        # The nested archive is validated, and later imported, from its own spooled copy.
        member = cast(BinaryIO, tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b"))  # noqa: SIM115
        try:
            package.archive.seek(0)
            with zipfile.ZipFile(package.archive) as archive:
                digest = hashlib.sha256()
                size = 0
                with archive.open(archive.getinfo(tool.path)) as source:
                    while chunk := source.read(_COPY_CHUNK_SIZE):
                        size += len(chunk)
                        if size > tool.size:
                            raise InvalidRosterAgentPackageError("App package workflow tool failed integrity checks")
                        digest.update(chunk)
                        member.write(chunk)
            if size != tool.size or digest.hexdigest() != tool.sha256:
                raise InvalidRosterAgentPackageError("App package workflow tool failed integrity checks")
            member.seek(0)
            # Called workflows are always packaged with their own Agents, never roster links.
            nested = self._read_package(member, bundled=True, accept_roster_references=False)
            if nested is None:
                raise InvalidRosterAgentPackageError("App package workflow tool must be an App package")
            return nested
        except (KeyError, OSError, zipfile.BadZipFile, EOFError, RuntimeError, zlib.error) as exc:
            raise InvalidRosterAgentPackageError("App package workflow tool is not a valid ZIP") from exc
        finally:
            member.close()
            package.archive.seek(0)

    def _read_package(
        self, source: BinaryIO, *, bundled: bool, accept_roster_references: bool
    ) -> PreparedAppPackage | None:
        """Read an App archive; a ``bundled`` one is the workflow behind a packaged Workflow Tool."""
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
                if bundled and manifest.workflow_tools:
                    raise InvalidRosterAgentPackageError("App package workflow tools must not bundle workflow tools")
                if len(manifest.workflow_tools) > dify_config.APP_PACKAGE_MAX_WORKFLOW_TOOLS:
                    raise RosterAgentPackageTooLargeError("App package bundles too many workflow tools")
                resource = manifest.apps[0]
                resources = list(manifest.iter_resources())
                expected_members = {
                    "manifest.yaml",
                    resource.path,
                    *(item.path for item in resources),
                    *(tool.path for tool in manifest.workflow_tools),
                }
                if set(infos) != expected_members:
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
                    or (bundled and app_data["app"]["mode"] != AppMode.WORKFLOW)
                ):
                    raise InvalidRosterAgentPackageError("App package DSL is invalid")
                if bundled or manifest.workflow_tools:
                    self._require_confirmed_version(app_data)
                agents = self._validate_agents(app_data, manifest, accept_roster_references=accept_roster_references)
                site_data = app_data.get("site")
                if site_data is not None:
                    try:
                        SiteDsl.model_validate(site_data)
                    except ValidationError as exc:
                        raise InvalidRosterAgentPackageError("App package Site DSL is invalid") from exc
                try:
                    validate_icon_references(
                        manifest.icons,
                        [
                            app_data["app"],
                            *(agent.metadata.model_dump() for agent in agents.values()),
                            *([site_data] if site_data else []),
                        ],
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
            package = PreparedAppPackage(
                archive=spool,
                dsl=dsl,
                agents=agents,
                agent_resources=manifest.agent_resources,
                workflow_tools=manifest.workflow_tools,
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
        try:
            self._validate_workflow_tools(package)
        except BaseException:
            package.close()
            raise
        return package

    def _validate_workflow_tools(self, package: PreparedAppPackage) -> None:
        # Each nested archive is bounded on its own; the App and every workflow it calls also share one limit.
        expanded_size = len(package.dsl.encode("utf-8")) + sum(member.size for member in package.members.values())
        for tool in package.workflow_tools:
            with self.read_workflow_tool(package, tool) as nested:
                expanded_size += len(nested.dsl.encode("utf-8")) + sum(
                    member.size for member in nested.members.values()
                )
            if expanded_size > dify_config.AGENT_PACKAGE_MAX_BYTES:
                raise RosterAgentPackageTooLargeError("App package and its workflow tools exceed the size limit")

    @staticmethod
    def _require_confirmed_version(app_data: dict[str, Any]) -> None:
        # Packages with workflow tools import every App at once, so none may wait for version confirmation.
        version = app_data.get("version") or "0.1.0"
        if not isinstance(version, str) or check_version_compatibility(version, CURRENT_APP_DSL_VERSION) in {
            ImportStatus.PENDING,
            ImportStatus.FAILED,
        }:
            raise InvalidRosterAgentPackageError(
                f"App package DSL version {version} needs confirmation, "
                "which is not supported for packages with workflow tools"
            )

    @classmethod
    def _validate_agents(
        cls, data: dict[str, Any], manifest: AppPackageManifest, *, accept_roster_references: bool
    ) -> dict[str, AgentPackage]:
        agent_modes = {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}
        if not manifest.agent_resources:
            if not accept_roster_references:
                return {}
            if data["app"]["mode"] not in agent_modes:
                return {}
        try:
            if data["app"]["mode"] not in agent_modes:
                raise ValueError("Agent resources require a workflow App")
            packages = (data.get("agent_packages") or {}) if accept_roster_references else data["agent_packages"]
            agents = {ref: AgentPackage.model_validate(value) for ref, value in packages.items()}
            references: set[str] = set()
            for _, node_data in WorkflowAgentNodeValidator.iter_agent_v2_nodes(data["workflow"]["graph"]):
                binding = node_data["agent_binding"]
                binding_type = WorkflowAgentBindingType(binding["binding_type"])
                if accept_roster_references:
                    if cls._is_roster_reference(binding_type, binding):
                        cls._validate_roster_reference(binding, node_data)
                        continue
                    if binding_type == WorkflowAgentBindingType.ROSTER_AGENT:
                        if binding.get(_AGENT_ID_KEY) is not None:
                            raise ValueError("Agent binding cannot be both packaged and a roster reference")
                reference = binding[AGENT_PACKAGE_REF_KEY]
                if not isinstance(reference, str):
                    raise ValueError("Agent package reference must be a string")
                references.add(reference)
                WorkflowNodeJobConfig.model_validate(node_data.get(AGENT_NODE_JOB_DSL_KEY) or {})
            if set(agents) != set(manifest.agent_resources) or references != set(agents):
                raise ValueError("Agent resources must match workflow package references")
            for ref, group in manifest.agent_resources.items():
                group.validate_packages([agents[ref]])
            return agents
        except (KeyError, TypeError, AttributeError, ValueError) as exc:
            raise InvalidRosterAgentPackageError("App package Agent references are invalid") from exc

    @staticmethod
    def _is_roster_reference(binding_type: WorkflowAgentBindingType, binding: Mapping[str, Any]) -> bool:
        if binding_type != WorkflowAgentBindingType.ROSTER_AGENT:
            return False
        return AGENT_PACKAGE_REF_KEY not in binding

    @staticmethod
    def _validate_roster_reference(binding: Mapping[str, Any], node_data: Mapping[str, Any]) -> None:
        agent_id = binding.get(_AGENT_ID_KEY)
        if not isinstance(agent_id, str):
            raise ValueError("Roster Agent reference requires an agent id")
        if not agent_id:
            raise ValueError("Roster Agent reference requires an agent id")
        WorkflowNodeJobConfig.model_validate(node_data.get(AGENT_NODE_JOB_DSL_KEY) or {})

    def export_app(
        self,
        *,
        app_model: App,
        include_secret: bool = False,
        workflow_id: str | None = None,
        preserve_agent_bindings: bool = False,
        may_bundle: Callable[[App], bool],
    ) -> RosterAgentPackageExport:
        """Export an App with the workflows it calls; ``may_bundle`` admits each called workflow's App."""
        prepared, resources = self._prepare_export(
            app_model=app_model,
            include_secret=include_secret,
            workflow_id=workflow_id,
            preserve_agent_bindings=preserve_agent_bindings,
        )
        workflow_tools = self._export_workflow_tools(
            app_model=app_model, data=prepared.data, include_secret=include_secret, may_bundle=may_bundle
        )
        try:
            return self.export(
                dsl=AppDslService.serialize_export_data(prepared),
                name=app_model.name,
                resources=resources,
                accept_roster_references=preserve_agent_bindings,
                workflow_tools=workflow_tools,
            )
        finally:
            for workflow_tool in workflow_tools:
                workflow_tool.package.close()

    @staticmethod
    def _prepare_export(
        *, app_model: App, include_secret: bool, workflow_id: str | None, preserve_agent_bindings: bool
    ) -> tuple[AppDslExportData, AgentPackageResourceExporter]:
        resources = AgentPackageResourceExporter()
        with session_factory.create_session() as session:
            prepared = AppDslService.load_export_data(
                app_model=app_model,
                session=session,
                include_secret=include_secret,
                workflow_id=workflow_id,
                resource_exporter=resources,
                preserve_agent_bindings=preserve_agent_bindings,
            )
            resources.collect_icon(session=session, tenant_id=app_model.tenant_id, metadata=prepared.data["app"])
            if isinstance(prepared.data.get("site"), dict):
                resources.collect_icon(session=session, tenant_id=app_model.tenant_id, metadata=prepared.data["site"])
        resources.collect_workspace_skills()
        if resources.packages:
            prepared.data["agent_packages"] = {
                ref: package.model_dump(mode="json") for ref, package in resources.packages.items()
            }
        return prepared, resources

    def _export_workflow_tools(
        self, *, app_model: App, data: dict[str, Any], include_secret: bool, may_bundle: Callable[[App], bool]
    ) -> list[_WorkflowToolExport]:
        """Package every workflow reachable through Workflow Tools, at the version each tool runs.

        Workflows whose App the caller may not export stay plain references, and so do the workflows they call.
        """
        exports: list[_WorkflowToolExport] = []
        exported_size = 0
        visited: set[str] = set()
        pending = [data]
        try:
            while pending:
                provider_ids = {
                    reference.provider_id for item in pending for reference in iter_workflow_tool_references(item)
                } - visited
                visited |= provider_ids
                pending = []
                for provider, app, workflow, labels in self._load_workflow_tools(
                    tenant_id=app_model.tenant_id, provider_ids=provider_ids
                ):
                    if not may_bundle(app):
                        continue
                    if len(exports) >= dify_config.APP_PACKAGE_MAX_WORKFLOW_TOOLS:
                        raise RosterAgentPackageTooLargeError("App package calls too many workflow tools")
                    prepared, resources = self._prepare_export(
                        app_model=app,
                        include_secret=include_secret,
                        workflow_id=workflow.id,
                        preserve_agent_bindings=False,
                    )
                    pending.append(prepared.data)
                    package = self.export(
                        dsl=AppDslService.serialize_export_data(prepared),
                        name=app.name,
                        resources=resources,
                        workflow_tools=[],
                    )
                    exported_size += package.size
                    # Stop before packaging further workflows that the final archive could not hold anyway.
                    if exported_size > dify_config.AGENT_PACKAGE_MAX_BYTES:
                        package.close()
                        raise RosterAgentPackageTooLargeError("App package workflow tools exceed the size limit")
                    exports.append(
                        _WorkflowToolExport(
                            definition={
                                "provider_id": provider.id,
                                "name": provider.name,
                                "label": provider.label,
                                "icon": emoji_icon_adapter.validate_json(provider.icon),
                                "description": provider.description,
                                "parameters": provider.parameter_configurations,
                                "labels": labels,
                                "privacy_policy": provider.privacy_policy or "",
                            },
                            package=package,
                        )
                    )
        except BaseException:
            for workflow_tool in exports:
                workflow_tool.package.close()
            raise
        return exports

    @staticmethod
    def _load_workflow_tools(
        *, tenant_id: str, provider_ids: set[str]
    ) -> list[tuple[WorkflowToolProvider, App, Workflow, list[str]]]:
        # Snippet-backed and unavailable tools have no workflow App here and stay plain references.
        if not provider_ids:
            return []
        with session_factory.create_session() as session:
            rows = session.execute(
                select(WorkflowToolProvider, App, Workflow)
                .join(App, (App.id == WorkflowToolProvider.app_id) & (App.tenant_id == tenant_id))
                .join(
                    Workflow,
                    (Workflow.app_id == WorkflowToolProvider.app_id)
                    & (Workflow.version == WorkflowToolProvider.version)
                    & (Workflow.tenant_id == tenant_id),
                )
                .where(
                    WorkflowToolProvider.tenant_id == tenant_id,
                    WorkflowToolProvider.id.in_(sorted(provider_ids)),
                    App.mode == AppMode.WORKFLOW,
                    Workflow.version != Workflow.VERSION_DRAFT,
                )
                .order_by(WorkflowToolProvider.id)
            ).all()
            labels: dict[str, list[str]] = {}
            for tool_id, label_name in session.execute(
                select(ToolLabelBinding.tool_id, ToolLabelBinding.label_name).where(
                    ToolLabelBinding.tool_id.in_([provider.id for provider, _, _ in rows]),
                    ToolLabelBinding.tool_type == ToolProviderType.WORKFLOW,
                )
            ):
                labels.setdefault(tool_id, []).append(label_name)
        return [(provider, app, workflow, labels.get(provider.id, [])) for provider, app, workflow in rows]

    def export(
        self,
        *,
        dsl: str,
        name: str,
        resources: AgentPackageResourceExporter | None = None,
        accept_roster_references: bool = False,
        workflow_tools: Sequence[_WorkflowToolExport],
    ) -> RosterAgentPackageExport:
        payload = dsl.encode("utf-8")
        if len(payload) > DSL_MAX_SIZE:
            raise RosterAgentPackageTooLargeError("App package DSL exceeds the size limit")
        archive = cast(BinaryIO, tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b"))  # noqa: SIM115
        try:
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
                agent_resources, total_size = resources.write_resources(package) if resources is not None else ({}, 0)
                icons, _ = resources.write_icons(package, total_size=total_size) if resources is not None else ([], 0)
                packaged_tools = [
                    self._write_workflow_tool(package, workflow_tool, resource_id=f"w_{index:06d}")
                    for index, workflow_tool in enumerate(workflow_tools, start=1)
                ]
                manifest = AppPackageManifest(
                    format="dify.app",
                    format_version=2 if packaged_tools else 1,
                    apps=[
                        RosterAgentPackageApp(
                            path="app.yaml", size=len(payload), sha256=hashlib.sha256(payload).hexdigest()
                        )
                    ],
                    agent_resources=agent_resources,
                    icons=icons,
                    workflow_tools=packaged_tools,
                )
                package.writestr(
                    "manifest.yaml", yaml.safe_dump(manifest.model_dump(mode="json", exclude_defaults=True))
                )
                package.writestr("app.yaml", payload)
            size = archive.tell()
            archive.seek(0)
            # Validate exported containers against the same limits as imports.
            validated = self.read_package(archive, accept_roster_references=accept_roster_references)
            if validated is None:
                raise InvalidRosterAgentPackageError("Expected an App package")
            validated.close()
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80] or "app"
            return RosterAgentPackageExport(archive=archive, filename=f"{slug}.ifpkg", size=size)
        except Exception:
            archive.close()
            raise

    @staticmethod
    def _write_workflow_tool(
        package: zipfile.ZipFile, workflow_tool: _WorkflowToolExport, *, resource_id: str
    ) -> PackagedWorkflowTool:
        path = f"{resource_id}.ifpkg"
        digest = hashlib.sha256()
        size = 0
        workflow_tool.package.archive.seek(0)
        # Nested archives are already compressed.
        with package.open(zipfile.ZipInfo(path), "w") as member:
            while chunk := workflow_tool.package.archive.read(_COPY_CHUNK_SIZE):
                size += len(chunk)
                digest.update(chunk)
                member.write(chunk)
        return PackagedWorkflowTool.model_validate(
            {**workflow_tool.definition, "id": resource_id, "path": path, "size": size, "sha256": digest.hexdigest()}
        )
