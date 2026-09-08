"""Portable workflow files and their published workflow-tool deployments."""

from __future__ import annotations

import copy
import io
import json
import zipfile
from collections.abc import Iterator
from typing import TYPE_CHECKING, Any, Literal
from uuid import uuid4

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session

from configs import dify_config
from core.plugin.entities.plugin import PluginDependency
from core.rbac import RBACPermission, RBACResourceScope
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    EmojiIconDict,
    ToolProviderEntity,
    ToolProviderIdentity,
    ToolProviderType,
    WorkflowToolParameterConfiguration,
)
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController
from core.trigger.constants import is_trigger_node_type
from enums import DeploymentEdition
from events.app_event import app_published_workflow_was_updated
from libs.helper import alphanumeric
from models import Account, App, AppMode
from models.tools import ToolLabelBinding, WorkflowToolProvider
from models.workflow import Workflow
from services.agent.prompt_mentions import rewrite_workflow_tool_mentions
from services.dsl_content import DSL_MAX_SIZE
from services.enterprise.enterprise_service import EnterpriseService
from services.enterprise.rbac_service import RBACService
from services.errors.account import NoPermissionError
from services.feature_service import FeatureService
from services.system_feature_service import SystemFeatureService
from services.workflow_service import WorkflowService

if TYPE_CHECKING:
    from services.app_dsl_service import AppDslService


MAX_BUNDLE_WORKFLOWS = 128


class BundleWorkflow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file: str
    published: bool = False
    marked_name: str = ""
    marked_comment: str = ""
    enable_api: bool = True
    enable_site: bool = True


class BundleTool(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow: str
    name: str = Field(min_length=1, max_length=255)
    label: str = Field(max_length=255)
    icon: EmojiIconDict
    description: str
    parameters: list[WorkflowToolParameterConfiguration] = Field(default_factory=list)
    privacy_policy: str = Field(default="", max_length=255)
    labels: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return alphanumeric(value)


class BundleManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["workflow_bundle"] = "workflow_bundle"
    version: Literal["1"] = "1"
    entrypoint: str
    workflows: dict[str, BundleWorkflow]
    tools: dict[str, BundleTool]
    relationships: dict[str, list[str]]


class WorkflowDslBundle(BaseModel):
    manifest: BundleManifest
    documents: dict[str, dict[str, Any]]


def _validate_document_tree(document: dict[str, Any]) -> None:
    pending: list[Any] = [document]
    seen: set[int] = set()
    while pending:
        value = pending.pop()
        if not isinstance(value, dict | list):
            continue
        if id(value) in seen or len(seen) >= 100_000:
            raise ValueError("Workflow bundle YAML must be a bounded tree without aliases")
        seen.add(id(value))
        if isinstance(value, list):
            pending.extend(value)
            continue
        pending.extend(value.values())


def _tool_references(document: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Read tool configuration slots, never rewrite user inputs or variable values."""
    references: list[dict[str, Any]] = []
    for node in document.get("workflow", {}).get("graph", {}).get("nodes", []):
        data = node.get("data", {})
        if data.get("type") == "tool" and data.get("provider_type") == "workflow":
            references.append(data)
        elif data.get("type") == "agent":
            candidates = list(data.get("tools") or [])
            for parameter in (data.get("agent_parameters") or {}).values():
                if isinstance(parameter, dict):
                    value = parameter.get("value")
                    candidates.extend(value if isinstance(value, list) else [value])
            for tool in candidates:
                if (
                    isinstance(tool, dict)
                    and "tool_name" in tool
                    and (tool.get("provider_type") or tool.get("type")) == "workflow"
                ):
                    references.append(tool)
    for package in document.get("agent_packages", {}).values():
        for tool in package.get("soul", {}).get("tools", {}).get("dify_tools", []):
            if tool.get("provider_type") == "workflow":
                references.append(tool)
    for reference in references:
        provider_id = _provider_id(reference)
        if not isinstance(provider_id, str) or not provider_id:
            raise ValueError("Workflow tool reference is missing its provider identifier")
        yield reference


def _provider_id(reference: dict[str, Any]) -> str:
    return reference.get("provider_id") or reference.get("provider_name") or reference.get("provider", "")


def _rewrite_reference(reference: dict[str, Any], provider_id: str, name: str) -> None:
    old_id = _provider_id(reference)
    if reference.get("provider") == old_id:
        reference["provider"] = provider_id
    for key in ("provider_id", "provider_name"):
        if key in reference:
            reference[key] = provider_id
    reference["tool_name"] = name


class WorkflowDslBundleService:
    def __init__(self, session: Session):
        self._session = session

    def export_bundle(
        self,
        app_model: App,
        *,
        account: Account | None = None,
        include_secret: bool = False,
        workflow_id: str | None = None,
    ) -> bytes | None:
        """Export referenced snapshots once; leave ordinary DSL exports unchanged."""
        from services.app_dsl_service import AppDslService

        if app_model.mode not in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
            return None
        if account is not None and account.current_tenant_id != app_model.tenant_id:
            raise NoPermissionError("App is not in the current workspace")
        workflow = WorkflowService().get_draft_workflow(app_model, workflow_id, session=self._session)
        if workflow is None:
            raise ValueError("Workflow not found")
        manifest = BundleManifest(entrypoint="workflow_1", workflows={}, tools={}, relationships={})
        documents: dict[str, dict[str, Any]] = {}
        snapshots = {(app_model.id, workflow.id): manifest.entrypoint}
        providers: dict[str, str] = {}
        pending = [(manifest.entrypoint, app_model, workflow)]
        checked_apps: set[str] = set()
        while pending:
            marker, app, snapshot = pending.pop(0)
            if account is not None and app.id not in checked_apps:
                if dify_config.RBAC_ENABLED and app.maintainer != account.id:
                    if not RBACService.CheckAccess.check(
                        app.tenant_id,
                        account.id,
                        scene=RBACPermission.APP_IMPORT_EXPORT_DSL,
                        resource_type=RBACResourceScope.APP,
                        resource_id=app.id,
                    ):
                        raise NoPermissionError("You do not have permission to export a referenced workflow")
                checked_apps.add(app.id)
            document = yaml.safe_load(
                AppDslService.export_dsl(
                    app,
                    session=self._session,
                    include_secret=include_secret,
                    workflow_id=snapshot.id if snapshot.version != Workflow.VERSION_DRAFT else None,
                )
            )
            _validate_document_tree(document)
            references = list(_tool_references(document))
            if marker == manifest.entrypoint and not references:
                return None
            document["bundle_id"] = marker
            documents[marker] = document
            manifest.workflows[marker] = BundleWorkflow(
                file=f"workflows/{marker}.yaml",
                published=snapshot.version != Workflow.VERSION_DRAFT,
                marked_name=snapshot.marked_name or "",
                marked_comment=snapshot.marked_comment or "",
                enable_api=app.enable_api,
                enable_site=app.enable_site,
            )
            relationships: set[str] = set()
            for reference in references:
                source_id = _provider_id(reference)
                if source_id not in providers:
                    provider = self._session.scalar(
                        select(WorkflowToolProvider).where(
                            WorkflowToolProvider.tenant_id == app_model.tenant_id,
                            WorkflowToolProvider.id == source_id,
                        )
                    )
                    if provider is None:
                        raise ValueError("Referenced workflow tool not found in the current workspace")
                    child_app = self._session.scalar(
                        select(App).where(
                            App.tenant_id == app_model.tenant_id,
                            App.id == provider.app_id,
                            App.status == "normal",
                            App.mode == AppMode.WORKFLOW,
                        )
                    )
                    child_workflow = self._session.scalar(
                        select(Workflow).where(
                            Workflow.tenant_id == app_model.tenant_id,
                            Workflow.app_id == provider.app_id,
                            Workflow.version == provider.version,
                            Workflow.version != Workflow.VERSION_DRAFT,
                        )
                    )
                    if child_app is None or child_workflow is None:
                        raise ValueError("Referenced workflow tool deployment is missing")
                    key = (child_app.id, child_workflow.id)
                    if key not in snapshots:
                        if len(snapshots) >= MAX_BUNDLE_WORKFLOWS:
                            raise ValueError("Workflow bundle contains too many workflows")
                        snapshots[key] = f"workflow_{len(snapshots) + 1}"
                        pending.append((snapshots[key], child_app, child_workflow))
                    tool_marker = f"tool_{len(providers) + 1}"
                    providers[source_id] = tool_marker
                    manifest.tools[tool_marker] = BundleTool(
                        workflow=snapshots[key],
                        name=provider.name,
                        label=provider.label,
                        icon=json.loads(provider.icon),
                        description=provider.description,
                        parameters=provider.parameter_configurations,
                        privacy_policy=provider.privacy_policy or "",
                        labels=list(
                            self._session.scalars(
                                select(ToolLabelBinding.label_name).where(
                                    ToolLabelBinding.tool_id == provider.id,
                                    ToolLabelBinding.tool_type == ToolProviderType.WORKFLOW,
                                )
                            )
                        ),
                    )
                tool_marker = providers[source_id]
                relationships.add(tool_marker)
                rewrite_workflow_tool_mentions(document, {source_id: (tool_marker, manifest.tools[tool_marker].name)})
                _rewrite_reference(reference, tool_marker, manifest.tools[tool_marker].name)
            manifest.relationships[marker] = sorted(relationships)
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.yaml", yaml.safe_dump(manifest.model_dump(mode="json"), allow_unicode=True))
            for marker, document in documents.items():
                archive.writestr(manifest.workflows[marker].file, yaml.safe_dump(document, allow_unicode=True))
        result = output.getvalue()
        # Enforce the same archive constraints on both sides of the round trip.
        self.parse_bundle(result)
        return result

    @staticmethod
    def parse_bundle(content: bytes) -> WorkflowDslBundle:
        """Read in memory, bounding expansion and rejecting ambiguous archive members."""
        if len(content) > DSL_MAX_SIZE:
            raise ValueError("Workflow bundle exceeds the 10MB size limit")
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                entries = archive.infolist()
                names = {entry.filename for entry in entries}
                if (
                    len(entries) > MAX_BUNDLE_WORKFLOWS + 1
                    or len(names) != len(entries)
                    or sum(entry.file_size for entry in entries) > DSL_MAX_SIZE
                    or any(entry.flag_bits & 1 or entry.is_dir() for entry in entries)
                ):
                    raise ValueError("Invalid or oversized workflow bundle archive")
                if "manifest.yaml" not in names:
                    raise ValueError("Workflow bundle is missing manifest.yaml")
                manifest = BundleManifest.model_validate(yaml.safe_load(archive.read("manifest.yaml")))
                if not manifest.workflows or manifest.entrypoint not in manifest.workflows:
                    raise ValueError("Workflow bundle entrypoint is missing")
                expected_names = {"manifest.yaml"}
                documents: dict[str, dict[str, Any]] = {}
                for marker, workflow in manifest.workflows.items():
                    if not marker.isascii() or not marker.replace("_", "").isalnum():
                        raise ValueError("Invalid workflow bundle marker")
                    if workflow.file != f"workflows/{marker}.yaml" or workflow.file not in names:
                        raise ValueError("Workflow bundle file does not match its marker")
                    expected_names.add(workflow.file)
                    document = yaml.safe_load(archive.read(workflow.file))
                    if not isinstance(document, dict) or document.get("bundle_id") != marker:
                        raise ValueError("Workflow DSL is missing its independent bundle marker")
                    _validate_document_tree(document)
                    if document.get("kind") != "app" or not isinstance(document.get("workflow"), dict):
                        raise ValueError("Workflow bundle must contain workflow app DSL files")
                    app_data = document.get("app")
                    if not isinstance(app_data, dict):
                        raise ValueError("Workflow bundle is missing app metadata")
                    mode = app_data.get("mode")
                    if mode != AppMode.WORKFLOW and not (
                        marker == manifest.entrypoint and mode == AppMode.ADVANCED_CHAT
                    ):
                        raise ValueError("Invalid app mode in workflow bundle")
                    graph = document["workflow"].get("graph")
                    if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list):
                        raise ValueError("Workflow bundle is missing its graph")
                    for node in graph["nodes"]:
                        if not isinstance(node, dict) or not isinstance(node.get("data"), dict):
                            raise ValueError("Invalid workflow graph node")
                        node_type = node["data"].get("type")
                        if (
                            not isinstance(node_type, str)
                            or (
                                mode == AppMode.ADVANCED_CHAT
                                and (node_type == "end" or is_trigger_node_type(node_type))
                            )
                            or (mode == AppMode.WORKFLOW and node_type == "answer")
                        ):
                            raise ValueError("Workflow graph contains a node incompatible with its app mode")
                    documents[marker] = document
                if names != expected_names or set(manifest.relationships) != set(documents):
                    raise ValueError("Workflow bundle files or relationships do not match its manifest")
                deployed_workflows: set[str] = set()
                for tool in manifest.tools.values():
                    if tool.workflow not in documents or tool.workflow in deployed_workflows:
                        raise ValueError("Workflow tool deployment must identify one unique bundled workflow")
                    if not manifest.workflows[tool.workflow].published:
                        raise ValueError("Workflow tool deployment requires a published workflow")
                    deployed_workflows.add(tool.workflow)
                for marker, document in documents.items():
                    references = list(_tool_references(document))
                    tool_ids = {_provider_id(reference) for reference in references}
                    if tool_ids != set(manifest.relationships[marker]) or not tool_ids <= manifest.tools.keys():
                        raise ValueError("Workflow tool references do not match the bundle relationships")
                    if any(
                        reference.get("tool_name") != manifest.tools[_provider_id(reference)].name
                        for reference in references
                    ):
                        raise ValueError("Workflow tool names do not match their deployments")
                reachable = {manifest.entrypoint}
                pending = [manifest.entrypoint]
                used_tools: set[str] = set()
                while pending:
                    for tool_id in manifest.relationships[pending.pop()]:
                        used_tools.add(tool_id)
                        target = manifest.tools[tool_id].workflow
                        if target not in reachable:
                            reachable.add(target)
                            pending.append(target)
                if reachable != documents.keys() or used_tools != manifest.tools.keys():
                    raise ValueError("Workflow bundle contains unreachable workflows or tools")
                return WorkflowDslBundle(manifest=manifest, documents=documents)
        except (
            zipfile.BadZipFile,
            KeyError,
            AttributeError,
            TypeError,
            UnicodeError,
            yaml.YAMLError,
            RecursionError,
        ) as exc:
            raise ValueError("Invalid workflow bundle archive") from exc

    def import_bundle(
        self,
        bundle: WorkflowDslBundle,
        *,
        account: Account,
        dsl_service: AppDslService,
        app: App | None = None,
        name: str | None = None,
        description: str | None = None,
        icon_type: str | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
        import_app_id: str | None = None,
    ) -> App:
        """Create drafts, published snapshots and tools within the caller's transaction."""
        tenant_id = account.current_tenant_id
        if tenant_id is None or (app is not None and app.tenant_id != tenant_id):
            raise NoPermissionError("App is not in the current workspace")
        if dify_config.RBAC_ENABLED:
            for permission in (RBACPermission.APP_CREATE_AND_MANAGEMENT, RBACPermission.TOOL_MANAGE):
                if not RBACService.CheckAccess.check(tenant_id, account.id, scene=permission):
                    raise NoPermissionError("Creating bundled apps and workflow tools requires workspace permission")
            deployment = bundle.manifest.workflows[bundle.manifest.entrypoint]
            if app is not None and (
                deployment.published
                or deployment.enable_api != app.enable_api
                or deployment.enable_site != app.enable_site
            ):
                if app.maintainer != account.id and not RBACService.CheckAccess.check(
                    tenant_id,
                    account.id,
                    scene=RBACPermission.APP_RELEASE_AND_VERSION,
                    resource_type=RBACResourceScope.APP,
                    resource_id=app.id,
                ):
                    raise NoPermissionError("Publishing the imported workflow requires app release permission")
        elif not account.is_admin_or_owner:
            raise NoPermissionError("Only workspace administrators can import workflow tool deployments")
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            quota = FeatureService.get_features(tenant_id, exclude_vector_space=True).apps
            new_apps = len(bundle.documents) - int(app is not None)
            if quota.limit > 0 and quota.size + new_apps > quota.limit:
                raise ValueError("The bundled apps exceed the workspace subscription limit")

        documents = copy.deepcopy(bundle.documents)
        tool_ids = {marker: str(uuid4()) for marker in bundle.manifest.tools}
        existing_provider = (
            self._session.scalar(
                select(WorkflowToolProvider).where(
                    WorkflowToolProvider.tenant_id == tenant_id, WorkflowToolProvider.app_id == app.id
                )
            )
            if app is not None
            else None
        )
        entrypoint_tool = next(
            (marker for marker, tool in bundle.manifest.tools.items() if tool.workflow == bundle.manifest.entrypoint),
            None,
        )
        if existing_provider is not None and entrypoint_tool is not None:
            tool_ids[entrypoint_tool] = existing_provider.id
        existing_names = set(
            self._session.scalars(select(WorkflowToolProvider.name).where(WorkflowToolProvider.tenant_id == tenant_id))
        )
        if existing_provider is not None and entrypoint_tool is not None:
            existing_names.discard(existing_provider.name)
        tool_names: dict[str, str] = {}
        for marker, tool in bundle.manifest.tools.items():
            candidate = tool.name
            suffix = 1
            while candidate in existing_names:
                suffix += 1
                tail = f"_{suffix}"
                candidate = tool.name[: 255 - len(tail)] + tail
            existing_names.add(candidate)
            tool_names[marker] = candidate
        for document in documents.values():
            rewrite_workflow_tool_mentions(
                document, {marker: (tool_ids[marker], tool_names[marker]) for marker in bundle.manifest.tools}
            )
            for reference in _tool_references(document):
                marker = _provider_id(reference)
                _rewrite_reference(reference, tool_ids[marker], tool_names[marker])

        apps: dict[str, App] = {}
        for marker, document in documents.items():
            entrypoint = marker == bundle.manifest.entrypoint
            apps[marker] = dsl_service._create_or_update_app(
                app=app if entrypoint else None,
                data=document,
                account=account,
                name=name if entrypoint else None,
                description=description if entrypoint else None,
                icon_type=icon_type if entrypoint else None,
                icon=icon if entrypoint else None,
                icon_background=icon_background if entrypoint else None,
                import_app_id=import_app_id if entrypoint else None,
                dependencies=[PluginDependency.model_validate(item) for item in document.get("dependencies", [])],
                commit=False,
            )
            deployment = bundle.manifest.workflows[marker]
            apps[marker].enable_api = deployment.enable_api
            apps[marker].enable_site = deployment.enable_site
        published: dict[str, Workflow] = {}
        for marker, deployment in bundle.manifest.workflows.items():
            if deployment.published:
                published[marker] = WorkflowService().publish_workflow(
                    session=self._session,
                    app_model=apps[marker],
                    account=account,
                    marked_name=deployment.marked_name,
                    marked_comment=deployment.marked_comment,
                    emit_event=False,
                )
                apps[marker].workflow_id = published[marker].id
        for marker, tool in bundle.manifest.tools.items():
            provider = WorkflowToolProvider(
                tenant_id=tenant_id,
                user_id=account.id,
                app_id=apps[tool.workflow].id,
                version=published[tool.workflow].version,
                name=tool_names[marker],
                label=tool.label,
                icon=json.dumps(tool.icon),
                description=tool.description,
                parameter_configuration=json.dumps(
                    [parameter.model_dump(mode="json") for parameter in tool.parameters]
                ),
                privacy_policy=tool.privacy_policy,
            )
            provider.id = tool_ids[marker]
            # Validate against the uncommitted snapshot through the same owner as tool creation.
            controller = WorkflowToolProviderController(
                entity=ToolProviderEntity(
                    identity=ToolProviderIdentity(
                        author=account.name,
                        name=tool.label,
                        label=I18nObject(en_US=tool.label),
                        description=I18nObject(en_US=tool.description),
                        icon=provider.icon,
                    ),
                    credentials_schema=[],
                ),
                provider_id=provider.id,
            )
            controller._get_db_provider_tool(provider, apps[tool.workflow], session=self._session, user=account)
            if marker == entrypoint_tool and existing_provider is not None:
                self._session.merge(provider)
                self._session.execute(
                    delete(ToolLabelBinding).where(
                        ToolLabelBinding.tool_id == provider.id,
                        ToolLabelBinding.tool_type == ToolProviderType.WORKFLOW,
                    )
                )
            else:
                self._session.add(provider)
            for label in ToolLabelManager.filter_tool_labels(tool.labels):
                self._session.add(
                    ToolLabelBinding(tool_id=provider.id, tool_type=ToolProviderType.WORKFLOW, label_name=label)
                )
        self._session.flush()
        publications = [(apps[marker], workflow) for marker, workflow in published.items()]
        imported_apps = list(apps.values())

        def publish_events(_session: Session) -> None:
            if SystemFeatureService.is_webapp_auth_enabled():
                for imported_app in imported_apps:
                    EnterpriseService.WebAppAuth.update_app_access_mode(imported_app.id, "private")
            for imported_app, published_workflow in publications:
                app_published_workflow_was_updated.send(imported_app, published_workflow=published_workflow)
            publications.clear()
            imported_apps.clear()

        def discard_events(_session: Session) -> None:
            publications.clear()
            imported_apps.clear()

        event.listen(self._session, "after_commit", publish_events, once=True)
        event.listen(self._session, "after_rollback", discard_events, once=True)
        return apps[bundle.manifest.entrypoint]
