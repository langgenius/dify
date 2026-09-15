"""Portable app DSL files, typed resources and their deployment relationships."""

from __future__ import annotations

import copy
import io
import json
import zipfile
from collections.abc import Iterator
from typing import TYPE_CHECKING, Annotated, Any, Literal
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


MAX_BUNDLE_APPS = 128
APP_DSL_MODES = frozenset(
    {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT, AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION, AppMode.AGENT}
)


class BundleWorkflow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    published: bool = False
    marked_name: str = ""
    marked_comment: str = ""


class BundleApp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["app"] = "app"
    file: str
    enable_api: bool = True
    enable_site: bool = True
    workflow: BundleWorkflow | None = None


class BundleTool(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["workflow_tool"] = "workflow_tool"
    app: str
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


class BundleRelationship(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["uses_tool"] = "uses_tool"
    source: str
    target: str


class BundleManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["app_bundle"] = "app_bundle"
    version: Literal["1"] = "1"
    entrypoint: str
    resources: dict[str, Annotated[BundleApp | BundleTool, Field(discriminator="kind")]]
    relationships: list[BundleRelationship]

    @property
    def apps(self) -> dict[str, BundleApp]:
        return {marker: resource for marker, resource in self.resources.items() if isinstance(resource, BundleApp)}

    @property
    def tools(self) -> dict[str, BundleTool]:
        return {marker: resource for marker, resource in self.resources.items() if isinstance(resource, BundleTool)}


class AppDslBundle(BaseModel):
    manifest: BundleManifest
    documents: dict[str, dict[str, Any]]


def _upgrade_workflow_manifest(data: dict[str, Any]) -> dict[str, Any]:
    """Read workflow bundles exported before the app-neutral manifest was introduced."""
    workflows = data.pop("workflows")
    tools = data.pop("tools")
    relationships = data.pop("relationships")
    if set(workflows) != set(relationships) or set(workflows) & set(tools):
        raise ValueError("Invalid legacy workflow bundle resources or relationships")
    resources: dict[str, Any] = {}
    for marker, workflow in workflows.items():
        resources[marker] = BundleApp(
            file=workflow.pop("file"),
            enable_api=workflow.pop("enable_api", True),
            enable_site=workflow.pop("enable_site", True),
            workflow=BundleWorkflow.model_validate(workflow),
        ).model_dump(mode="json")
    for marker, tool in tools.items():
        resources[marker] = BundleTool(app=tool.pop("workflow"), **tool).model_dump(mode="json")
    return {
        **data,
        "kind": "app_bundle",
        "resources": resources,
        "relationships": [
            BundleRelationship(source=source, target=target).model_dump(mode="json")
            for source, targets in relationships.items()
            for target in targets
        ],
    }


def _validate_document_tree(document: dict[str, Any]) -> None:
    pending: list[Any] = [document]
    seen: set[int] = set()
    while pending:
        value = pending.pop()
        if not isinstance(value, dict | list):
            continue
        if id(value) in seen or len(seen) >= 100_000:
            raise ValueError("App bundle YAML must be a bounded tree without aliases")
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
    for tool in document.get("model_config", {}).get("agent_mode", {}).get("tools", []):
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
    if "name" in reference and reference["name"] == reference.get("tool_name"):
        reference["name"] = name
    reference["tool_name"] = name


class AppDslBundleService:
    def __init__(self, session: Session):
        self._session = session

    def export_bundle(
        self,
        app_model: App,
        *,
        account: Account | None = None,
        include_secret: bool = False,
        workflow_id: str | None = None,
    ) -> bytes:
        """Bundle any supported app and export each referenced workflow snapshot once."""
        from services.app_dsl_service import AppDslService

        if app_model.mode not in APP_DSL_MODES:
            raise ValueError("App mode does not support DSL bundles")
        if account is not None and account.current_tenant_id != app_model.tenant_id:
            raise NoPermissionError("App is not in the current workspace")
        workflow = None
        if app_model.mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
            workflow = WorkflowService().get_draft_workflow(app_model, workflow_id, session=self._session)
            if workflow is None:
                raise ValueError("Workflow not found")
        elif workflow_id is not None:
            raise ValueError("Only workflow and chatflow apps support workflow versions")
        manifest = BundleManifest(entrypoint="app_1", resources={}, relationships=[])
        documents: dict[str, dict[str, Any]] = {}
        snapshots = {(app_model.id, workflow.id if workflow else None): manifest.entrypoint}
        providers: dict[str, str] = {}
        pending = [(manifest.entrypoint, app_model, workflow)]
        checked_apps: set[str] = set()
        while pending:
            marker, app, snapshot = pending.pop(0)
            if account is not None and app.id not in checked_apps:
                if app.mode == AppMode.AGENT:
                    AppDslService(self._session)._ensure_agent_dsl_permission(account, app=app)
                elif dify_config.RBAC_ENABLED and app.maintainer != account.id:
                    if not RBACService.CheckAccess.check(
                        app.tenant_id,
                        account.id,
                        scene=RBACPermission.APP_IMPORT_EXPORT_DSL,
                        resource_type=RBACResourceScope.APP,
                        resource_id=app.id,
                    ):
                        raise NoPermissionError("You do not have permission to export a bundled app")
                checked_apps.add(app.id)
            document = yaml.safe_load(
                AppDslService.export_dsl(
                    app,
                    session=self._session,
                    include_secret=include_secret,
                    workflow_id=(snapshot.id if snapshot and snapshot.version != Workflow.VERSION_DRAFT else None),
                )
            )
            _validate_document_tree(document)
            references = list(_tool_references(document))
            document["bundle_id"] = marker
            documents[marker] = document
            manifest.resources[marker] = BundleApp(
                file=f"apps/{marker}.yaml",
                workflow=BundleWorkflow(
                    published=snapshot.version != Workflow.VERSION_DRAFT,
                    marked_name=snapshot.marked_name or "",
                    marked_comment=snapshot.marked_comment or "",
                )
                if snapshot
                else None,
                # Agent DSL transfers an editable draft, not a published Agent snapshot.
                enable_api=app.enable_api if app.mode != AppMode.AGENT else False,
                enable_site=app.enable_site if app.mode != AppMode.AGENT else False,
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
                        if len(snapshots) >= MAX_BUNDLE_APPS:
                            raise ValueError("App bundle contains too many apps")
                        snapshots[key] = f"app_{len(snapshots) + 1}"
                        pending.append((snapshots[key], child_app, child_workflow))
                    tool_marker = f"tool_{len(providers) + 1}"
                    providers[source_id] = tool_marker
                    manifest.resources[tool_marker] = BundleTool(
                        app=snapshots[key],
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
            manifest.relationships.extend(
                BundleRelationship(source=marker, target=tool) for tool in sorted(relationships)
            )
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.yaml", yaml.safe_dump(manifest.model_dump(mode="json"), allow_unicode=True))
            for marker, document in documents.items():
                archive.writestr(manifest.apps[marker].file, yaml.safe_dump(document, allow_unicode=True))
        result = output.getvalue()
        # Enforce the same archive constraints on both sides of the round trip.
        self.parse_bundle(result)
        return result

    @staticmethod
    def parse_bundle(content: bytes) -> AppDslBundle:
        """Read in memory, bounding expansion and rejecting ambiguous archive members."""
        if len(content) > DSL_MAX_SIZE:
            raise ValueError("App bundle exceeds the 10MB size limit")
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                entries = archive.infolist()
                names = {entry.filename for entry in entries}
                if (
                    len(entries) > MAX_BUNDLE_APPS + 1
                    or len(names) != len(entries)
                    or sum(entry.file_size for entry in entries) > DSL_MAX_SIZE
                    or any(entry.flag_bits & 1 or entry.is_dir() for entry in entries)
                ):
                    raise ValueError("Invalid or oversized app bundle archive")
                if "manifest.yaml" not in names:
                    raise ValueError("App bundle is missing manifest.yaml")
                raw_manifest = yaml.safe_load(archive.read("manifest.yaml"))
                if not isinstance(raw_manifest, dict):
                    raise ValueError("App bundle manifest must be a mapping")
                _validate_document_tree(raw_manifest)
                legacy = raw_manifest.get("kind") == "workflow_bundle" and raw_manifest.get("version") == "1"
                manifest = BundleManifest.model_validate(
                    _upgrade_workflow_manifest(raw_manifest) if legacy else raw_manifest
                )
                apps, tools = manifest.apps, manifest.tools
                if not apps or manifest.entrypoint not in apps:
                    raise ValueError("App bundle entrypoint is missing")
                if any(not marker.isascii() or not marker.replace("_", "").isalnum() for marker in manifest.resources):
                    raise ValueError("Invalid app bundle marker")
                expected_names = {"manifest.yaml"}
                documents: dict[str, dict[str, Any]] = {}
                for marker, app in apps.items():
                    directory = "workflows" if legacy else "apps"
                    if app.file != f"{directory}/{marker}.yaml" or app.file not in names:
                        raise ValueError("App bundle file does not match its marker")
                    expected_names.add(app.file)
                    document = yaml.safe_load(archive.read(app.file))
                    if not isinstance(document, dict) or document.get("bundle_id") != marker:
                        raise ValueError("App DSL is missing its independent bundle marker")
                    _validate_document_tree(document)
                    if document.get("kind") != "app":
                        raise ValueError("App bundle must contain app DSL files")
                    app_data = document.get("app")
                    if not isinstance(app_data, dict):
                        raise ValueError("App bundle is missing app metadata")
                    mode = app_data.get("mode")
                    if mode not in APP_DSL_MODES:
                        raise ValueError("Invalid app mode in app bundle")
                    documents[marker] = document
                    if mode not in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
                        if app.workflow is not None:
                            raise ValueError("Only workflow and chatflow apps support workflow deployments")
                        if mode == AppMode.AGENT:
                            if app.enable_api or app.enable_site:
                                raise ValueError("Agent DSL bundles import unpublished drafts")
                            agent = document.get("agent", {})
                            if agent.get("package_ref") not in document.get("agent_packages", {}):
                                raise ValueError("Agent bundle is missing its package")
                        elif not isinstance(document.get("model_config"), dict) or not document["model_config"]:
                            raise ValueError("App bundle is missing its model configuration")
                        continue
                    if app.workflow is None or not isinstance(document.get("workflow"), dict):
                        raise ValueError("Workflow app is missing its workflow deployment or DSL")
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
                if names != expected_names:
                    raise ValueError("App bundle files do not match its manifest")
                deployed_workflows: set[str] = set()
                for tool in tools.values():
                    if tool.app not in documents or tool.app in deployed_workflows:
                        raise ValueError("Workflow tool deployment must identify one unique bundled workflow")
                    workflow = apps[tool.app].workflow
                    if documents[tool.app]["app"]["mode"] != AppMode.WORKFLOW or not workflow or not workflow.published:
                        raise ValueError("Workflow tool deployment requires a published workflow")
                    deployed_workflows.add(tool.app)
                relationships: dict[str, set[str]] = {marker: set() for marker in apps}
                for relationship in manifest.relationships:
                    if relationship.source not in apps or relationship.target not in tools:
                        raise ValueError("App bundle relationship refers to an incompatible or missing resource")
                    targets = relationships[relationship.source]
                    if relationship.target in targets:
                        raise ValueError("App bundle contains duplicate relationships")
                    targets.add(relationship.target)
                for marker, document in documents.items():
                    references = list(_tool_references(document))
                    tool_ids = {_provider_id(reference) for reference in references}
                    if tool_ids != relationships[marker]:
                        raise ValueError("Workflow tool references do not match the bundle relationships")
                    if any(
                        reference.get("tool_name") != tools[_provider_id(reference)].name for reference in references
                    ):
                        raise ValueError("Workflow tool names do not match their deployments")
                reachable = {manifest.entrypoint}
                pending = [manifest.entrypoint]
                used_tools: set[str] = set()
                while pending:
                    for tool_id in relationships[pending.pop()]:
                        used_tools.add(tool_id)
                        target = tools[tool_id].app
                        if target not in reachable:
                            reachable.add(target)
                            pending.append(target)
                if reachable != documents.keys() or used_tools != tools.keys():
                    raise ValueError("App bundle contains unreachable apps or tools")
                return AppDslBundle(manifest=manifest, documents=documents)
        except (
            zipfile.BadZipFile,
            KeyError,
            AttributeError,
            TypeError,
            UnicodeError,
            yaml.YAMLError,
            RecursionError,
        ) as exc:
            raise ValueError("Invalid app bundle archive") from exc

    def import_bundle(
        self,
        bundle: AppDslBundle,
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
            permissions = (
                [RBACPermission.APP_CREATE_AND_MANAGEMENT, RBACPermission.TOOL_MANAGE] if bundle.manifest.tools else []
            )
            for permission in permissions:
                if not RBACService.CheckAccess.check(tenant_id, account.id, scene=permission):
                    raise NoPermissionError("Creating bundled apps and workflow tools requires workspace permission")
            deployment = bundle.manifest.apps[bundle.manifest.entrypoint]
            if app is not None and (
                (deployment.workflow is not None and deployment.workflow.published)
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
        elif bundle.manifest.tools and not account.is_admin_or_owner:
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
            (marker for marker, tool in bundle.manifest.tools.items() if tool.app == bundle.manifest.entrypoint),
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
            deployment = bundle.manifest.apps[marker]
            apps[marker].enable_api = deployment.enable_api
            apps[marker].enable_site = deployment.enable_site
        published: dict[str, Workflow] = {}
        for marker, resource in bundle.manifest.apps.items():
            workflow_deployment = resource.workflow
            if workflow_deployment is not None and workflow_deployment.published:
                published[marker] = WorkflowService().publish_workflow(
                    session=self._session,
                    app_model=apps[marker],
                    account=account,
                    marked_name=workflow_deployment.marked_name,
                    marked_comment=workflow_deployment.marked_comment,
                    emit_event=False,
                )
                apps[marker].workflow_id = published[marker].id
        for marker, tool in bundle.manifest.tools.items():
            provider = WorkflowToolProvider(
                tenant_id=tenant_id,
                user_id=account.id,
                app_id=apps[tool.app].id,
                version=published[tool.app].version,
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
            controller._get_db_provider_tool(provider, apps[tool.app], session=self._session, user=account)
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
