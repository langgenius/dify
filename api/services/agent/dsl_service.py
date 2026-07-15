"""Portable Agent package serialization and materialization.

Agent runtime configuration is split across immutable Soul snapshots and
workflow-node bindings, while App and Snippet DSLs must be independent of the
source workspace's database identifiers. This module owns that translation.
It deliberately excludes drive payloads and stored credentials from portable
packages; same-workspace copies may use the separate server-side clone path.
"""

from __future__ import annotations

import copy
import json
import logging
from collections.abc import Mapping
from typing import Any, cast

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from constants.model_template import default_app_templates
from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidator
from events.app_event import app_was_created
from graphon.enums import BuiltinNodeTypes
from models import Account
from models.agent import (
    APP_BACKED_AGENT_SOURCES,
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentIconType,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.model import App, AppMode, AppModelConfig, IconType
from models.workflow import Workflow
from services.agent.agent_soul_state import agent_soul_has_model
from services.agent.dsl_entities import (
    AGENT_NODE_JOB_DSL_KEY,
    AGENT_PACKAGE_REF_KEY,
    AgentPackage,
    AgentPackageMetadata,
    make_portable_agent_package,
    portable_ref,
)
from services.agent.knowledge_datasets import get_tenant_knowledge_dataset_rows
from services.agent.roster_service import AgentRosterService
from services.entities.dsl_entities import DslImportWarning
from services.plugin.dependencies_analysis import DependenciesAnalysisService

logger = logging.getLogger(__name__)


class AgentPackageImportResult(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    agent: Agent
    snapshot: AgentConfigSnapshot
    warnings: list[DslImportWarning] = Field(default_factory=list)


class AgentDslService:
    """Coordinates portable Agent packages with persisted Agent resources."""

    session: Session

    def __init__(self, session: Session) -> None:
        self.session = session

    def export_agent_app(self, *, app: App) -> tuple[str, dict[str, AgentPackage]]:
        """Export the editable shared Agent draft, falling back to the active snapshot."""

        agent = self.session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == app.tenant_id,
                Agent.app_id == app.id,
                Agent.scope == AgentScope.ROSTER,
                Agent.source.in_(APP_BACKED_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
            )
            .limit(1)
        )
        if agent is None:
            raise ValueError("Agent App has no active backing Agent.")

        draft = self.session.scalar(
            select(AgentConfigDraft)
            .where(
                AgentConfigDraft.tenant_id == app.tenant_id,
                AgentConfigDraft.agent_id == agent.id,
                AgentConfigDraft.draft_type == AgentConfigDraftType.DRAFT,
                AgentConfigDraft.draft_owner_key == "",
            )
            .limit(1)
        )
        if draft is not None:
            soul = AgentSoulConfig.model_validate(draft.config_snapshot_dict)
        else:
            snapshot = self._require_snapshot(
                tenant_id=app.tenant_id,
                agent_id=agent.id,
                snapshot_id=agent.active_config_snapshot_id,
            )
            soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)

        package_ref = "agent_1"
        return package_ref, {package_ref: make_portable_agent_package(agent, soul)}

    def export_workflow_packages(
        self, *, workflow: Workflow, graph: Mapping[str, Any]
    ) -> tuple[dict[str, Any], dict[str, AgentPackage]]:
        """Replace persisted Agent binding ids with portable package references."""

        portable_graph = copy.deepcopy(dict(graph))
        agent_nodes = dict(WorkflowAgentNodeValidator.iter_agent_v2_nodes(portable_graph))
        if not agent_nodes:
            return portable_graph, {}

        bindings = self.session.scalars(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.tenant_id == workflow.tenant_id,
                WorkflowAgentNodeBinding.workflow_id == workflow.id,
                WorkflowAgentNodeBinding.workflow_version == workflow.version,
                WorkflowAgentNodeBinding.node_id.in_(list(agent_nodes)),
            )
        ).all()
        bindings_by_node = {binding.node_id: binding for binding in bindings}
        packages: dict[str, AgentPackage] = {}
        package_refs_by_source: dict[tuple[str, str], str] = {}

        for node_id, raw_node_data in agent_nodes.items():
            node_data = cast(dict[str, Any], raw_node_data)
            binding = bindings_by_node.get(node_id)
            if binding is None or not binding.agent_id or not binding.current_snapshot_id:
                raise ValueError(f"Workflow Agent node {node_id} has no complete persisted binding.")
            agent = self._require_agent(tenant_id=workflow.tenant_id, agent_id=binding.agent_id)
            snapshot = self._require_snapshot(
                tenant_id=workflow.tenant_id,
                agent_id=agent.id,
                snapshot_id=binding.current_snapshot_id,
            )
            source_key = (agent.id, snapshot.id)
            package_ref = package_refs_by_source.get(source_key)
            if package_ref is None:
                package_ref = f"agent_{len(packages) + 1}"
                package_refs_by_source[source_key] = package_ref
                packages[package_ref] = make_portable_agent_package(
                    agent,
                    AgentSoulConfig.model_validate(snapshot.config_snapshot_dict),
                )
            node_data["agent_binding"] = {
                "binding_type": binding.binding_type.value,
                AGENT_PACKAGE_REF_KEY: package_ref,
            }
            node_data[AGENT_NODE_JOB_DSL_KEY] = WorkflowNodeJobConfig.model_validate(
                binding.node_job_config_dict
            ).model_dump(mode="json")

        return portable_graph, packages

    @staticmethod
    def graph_without_package_bindings(graph: Mapping[str, Any]) -> dict[str, Any]:
        """Return a graph that can be created before package ids are materialized."""

        result = copy.deepcopy(dict(graph))
        for _node_id, raw_node_data in WorkflowAgentNodeValidator.iter_agent_v2_nodes(result):
            node_data = cast(dict[str, Any], raw_node_data)
            binding = node_data.get("agent_binding")
            if isinstance(binding, Mapping) and binding.get(AGENT_PACKAGE_REF_KEY):
                node_data.pop("agent_binding", None)
            node_data.pop(AGENT_NODE_JOB_DSL_KEY, None)
        return result

    def import_agent_app_package(
        self,
        *,
        app: App,
        account: Account,
        package: AgentPackage,
    ) -> AgentPackageImportResult:
        """Create the imported backing Agent and its editable unpublished draft."""

        soul, warnings = self._resolve_package_soul(
            tenant_id=app.tenant_id,
            package=package,
            package_path="agent",
        )
        if app.app_model_config is None:
            model_config = AppModelConfig(app_id=app.id, created_by=account.id, updated_by=account.id)
            self.session.add(model_config)
            self.session.flush()
            app.app_model_config_id = model_config.id

        metadata = package.metadata
        agent = AgentRosterService(self.session).create_backing_agent_for_app(
            tenant_id=app.tenant_id,
            account_id=account.id,
            app_id=app.id,
            name=self._unique_roster_name(tenant_id=app.tenant_id, requested=app.name or metadata.name),
            description=app.description or metadata.description,
            role=metadata.role,
            icon_type=self._agent_icon_type(metadata.icon_type),
            icon=metadata.icon,
            icon_background=metadata.icon_background,
            source=AgentSource.IMPORTED,
            initial_soul=soul,
            revision_operation=AgentConfigRevisionOperation.IMPORT_PACKAGE,
        )
        snapshot = self._require_snapshot(
            tenant_id=app.tenant_id,
            agent_id=agent.id,
            snapshot_id=agent.active_config_snapshot_id,
        )
        self.session.add(
            AgentConfigDraft(
                tenant_id=app.tenant_id,
                agent_id=agent.id,
                draft_type=AgentConfigDraftType.DRAFT,
                account_id=None,
                draft_owner_key="",
                base_snapshot_id=snapshot.id,
                config_snapshot=soul,
                created_by=account.id,
                updated_by=account.id,
            )
        )
        agent.active_config_is_published = False
        app.name = app.name or metadata.name
        if not app.description:
            app.description = metadata.description
        self.session.flush()
        return AgentPackageImportResult(agent=agent, snapshot=snapshot, warnings=warnings)

    def import_workflow_packages(
        self,
        *,
        workflow: Workflow,
        portable_graph: Mapping[str, Any],
        raw_packages: Mapping[str, Any],
        account: Account,
    ) -> tuple[dict[str, Any], list[DslImportWarning]]:
        """Materialize packages and bindings for a Workflow or Snippet draft."""

        graph = copy.deepcopy(dict(portable_graph))
        packages = {key: AgentPackage.model_validate(value) for key, value in raw_packages.items()}
        previous_bindings = self.session.scalars(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.tenant_id == workflow.tenant_id,
                WorkflowAgentNodeBinding.app_id == workflow.app_id,
                WorkflowAgentNodeBinding.workflow_id == workflow.id,
                WorkflowAgentNodeBinding.workflow_version == Workflow.VERSION_DRAFT,
            )
        ).all()
        for binding in previous_bindings:
            self.session.delete(binding)
        self.session.flush()
        imported_roster: dict[str, AgentPackageImportResult] = {}
        warnings: list[DslImportWarning] = []

        for node_id, raw_node_data in WorkflowAgentNodeValidator.iter_agent_v2_nodes(graph):
            node_data = cast(dict[str, Any], raw_node_data)
            raw_binding = node_data.get("agent_binding")
            if not isinstance(raw_binding, Mapping):
                continue
            package_ref = raw_binding.get(AGENT_PACKAGE_REF_KEY)
            if not isinstance(package_ref, str):
                continue
            package = packages.get(package_ref)
            if package is None:
                raise ValueError(f"Workflow Agent node {node_id} references unknown package {package_ref!r}.")

            try:
                binding_type = WorkflowAgentBindingType(str(raw_binding.get("binding_type")))
            except ValueError as exc:
                raise ValueError(f"Workflow Agent node {node_id} has an invalid binding type.") from exc

            if binding_type == WorkflowAgentBindingType.ROSTER_AGENT:
                imported = imported_roster.get(package_ref)
                if imported is None:
                    imported = self._create_imported_roster_agent_app(
                        tenant_id=workflow.tenant_id,
                        account=account,
                        package=package,
                        package_path=f"agent_packages.{package_ref}",
                    )
                    imported_roster[package_ref] = imported
            else:
                imported = self._create_imported_inline_agent(
                    workflow=workflow,
                    node_id=node_id,
                    account=account,
                    package=package,
                    package_path=f"agent_packages.{package_ref}",
                )

            node_job = WorkflowNodeJobConfig.model_validate(node_data.get(AGENT_NODE_JOB_DSL_KEY) or {})
            self.session.add(
                WorkflowAgentNodeBinding(
                    tenant_id=workflow.tenant_id,
                    app_id=workflow.app_id,
                    workflow_id=workflow.id,
                    workflow_version=workflow.version,
                    node_id=node_id,
                    binding_type=binding_type,
                    agent_id=imported.agent.id,
                    current_snapshot_id=imported.snapshot.id,
                    node_job_config=node_job,
                    created_by=account.id,
                    updated_by=account.id,
                )
            )
            node_data["agent_binding"] = {
                "binding_type": binding_type.value,
                "agent_id": imported.agent.id,
                "current_snapshot_id": imported.snapshot.id,
            }
            node_data.pop(AGENT_NODE_JOB_DSL_KEY, None)
            warnings.extend(imported.warnings)

        workflow.graph = json.dumps(graph)
        self.session.flush()
        return graph, warnings

    def clone_inline_binding_for_node(
        self,
        *,
        workflow: Workflow,
        node_id: str,
        source_agent: Agent,
        source_snapshot: AgentConfigSnapshot,
        node_job: WorkflowNodeJobConfig,
        account_id: str,
    ) -> tuple[Agent, AgentConfigSnapshot]:
        """Clone a same-workspace Inline Agent for a pasted target node."""

        soul = AgentSoulConfig.model_validate(source_snapshot.config_snapshot_dict)
        metadata = AgentPackageMetadata(
            name=source_agent.name,
            description=source_agent.description,
            role=source_agent.role,
            icon_type=source_agent.icon_type.value if source_agent.icon_type else None,
            icon=source_agent.icon,
            icon_background=source_agent.icon_background,
        )
        agent, snapshot = self._create_workflow_only_agent(
            workflow=workflow,
            node_id=node_id,
            account_id=account_id,
            metadata=metadata,
            soul=soul,
            source=AgentSource.WORKFLOW,
            operation=AgentConfigRevisionOperation.CREATE_VERSION,
        )
        from services.agent.composer_service import AgentComposerService

        AgentComposerService._copy_agent_drive_rows(
            tenant_id=workflow.tenant_id,
            source_agent_id=source_agent.id,
            target_agent_id=agent.id,
            account_id=account_id,
            agent_soul=soul,
            node_job=node_job,
            session=self.session,
        )
        return agent, snapshot

    def extract_package_dependencies(self, packages: Mapping[str, AgentPackage]) -> list[str]:
        dependencies: list[str] = []
        for package in packages.values():
            soul = package.soul
            if soul.model is not None:
                dependencies.append(
                    DependenciesAnalysisService.analyze_model_provider_dependency(soul.model.model_provider)
                )
            for tool in soul.tools.dify_tools:
                provider_id = tool.provider_id or (
                    f"{tool.plugin_id}/{tool.provider}" if tool.plugin_id and tool.provider else None
                )
                if provider_id:
                    dependencies.append(DependenciesAnalysisService.analyze_tool_dependency(provider_id))
            for knowledge_set in soul.knowledge.sets:
                retrieval = knowledge_set.retrieval
                if retrieval.model is not None:
                    dependencies.append(
                        DependenciesAnalysisService.analyze_model_provider_dependency(retrieval.model.provider)
                    )
                if retrieval.reranking_model is not None:
                    dependencies.append(
                        DependenciesAnalysisService.analyze_model_provider_dependency(
                            retrieval.reranking_model.provider
                        )
                    )
        return dependencies

    def _create_imported_roster_agent_app(
        self,
        *,
        tenant_id: str,
        account: Account,
        package: AgentPackage,
        package_path: str,
    ) -> AgentPackageImportResult:
        metadata = package.metadata
        app_template = dict(default_app_templates[AppMode.AGENT]["app"])
        app = App(**app_template)
        app.name = metadata.name
        app.description = metadata.description
        app.mode = AppMode.AGENT
        app.icon_type = self._app_icon_type(metadata.icon_type)
        app.icon = metadata.icon
        app.icon_background = metadata.icon_background
        app.tenant_id = tenant_id
        app.enable_site = True
        app.enable_api = True
        app.created_by = account.id
        app.maintainer = account.id
        app.updated_by = account.id
        self.session.add(app)
        self.session.flush()
        app_was_created.send(app, account=account)
        self._configure_visible_agent_app_after_commit(
            tenant_id=tenant_id,
            app_id=app.id,
            account_id=account.id,
        )
        result = self.import_agent_app_package(app=app, account=account, package=package)
        result.warnings = [
            warning.model_copy(update={"path": f"{package_path}.{warning.path}"}) for warning in result.warnings
        ]
        return result

    def _create_imported_inline_agent(
        self,
        *,
        workflow: Workflow,
        node_id: str,
        account: Account,
        package: AgentPackage,
        package_path: str,
    ) -> AgentPackageImportResult:
        soul, warnings = self._resolve_package_soul(
            tenant_id=workflow.tenant_id,
            package=package,
            package_path=package_path,
        )
        agent, snapshot = self._create_workflow_only_agent(
            workflow=workflow,
            node_id=node_id,
            account_id=account.id,
            metadata=package.metadata,
            soul=soul,
            source=AgentSource.IMPORTED,
            operation=AgentConfigRevisionOperation.IMPORT_PACKAGE,
        )
        return AgentPackageImportResult(agent=agent, snapshot=snapshot, warnings=warnings)

    def _create_workflow_only_agent(
        self,
        *,
        workflow: Workflow,
        node_id: str,
        account_id: str,
        metadata: AgentPackageMetadata,
        soul: AgentSoulConfig,
        source: AgentSource,
        operation: AgentConfigRevisionOperation,
    ) -> tuple[Agent, AgentConfigSnapshot]:
        backing_app = AgentRosterService(self.session).create_hidden_backing_app_for_workflow_agent(
            tenant_id=workflow.tenant_id,
            account_id=account_id,
            name=metadata.name,
            description=metadata.description,
            icon_type=metadata.icon_type,
            icon=metadata.icon,
            icon_background=metadata.icon_background,
        )
        agent = Agent(
            tenant_id=workflow.tenant_id,
            name=metadata.name,
            description=metadata.description,
            role=metadata.role,
            icon_type=self._agent_icon_type(metadata.icon_type),
            icon=metadata.icon,
            icon_background=metadata.icon_background,
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=source,
            app_id=workflow.app_id,
            backing_app_id=backing_app.id,
            workflow_id=workflow.id,
            workflow_node_id=node_id,
            status=AgentStatus.ACTIVE,
            created_by=account_id,
            updated_by=account_id,
        )
        self.session.add(agent)
        self.session.flush()
        snapshot = self._create_snapshot(
            tenant_id=workflow.tenant_id,
            agent=agent,
            account_id=account_id,
            soul=soul,
            operation=operation,
        )
        agent.active_config_snapshot_id = snapshot.id
        agent.active_config_has_model = agent_soul_has_model(soul)
        agent.active_config_is_published = True
        self.session.flush()
        return agent, snapshot

    def _resolve_package_soul(
        self,
        *,
        tenant_id: str,
        package: AgentPackage,
        package_path: str,
    ) -> tuple[AgentSoulConfig, list[DslImportWarning]]:
        soul_data = package.soul.model_dump(mode="json")
        dataset_ids = [
            dataset["id"]
            for knowledge_set in soul_data.get("knowledge", {}).get("sets", [])
            for dataset in knowledge_set.get("datasets", [])
            if dataset.get("id")
        ]
        existing = get_tenant_knowledge_dataset_rows(tenant_id=tenant_id, dataset_ids=dataset_ids)
        warnings = [
            DslImportWarning(
                code=f"agent_{asset.kind}_omitted",
                path=f"{package_path}.omitted_assets",
                message=f"Agent {asset.kind} {asset.name!r} was not included in the portable package.",
                details={"kind": asset.kind, "name": asset.name},
            )
            for asset in package.omitted_assets
        ]
        for tool_index, tool in enumerate(package.soul.tools.dify_tools):
            tool_label = tool.tool_name or tool.provider or tool.provider_id
            warnings.append(
                DslImportWarning(
                    code="agent_tool_authorization_required",
                    path=f"{package_path}.soul.tools.dify_tools.{tool_index}",
                    message=f"Agent tool {tool_label!r} requires authorization.",
                    details={
                        "provider": tool.provider or tool.provider_id,
                        "tool_name": tool.tool_name,
                    },
                )
            )
        secret_refs = list(package.soul.env.secret_refs)
        for cli_tool in package.soul.tools.cli_tools:
            secret_refs.extend(cli_tool.env.secret_refs)
        for secret_ref in secret_refs:
            secret_name = secret_ref.name or secret_ref.env_name or secret_ref.key
            warnings.append(
                DslImportWarning(
                    code="agent_secret_required",
                    path=f"{package_path}.soul.env.secret_refs",
                    message=f"Agent secret {secret_name!r} must be configured.",
                    details={"name": secret_name},
                )
            )
        for contact_index, contact in enumerate(package.soul.human.contacts):
            warnings.append(
                DslImportWarning(
                    code="agent_human_contact_unresolved",
                    path=f"{package_path}.soul.human.contacts.{contact_index}",
                    message=f"Human contact {contact.name or contact.email or 'contact'!r} must be reselected.",
                    details={"name": contact.name, "email": contact.email},
                )
            )
        for set_index, knowledge_set in enumerate(soul_data.get("knowledge", {}).get("sets", [])):
            for dataset_index, dataset in enumerate(knowledge_set.get("datasets", [])):
                dataset_id = dataset.get("id")
                if dataset_id in existing:
                    continue
                dataset_name = dataset.get("name") or "Knowledge"
                dataset["id"] = portable_ref("missing-dataset", f"{dataset_id}:{dataset_name}")
                warnings.append(
                    DslImportWarning(
                        code="agent_knowledge_unresolved",
                        path=(f"{package_path}.soul.knowledge.sets.{set_index}.datasets.{dataset_index}"),
                        message=f"Knowledge dataset {dataset_name!r} is unavailable in the target workspace.",
                        details={"name": dataset_name},
                    )
                )
        return AgentSoulConfig.model_validate(soul_data), warnings

    def _create_snapshot(
        self,
        *,
        tenant_id: str,
        agent: Agent,
        account_id: str,
        soul: AgentSoulConfig,
        operation: AgentConfigRevisionOperation,
    ) -> AgentConfigSnapshot:
        next_version = (
            self.session.scalar(
                select(func.max(AgentConfigSnapshot.version)).where(
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    AgentConfigSnapshot.agent_id == agent.id,
                )
            )
            or 0
        ) + 1
        snapshot = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent.id,
            version=next_version,
            config_snapshot=soul,
            created_by=account_id,
        )
        self.session.add(snapshot)
        self.session.flush()
        revision = AgentConfigRevision(
            tenant_id=tenant_id,
            agent_id=agent.id,
            current_snapshot_id=snapshot.id,
            revision=1,
            operation=operation,
            created_by=account_id,
        )
        self.session.add(revision)
        self.session.flush()
        return snapshot

    def _unique_roster_name(self, *, tenant_id: str, requested: str) -> str:
        candidates = [requested]
        for index in range(1, 100):
            suffix = " import" if index == 1 else f" import {index}"
            candidates.append(f"{requested[: 255 - len(suffix)]}{suffix}")
        existing = set(
            self.session.scalars(
                select(Agent.name).where(
                    Agent.tenant_id == tenant_id,
                    Agent.scope == AgentScope.ROSTER,
                    Agent.status == AgentStatus.ACTIVE,
                    Agent.name.in_(candidates),
                )
            ).all()
        )
        return next(candidate for candidate in candidates if candidate not in existing)

    def _configure_visible_agent_app_after_commit(self, *, tenant_id: str, app_id: str, account_id: str) -> None:
        """Apply external RBAC and web-app visibility only after the DB transaction commits."""

        def configure(_session: Session) -> None:
            try:
                from services.enterprise import rbac_service as enterprise_rbac_service
                from services.enterprise.enterprise_service import EnterpriseService
                from services.feature_service import FeatureService

                enterprise_rbac_service.try_sync_creator_access_policy_member_bindings(
                    tenant_id,
                    account_id,
                    enterprise_rbac_service.RBACResourceType.APP,
                    app_id,
                )
                if FeatureService.get_system_features().webapp_auth.enabled:
                    EnterpriseService.WebAppAuth.update_app_access_mode(app_id, "private")
            except Exception:
                logger.exception("Failed to configure imported Agent App %s after commit", app_id)

        event.listen(self.session, "after_commit", configure, once=True)

    def _require_agent(self, *, tenant_id: str, agent_id: str) -> Agent:
        agent = self.session.scalar(select(Agent).where(Agent.tenant_id == tenant_id, Agent.id == agent_id).limit(1))
        if agent is None:
            raise ValueError("Agent package source Agent is unavailable.")
        return agent

    def _require_snapshot(self, *, tenant_id: str, agent_id: str, snapshot_id: str | None) -> AgentConfigSnapshot:
        if not snapshot_id:
            raise ValueError("Agent package source snapshot is unavailable.")
        snapshot = self.session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.tenant_id == tenant_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.id == snapshot_id,
            )
            .limit(1)
        )
        if snapshot is None:
            raise ValueError("Agent package source snapshot is unavailable.")
        return snapshot

    @staticmethod
    def _agent_icon_type(value: str | None) -> AgentIconType | None:
        return AgentIconType(value) if value else None

    @staticmethod
    def _app_icon_type(value: str | None) -> IconType:
        return IconType(value) if value else IconType.EMOJI


def is_agent_v2_graph(graph: Mapping[str, Any]) -> bool:
    return any(
        node.get("data", {}).get("type") == BuiltinNodeTypes.AGENT and node.get("data", {}).get("version") == "2"
        for node in graph.get("nodes", [])
        if isinstance(node, Mapping)
    )
