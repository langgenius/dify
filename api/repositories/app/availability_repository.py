"""Collect tenant-owned dependency metadata without external I/O."""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.agent.publish_visibility import agent_has_workflow_callable_active_snapshot
from core.tools.entities.tool_entities import ToolProviderType
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from graphon.enums import BuiltinNodeTypes
from graphon.model_runtime.entities.model_entities import ModelType
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentScope,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentKnowledgeSetConfig, AgentSoulConfig
from models.dataset import Dataset, Document, ExternalKnowledgeApis, ExternalKnowledgeBindings
from models.enums import IndexingStatus
from models.model import App, AppMode, AppModelConfig
from models.provider_ids import ToolProviderID
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider, WorkflowToolProvider
from models.workflow import Workflow
from services.agent.knowledge_datasets import list_agent_soul_knowledge_dataset_ids
from services.entities.app_entities import (
    AppAvailabilityIssue,
    AppAvailabilityIssueType,
    AppAvailabilityPlan,
    AppAvailabilitySource,
    AppModelDependency,
    AppPluginDependency,
    AppToolDependency,
)

logger = logging.getLogger(__name__)


class AppAvailabilityRepository:
    """Evaluate an app definition without persisting a derived health flag.

    Studio describes the editable draft, independently of published history.
    Dependencies still follow their actual bindings: for example, a workflow
    tool referenced by a draft may call a pinned published workflow version.
    """

    def __init__(self, *, session: Session, tenant_id: str) -> None:
        self._session = session
        self._tenant_id = tenant_id
        self._dataset_cache: dict[str, Dataset | None] = {}
        self._dataset_ready_cache: dict[str, bool] = {}
        self._external_knowledge_reason_cache: dict[str, str | None] = {}
        self._agent_soul_cache: dict[tuple[str, str], AgentSoulConfig | None] = {}
        self._draft_workflow_cache: dict[str, Workflow | None] = {}
        self._visiting_workflows: set[str] = set()
        self._dependencies: list[AppModelDependency | AppToolDependency | AppPluginDependency] = []
        self._source: AppAvailabilitySource = "configuration"

    def collect_many(self, apps: Sequence[App]) -> dict[str, AppAvailabilityPlan]:
        draft_app_ids = [
            app.id
            for app in apps
            if app.tenant_id == self._tenant_id and app.mode in {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}
        ]
        if draft_app_ids:
            # The caller has already applied list permissions. Batch only those
            # visible apps, including negative lookups, rather than querying a
            # draft separately for every card in the page.
            self._draft_workflow_cache.update(dict.fromkeys(draft_app_ids))
            for workflow in self._session.scalars(
                select(Workflow).where(
                    Workflow.tenant_id == self._tenant_id,
                    Workflow.app_id.in_(draft_app_ids),
                    Workflow.version == Workflow.VERSION_DRAFT,
                )
            ):
                self._draft_workflow_cache[workflow.app_id] = workflow
        return {app.id: self.collect(app) for app in apps}

    def collect(self, app: App) -> AppAvailabilityPlan:
        issues: list[AppAvailabilityIssue] = []
        self._dependencies = []
        self._source = "configuration"
        try:
            if app.tenant_id != self._tenant_id:
                self._add_issue(
                    issues, type=AppAvailabilityIssueType.CONFIGURATION, reason="missing", resource_id=app.id
                )
            elif app.mode == AppMode.AGENT:
                self._evaluate_agent_app(app, issues)
            elif app.mode in {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}:
                self._evaluate_workflow_app(app, issues)
            else:
                self._evaluate_app_config(app, issues)
        except Exception:
            logger.exception("Failed to evaluate app availability, app_id=%s", app.id)
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.CONFIGURATION,
                reason="evaluation-failed",
                resource_id=app.id,
            )

        return AppAvailabilityPlan(
            source=self._source,
            reasons=tuple(dict.fromkeys(issues)),
            dependencies=tuple(dict.fromkeys(self._dependencies)),
        )

    def _evaluate_app_config(self, app: App, issues: list[AppAvailabilityIssue]) -> None:
        config = (
            self._session.scalar(
                select(AppModelConfig).where(
                    AppModelConfig.id == app.app_model_config_id,
                    AppModelConfig.app_id == app.id,
                )
            )
            if app.app_model_config_id
            else None
        )
        if config is None:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.CONFIGURATION,
                reason="not-configured",
                resource_id=app.id,
            )
            return

        model = config.model_dict
        self._check_model(
            issues,
            provider=model.get("provider") or config.provider,
            model=model.get("name") or config.model_id,
            model_type=ModelType.LLM,
            resource_id=app.id,
        )

        agent_mode = config.agent_mode_dict
        if agent_mode.get("enabled", False):
            for entry in agent_mode.get("tools", []):
                if not isinstance(entry, Mapping):
                    continue
                dataset = entry.get("dataset")
                if isinstance(dataset, Mapping):
                    dataset_id = dataset.get("id")
                    if dataset.get("enabled", False) and isinstance(dataset_id, str):
                        self._check_dataset(issues, dataset_id)
                elif entry.get("enabled", True):
                    self._check_tool_config(issues, entry, resource_id=app.id)

        self._evaluate_legacy_knowledge(config, issues, resource_id=app.id)

    def _evaluate_legacy_knowledge(
        self,
        config: AppModelConfig,
        issues: list[AppAvailabilityIssue],
        *,
        resource_id: str,
    ) -> None:
        dataset_configs = config.dataset_configs_dict
        datasets = dataset_configs.get("datasets", {})
        dataset_entries = datasets.get("datasets", []) if isinstance(datasets, Mapping) else []
        enabled_dataset_ids: list[str] = []
        retrievable_dataset_ids: set[str] = set()
        for entry in dataset_entries:
            if not isinstance(entry, Mapping):
                continue
            dataset = entry.get("dataset")
            if not isinstance(dataset, Mapping) or not dataset.get("enabled", False):
                continue
            dataset_id = dataset.get("id")
            if isinstance(dataset_id, str):
                enabled_dataset_ids.append(dataset_id)
                if self._check_dataset(issues, dataset_id):
                    retrievable_dataset_ids.add(dataset_id)

        # ``dataset_configs_dict`` defaults to ``retrieval_model=multiple`` for
        # legacy apps that have never configured a Knowledge. Empty defaults do
        # not represent runtime dependencies and must not make a plain chat app
        # unavailable.
        if not enabled_dataset_ids:
            return

        if dataset_configs.get("retrieval_model") == "multiple" and len(retrievable_dataset_ids) > 1:
            if dataset_configs.get("reranking_enabled", True):
                reranking_mode = dataset_configs.get("reranking_mode", "reranking_model")
                if reranking_mode == "reranking_model":
                    reranking_model = dataset_configs.get("reranking_model")
                    if isinstance(reranking_model, Mapping):
                        self._check_model(
                            issues,
                            provider=reranking_model.get("reranking_provider_name"),
                            model=reranking_model.get("reranking_model_name"),
                            model_type=ModelType.RERANK,
                            resource_id=resource_id,
                        )
                    else:
                        self._add_issue(
                            issues,
                            type=AppAvailabilityIssueType.KNOWLEDGE,
                            reason="not-configured",
                            resource_id=resource_id,
                        )
                elif reranking_mode == "weighted_score":
                    weights = dataset_configs.get("weights")
                    vector_setting = weights.get("vector_setting") if isinstance(weights, Mapping) else None
                    if isinstance(vector_setting, Mapping) and vector_setting.get("vector_weight", 0) > 0:
                        self._check_model(
                            issues,
                            provider=vector_setting.get("embedding_provider_name"),
                            model=vector_setting.get("embedding_model_name"),
                            model_type=ModelType.TEXT_EMBEDDING,
                            resource_id=resource_id,
                        )
                    elif not isinstance(vector_setting, Mapping):
                        self._add_issue(
                            issues,
                            type=AppAvailabilityIssueType.KNOWLEDGE,
                            reason="not-configured",
                            resource_id=resource_id,
                        )
                else:
                    self._add_issue(
                        issues,
                        type=AppAvailabilityIssueType.KNOWLEDGE,
                        reason="invalid-configuration",
                        resource_id=resource_id,
                    )

        if dataset_configs.get("metadata_filtering_mode") == "automatic":
            metadata_model = dataset_configs.get("metadata_model_config")
            if isinstance(metadata_model, Mapping):
                self._check_model(
                    issues,
                    provider=metadata_model.get("provider"),
                    model=metadata_model.get("name"),
                    model_type=ModelType.LLM,
                    resource_id=resource_id,
                )
            else:
                self._add_issue(
                    issues,
                    type=AppAvailabilityIssueType.KNOWLEDGE,
                    reason="not-configured",
                    resource_id=resource_id,
                )

    def _evaluate_workflow_app(self, app: App, issues: list[AppAvailabilityIssue]) -> None:
        self._source = "draft"
        workflow = self._load_draft_workflow(app.id)
        if workflow is None:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.WORKFLOW,
                reason="not-configured",
                resource_id=app.id,
            )
            return
        self._evaluate_workflow_graph(workflow, issues)

    def _evaluate_workflow_graph(self, workflow: Workflow, issues: list[AppAvailabilityIssue]) -> None:
        if workflow.id in self._visiting_workflows:
            # A workflow tool can recurse with an input-dependent base case.
            # Its dependencies are already being visited; the cycle alone does
            # not prove a blocking dependency or an execution failure.
            return
        self._visiting_workflows.add(workflow.id)
        try:
            self._collect_workflow_nodes(workflow, issues)
        finally:
            self._visiting_workflows.remove(workflow.id)

    def _collect_workflow_nodes(self, workflow: Workflow, issues: list[AppAvailabilityIssue]) -> None:
        try:
            nodes = list(workflow.walk_nodes())
        except Exception:
            logger.exception("Failed to read workflow graph, workflow_id=%s", workflow.id)
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.WORKFLOW,
                reason="invalid-configuration",
                resource_id=workflow.id,
            )
            return
        if not nodes:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.WORKFLOW,
                reason="not-configured",
                resource_id=workflow.id,
            )
            return

        for node_id, node_data in nodes:
            if not isinstance(node_data, Mapping):
                self._add_issue(
                    issues,
                    type=AppAvailabilityIssueType.WORKFLOW,
                    reason="invalid-configuration",
                    resource_id=node_id,
                )
                continue

            node_type = str(node_data.get("type", ""))
            if node_type in {
                BuiltinNodeTypes.LLM,
                BuiltinNodeTypes.QUESTION_CLASSIFIER,
                BuiltinNodeTypes.PARAMETER_EXTRACTOR,
            }:
                model = node_data.get("model")
                self._check_model(
                    issues,
                    provider=self._value(model, "provider"),
                    model=self._value(model, "name"),
                    model_type=ModelType.LLM,
                    resource_id=node_id,
                )
            elif node_type == BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL:
                self._evaluate_workflow_knowledge_node(node_data, issues, resource_id=node_id)
            elif node_type == KNOWLEDGE_INDEX_NODE_TYPE:
                self._evaluate_workflow_knowledge_index_node(node_data, issues, resource_id=node_id)
            elif node_type == BuiltinNodeTypes.TOOL:
                self._check_tool_config(issues, node_data, resource_id=node_id)
            elif node_type == BuiltinNodeTypes.AGENT:
                if node_data.get("agent_node_kind") == "dify_agent":
                    self._evaluate_workflow_agent_node(workflow, node_id, issues)
                else:
                    self._evaluate_legacy_agent_node(node_data, issues, resource_id=node_id)
            elif node_type == BuiltinNodeTypes.DATASOURCE:
                if node_data.get("provider_type") != "local_file":
                    self._check_plugin(
                        issues,
                        plugin_id=node_data.get("plugin_id"),
                        resource_id=node_id,
                    )
            elif node_type == "trigger-plugin":
                self._check_plugin(
                    issues,
                    plugin_id=node_data.get("plugin_id"),
                    resource_id=node_id,
                )

    def _evaluate_workflow_knowledge_node(
        self,
        node_data: Mapping[str, Any],
        issues: list[AppAvailabilityIssue],
        *,
        resource_id: str,
    ) -> None:
        dataset_ids = self._string_list(node_data.get("dataset_ids"))
        if not dataset_ids:
            self._add_issue(
                issues, type=AppAvailabilityIssueType.KNOWLEDGE, reason="not-configured", resource_id=resource_id
            )
        retrievable_dataset_ids = {dataset_id for dataset_id in dataset_ids if self._check_dataset(issues, dataset_id)}
        # knowledge_retrieval returns before its planner/metadata model lookup
        # when no dataset has usable content.
        if not retrievable_dataset_ids:
            return

        retrieval_mode = node_data.get("retrieval_mode")
        if retrieval_mode == "single":
            single_config = node_data.get("single_retrieval_config")
            model = single_config.get("model") if isinstance(single_config, Mapping) else None
            self._check_model(
                issues,
                provider=self._value(model, "provider"),
                model=self._value(model, "name"),
                model_type=ModelType.LLM,
                resource_id=resource_id,
            )
        elif retrieval_mode == "multiple":
            multiple_config = node_data.get("multiple_retrieval_config")
            if not isinstance(multiple_config, Mapping):
                self._add_issue(
                    issues,
                    type=AppAvailabilityIssueType.KNOWLEDGE,
                    reason="invalid-configuration",
                    resource_id=resource_id,
                )
            elif multiple_config.get("reranking_enable", True) and len(retrievable_dataset_ids) > 1:
                reranking_mode = multiple_config.get("reranking_mode", "reranking_model")
                if reranking_mode == "reranking_model":
                    reranking_model = multiple_config.get("reranking_model")
                    self._check_model(
                        issues,
                        provider=self._value(reranking_model, "provider")
                        or self._value(reranking_model, "reranking_provider_name"),
                        model=self._value(reranking_model, "model")
                        or self._value(reranking_model, "reranking_model_name"),
                        model_type=ModelType.RERANK,
                        resource_id=resource_id,
                    )
                elif reranking_mode == "weighted_score":
                    weights = multiple_config.get("weights")
                    vector_setting = weights.get("vector_setting") if isinstance(weights, Mapping) else None
                    if not isinstance(vector_setting, Mapping) or vector_setting.get("vector_weight", 0) > 0:
                        self._check_model(
                            issues,
                            provider=self._value(vector_setting, "embedding_provider_name"),
                            model=self._value(vector_setting, "embedding_model_name"),
                            model_type=ModelType.TEXT_EMBEDDING,
                            resource_id=resource_id,
                        )
                else:
                    self._add_issue(
                        issues,
                        type=AppAvailabilityIssueType.KNOWLEDGE,
                        reason="invalid-configuration",
                        resource_id=resource_id,
                    )

        if node_data.get("metadata_filtering_mode") == "automatic":
            metadata_model = node_data.get("metadata_model_config")
            self._check_model(
                issues,
                provider=self._value(metadata_model, "provider"),
                model=self._value(metadata_model, "name"),
                model_type=ModelType.LLM,
                resource_id=resource_id,
            )

    def _evaluate_workflow_knowledge_index_node(
        self,
        node_data: Mapping[str, Any],
        issues: list[AppAvailabilityIssue],
        *,
        resource_id: str,
    ) -> None:
        technique = str(node_data.get("indexing_technique", ""))
        if technique == "high_quality":
            self._check_model(
                issues,
                provider=node_data.get("embedding_model_provider"),
                model=node_data.get("embedding_model"),
                model_type=ModelType.TEXT_EMBEDDING,
                resource_id=resource_id,
            )

        retrieval = node_data.get("retrieval_model")
        if not isinstance(retrieval, Mapping) or not retrieval.get("reranking_enable", False):
            return
        if retrieval.get("reranking_mode", "reranking_model") == "reranking_model":
            reranking_model = retrieval.get("reranking_model")
            self._check_model(
                issues,
                provider=self._value(reranking_model, "reranking_provider_name"),
                model=self._value(reranking_model, "reranking_model_name"),
                model_type=ModelType.RERANK,
                resource_id=resource_id,
            )

    def _evaluate_legacy_agent_node(
        self,
        node_data: Mapping[str, Any],
        issues: list[AppAvailabilityIssue],
        *,
        resource_id: str,
    ) -> None:
        strategy_provider = node_data.get("agent_strategy_provider_name")
        if strategy_provider:
            self._check_plugin(issues, plugin_id=self._plugin_id(strategy_provider), resource_id=resource_id)
        parameters = node_data.get("agent_parameters")
        if not isinstance(parameters, Mapping):
            return
        for parameter in parameters.values():
            if not isinstance(parameter, Mapping) or parameter.get("type") == "variable":
                continue
            value = parameter.get("value")
            if isinstance(value, Mapping) and "provider" in value and "model" in value:
                self._check_model(
                    issues,
                    provider=value.get("provider"),
                    model=value.get("model"),
                    model_type=ModelType.LLM,
                    resource_id=resource_id,
                )
            for tool in self._iter_tool_configs(value):
                if tool.get("enabled", False):
                    self._check_tool_config(issues, tool, resource_id=resource_id)

    def _evaluate_workflow_agent_node(
        self,
        workflow: Workflow,
        node_id: str,
        issues: list[AppAvailabilityIssue],
    ) -> None:
        binding = self._session.scalar(
            select(WorkflowAgentNodeBinding)
            .where(
                WorkflowAgentNodeBinding.tenant_id == self._tenant_id,
                WorkflowAgentNodeBinding.app_id == workflow.app_id,
                WorkflowAgentNodeBinding.workflow_id == workflow.id,
                WorkflowAgentNodeBinding.workflow_version == workflow.version,
                WorkflowAgentNodeBinding.node_id == node_id,
            )
            .limit(1)
        )
        if binding is None or binding.agent_id is None:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.AGENT,
                reason="not-configured",
                resource_id=node_id,
            )
            return

        agent = self._session.scalar(
            select(Agent).where(Agent.tenant_id == self._tenant_id, Agent.id == binding.agent_id).limit(1)
        )
        if agent is None:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.AGENT,
                reason="missing",
                resource_id=binding.agent_id,
            )
            return
        if binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT and agent.scope != AgentScope.ROSTER:
            self._add_issue(issues, type=AppAvailabilityIssueType.AGENT, reason="missing", resource_id=binding.agent_id)
            return
        if agent.status == AgentStatus.ARCHIVED:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.AGENT,
                reason="archived",
                resource_id=agent.id,
            )
            return
        if (
            binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
            and not agent_has_workflow_callable_active_snapshot(session=self._session, agent=agent)
        ):
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.AGENT,
                reason="unpublished",
                resource_id=agent.id,
            )
            return

        snapshot_id = (
            agent.active_config_snapshot_id
            if binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
            else binding.current_snapshot_id
        )
        if not snapshot_id:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.AGENT,
                reason="not-configured",
                resource_id=agent.id,
            )
            return
        soul = self._load_agent_soul(snapshot_id, agent.id)
        if soul is None:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.AGENT,
                reason="invalid-configuration",
                resource_id=agent.id,
            )
            return
        self._evaluate_agent_soul(soul, issues, resource_id=agent.id)

    def _evaluate_agent_app(self, app: App, issues: list[AppAvailabilityIssue]) -> None:
        self._source = "draft"
        agent = app.agent_app_binding_with_session(session=self._session, include_archived=True)
        if agent is None:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.AGENT,
                reason="not-configured",
                resource_id=app.id,
            )
            return
        if agent.status == AgentStatus.ARCHIVED:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.AGENT,
                reason="archived",
                resource_id=agent.id,
            )
            return

        draft = self._session.scalar(
            select(AgentConfigDraft)
            .where(
                AgentConfigDraft.tenant_id == self._tenant_id,
                AgentConfigDraft.agent_id == agent.id,
                AgentConfigDraft.draft_type == AgentConfigDraftType.DRAFT,
                AgentConfigDraft.account_id.is_(None),
            )
            .order_by(AgentConfigDraft.updated_at.desc())
            .limit(1)
        )
        if draft is not None:
            try:
                self._evaluate_agent_soul(
                    AgentSoulConfig.model_validate(draft.config_snapshot_dict),
                    issues,
                    resource_id=agent.id,
                )
            except Exception:
                logger.exception("Failed to parse Agent draft, agent_id=%s", agent.id)
                self._add_issue(
                    issues,
                    type=AppAvailabilityIssueType.AGENT,
                    reason="invalid-configuration",
                    resource_id=agent.id,
                )
            return

        # Match the Agent editor's read-only draft projection: before the first
        # shared draft is saved, it edits the active snapshot. Do not search
        # publish history or substitute a published snapshot for an existing
        # incomplete draft.
        snapshot_id = agent.active_config_snapshot_id
        if not snapshot_id:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.AGENT,
                reason="not-configured",
                resource_id=agent.id,
            )
            return

        soul = self._load_agent_soul(snapshot_id, agent.id)
        if soul is None:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.AGENT,
                reason="invalid-configuration",
                resource_id=agent.id,
            )
            return
        self._evaluate_agent_soul(soul, issues, resource_id=agent.id)

    def _evaluate_agent_soul(
        self,
        soul: AgentSoulConfig,
        issues: list[AppAvailabilityIssue],
        *,
        resource_id: str,
    ) -> None:
        if soul.model is None:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.AGENT,
                reason="not-configured",
                resource_id=resource_id,
            )
        else:
            self._check_model(
                issues,
                provider=soul.model.model_provider,
                model=soul.model.model,
                model_type=ModelType.LLM,
                resource_id=resource_id,
            )

        suggested_questions = soul.app_features.suggested_questions_after_answer
        if suggested_questions and suggested_questions.enabled and suggested_questions.model:
            self._check_model(
                issues,
                provider=suggested_questions.model.provider,
                model=suggested_questions.model.name,
                model_type=ModelType.LLM,
                resource_id=resource_id,
            )

        for tool in soul.tools.dify_tools:
            if not tool.enabled:
                continue
            provider_id = tool.provider_id or (
                f"{tool.plugin_id}/{tool.provider}" if tool.plugin_id and tool.provider else None
            )
            self._check_tool_config(
                issues,
                {
                    "provider_type": self._enum_value(tool.provider_type),
                    "provider_id": provider_id,
                    "tool_name": tool.tool_name,
                    "credential_id": tool.credential_ref.id if tool.credential_ref else None,
                },
                resource_id=resource_id,
            )

        retrievable_dataset_ids = {
            dataset_id
            for dataset_id in list_agent_soul_knowledge_dataset_ids(soul)
            if self._check_dataset(issues, dataset_id)
        }
        for knowledge_set in soul.knowledge.sets:
            self._evaluate_agent_knowledge_set(
                knowledge_set, issues, resource_id=resource_id, retrievable_dataset_ids=retrievable_dataset_ids
            )

        # Missing portable files/skills are runtime warnings, not blocking
        # dependencies: build_config_layer_config deliberately skips them.

    def _evaluate_agent_knowledge_set(
        self,
        knowledge_set: AgentKnowledgeSetConfig,
        issues: list[AppAvailabilityIssue],
        *,
        resource_id: str,
        retrievable_dataset_ids: set[str],
    ) -> None:
        dataset_count = len(
            {(dataset.id or "").strip() for dataset in knowledge_set.datasets} & retrievable_dataset_ids
        )
        if not dataset_count:
            return
        retrieval = knowledge_set.retrieval
        if retrieval.mode == "single":
            model = retrieval.model
            self._check_model(
                issues,
                provider=model.provider if model else None,
                model=model.name if model else None,
                model_type=ModelType.LLM,
                resource_id=resource_id,
            )
        elif retrieval.reranking_enable and dataset_count > 1:
            if retrieval.reranking_mode == "reranking_model":
                model = retrieval.reranking_model
                self._check_model(
                    issues,
                    provider=model.provider if model else None,
                    model=model.model if model else None,
                    model_type=ModelType.RERANK,
                    resource_id=resource_id,
                )
            elif retrieval.reranking_mode == "weighted_score":
                vector_setting = retrieval.weights.vector_setting if retrieval.weights else None
                if not isinstance(vector_setting, Mapping) or vector_setting.get("vector_weight", 0) > 0:
                    self._check_model(
                        issues,
                        provider=self._value(vector_setting, "embedding_provider_name"),
                        model=self._value(vector_setting, "embedding_model_name"),
                        model_type=ModelType.TEXT_EMBEDDING,
                        resource_id=resource_id,
                    )
            else:
                self._add_issue(
                    issues,
                    type=AppAvailabilityIssueType.KNOWLEDGE,
                    reason="invalid-configuration",
                    resource_id=resource_id,
                )

        metadata = knowledge_set.metadata_filtering
        if metadata.mode == "automatic":
            model = metadata.metadata_model_config
            self._check_model(
                issues,
                provider=model.provider if model else None,
                model=model.name if model else None,
                model_type=ModelType.LLM,
                resource_id=resource_id,
            )

    def _check_dataset(self, issues: list[AppAvailabilityIssue], dataset_id: str) -> bool:
        """Collect dependencies and return whether retrieval would visit this dataset."""
        if not dataset_id:
            return False
        dataset = self._dataset_cache.get(dataset_id, ...)
        if dataset is ...:
            try:
                UUID(dataset_id)
            except (TypeError, ValueError):
                dataset = None
            else:
                dataset = self._session.scalar(
                    select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == self._tenant_id).limit(1)
                )
            self._dataset_cache[dataset_id] = dataset

        if dataset is None:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.KNOWLEDGE,
                reason="missing",
                resource_id=dataset_id,
            )
            return False

        if dataset.provider == "external":
            reason = self._external_knowledge_reason(dataset.id)
            if reason is not None:
                self._add_issue(issues, type=AppAvailabilityIssueType.KNOWLEDGE, reason=reason, resource_id=dataset.id)
            return True

        if dataset.id not in self._dataset_ready_cache:
            self._dataset_ready_cache[dataset.id] = bool(
                self._session.scalar(
                    select(Document.id)
                    .where(
                        Document.dataset_id == dataset.id,
                        Document.tenant_id == self._tenant_id,
                        Document.indexing_status == IndexingStatus.COMPLETED,
                        Document.enabled.is_(True),
                        Document.archived.is_(False),
                    )
                    .limit(1)
                )
            )
        if not self._dataset_ready_cache[dataset.id]:
            # DatasetRetrieval skips these datasets and legitimately returns an
            # empty result. It does not call their embedding/reranking models.
            return False

        if self._enum_value(dataset.indexing_technique) == "high_quality":
            retrieval = dataset.retrieval_model_dict
            if retrieval.get("search_method") != "full_text_search":
                self._check_model(
                    issues,
                    provider=dataset.embedding_model_provider,
                    model=dataset.embedding_model,
                    model_type=ModelType.TEXT_EMBEDDING,
                    resource_id=dataset.id,
                )
            requires_reranking = bool(retrieval.get("reranking_enable")) and not (
                retrieval.get("search_method") == "hybrid_search"
                and retrieval.get("reranking_mode") == "weighted_score"
            )
            if requires_reranking:
                reranking_model = retrieval.get("reranking_model")
                self._check_model(
                    issues,
                    provider=self._value(reranking_model, "reranking_provider_name"),
                    model=self._value(reranking_model, "reranking_model_name"),
                    model_type=ModelType.RERANK,
                    resource_id=dataset.id,
                )

        return True

    def _external_knowledge_reason(self, dataset_id: str) -> str | None:
        if dataset_id not in self._external_knowledge_reason_cache:
            # External Knowledge has no local documents. Resolve the same
            # tenant-owned binding/API chain as prepare_external_knowledge_retrieval.
            row = self._session.execute(
                select(ExternalKnowledgeBindings, ExternalKnowledgeApis)
                .join(
                    ExternalKnowledgeApis,
                    ExternalKnowledgeApis.id == ExternalKnowledgeBindings.external_knowledge_api_id,
                )
                .where(
                    ExternalKnowledgeBindings.dataset_id == dataset_id,
                    ExternalKnowledgeBindings.tenant_id == self._tenant_id,
                    ExternalKnowledgeApis.tenant_id == self._tenant_id,
                )
                .limit(1)
            ).first()
            reason = None
            if row is None:
                reason = "missing"
            else:
                binding, api = row
                settings = api.settings_dict
                endpoint = settings.get("endpoint") if isinstance(settings, Mapping) else None
                # api_key is optional: some external providers are unauthenticated.
                if not isinstance(endpoint, str) or not endpoint.strip() or not binding.external_knowledge_id.strip():
                    reason = "invalid-configuration"
            self._external_knowledge_reason_cache[dataset_id] = reason
        return self._external_knowledge_reason_cache[dataset_id]

    def _check_model(
        self,
        issues: list[AppAvailabilityIssue],
        *,
        provider: Any,
        model: Any,
        model_type: ModelType,
        resource_id: str,
    ) -> None:
        if not isinstance(provider, str) or not provider.strip() or not isinstance(model, str) or not model.strip():
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.MODEL,
                reason="not-configured",
                resource_id=resource_id,
                provider=provider if isinstance(provider, str) else None,
                model=model if isinstance(model, str) else None,
            )
            return

        self._dependencies.append(AppModelDependency(provider, model, model_type.value, resource_id))

    def _check_tool_config(
        self,
        issues: list[AppAvailabilityIssue],
        tool: Mapping[str, Any],
        *,
        resource_id: str,
    ) -> None:
        provider_type = self._enum_value(tool.get("provider_type") or tool.get("type"))
        provider_id = tool.get("provider_id") or tool.get("provider_name") or tool.get("provider")
        tool_name = tool.get("tool_name") or tool.get("name")
        if not isinstance(provider_type, str) or not isinstance(provider_id, str) or not provider_id:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.TOOL,
                reason="invalid-configuration",
                resource_id=resource_id,
            )
            return
        if provider_type == ToolProviderType.DATASET_RETRIEVAL.value:
            return

        if provider_type in {ToolProviderType.BUILT_IN.value, ToolProviderType.PLUGIN.value}:
            credential_exists = self._tool_credential_exists(provider_id, tool.get("credential_id"))
            self._dependencies.append(
                AppToolDependency(
                    provider_type,
                    provider_id,
                    tool_name if isinstance(tool_name, str) else None,
                    credential_exists,
                    resource_id,
                )
            )
            return
        issue = self._resolve_tool_issue(
            issues=issues,
            provider_type=provider_type,
            provider_id=provider_id,
            tool_name=tool_name if isinstance(tool_name, str) else None,
            resource_id=resource_id,
        )
        if issue is not None:
            self._add_issue(
                issues,
                type=issue.type,
                reason=issue.reason,
                resource_id=resource_id,
                provider=issue.provider,
                model=issue.model,
            )

    def _resolve_tool_issue(
        self,
        *,
        issues: list[AppAvailabilityIssue],
        provider_type: str,
        provider_id: str,
        tool_name: str | None,
        resource_id: str,
    ) -> AppAvailabilityIssue | None:
        try:
            if provider_type == ToolProviderType.API.value:
                provider = (
                    self._session.scalar(
                        select(ApiToolProvider)
                        .where(ApiToolProvider.tenant_id == self._tenant_id, ApiToolProvider.id == provider_id)
                        .limit(1)
                    )
                    if self._is_uuid(provider_id)
                    else None
                )
                if provider is None:
                    return AppAvailabilityIssue(
                        type=AppAvailabilityIssueType.TOOL,
                        reason="missing",
                        resource_id=resource_id,
                        provider=provider_id,
                    )
                names = {tool.operation_id for tool in provider.tools}
                if not names or (tool_name and tool_name not in names):
                    return AppAvailabilityIssue(
                        type=AppAvailabilityIssueType.TOOL,
                        reason="missing",
                        resource_id=resource_id,
                        provider=provider.name,
                    )
                credentials = provider.credentials
                auth_type = credentials.get("auth_type")
                if auth_type is None or (
                    auth_type in {"api_key", "api_key_header", "api_key_query"}
                    and (
                        not isinstance(credentials.get("api_key_value"), str)
                        or not credentials["api_key_value"].strip()
                    )
                ):
                    return AppAvailabilityIssue(
                        type=AppAvailabilityIssueType.TOOL,
                        reason="no-configure",
                        resource_id=resource_id,
                        provider=provider.name,
                    )
                return None

            if provider_type == ToolProviderType.WORKFLOW.value:
                workflow_provider = (
                    self._session.scalar(
                        select(WorkflowToolProvider)
                        .where(
                            WorkflowToolProvider.tenant_id == self._tenant_id,
                            WorkflowToolProvider.id == provider_id,
                        )
                        .limit(1)
                    )
                    if self._is_uuid(provider_id)
                    else None
                )
                if workflow_provider is None:
                    return AppAvailabilityIssue(
                        type=AppAvailabilityIssueType.TOOL,
                        reason="missing",
                        resource_id=resource_id,
                        provider=provider_id,
                    )
                app = self._session.scalar(
                    select(App)
                    .where(
                        App.tenant_id == self._tenant_id,
                        App.id == workflow_provider.app_id,
                    )
                    .limit(1)
                )
                workflow = (
                    self._session.scalar(
                        select(Workflow)
                        .where(
                            Workflow.tenant_id == self._tenant_id,
                            Workflow.app_id == workflow_provider.app_id,
                            Workflow.version == workflow_provider.version,
                        )
                        .limit(1)
                    )
                    if app is not None
                    else None
                )
                if workflow is None or workflow.version == Workflow.VERSION_DRAFT:
                    return AppAvailabilityIssue(
                        type=AppAvailabilityIssueType.TOOL,
                        reason="unpublished",
                        resource_id=resource_id,
                        provider=workflow_provider.name,
                    )
                if tool_name and tool_name != workflow_provider.name:
                    return AppAvailabilityIssue(
                        type=AppAvailabilityIssueType.TOOL,
                        reason="missing",
                        resource_id=resource_id,
                        provider=workflow_provider.name,
                    )
                self._evaluate_workflow_graph(workflow, issues)
                return None

            if provider_type == ToolProviderType.MCP.value:
                # Match get_provider_by_persisted_reference: legacy UUID first,
                # then server identifier, which itself may look like a UUID.
                mcp_provider = (
                    self._session.scalar(
                        select(MCPToolProvider)
                        .where(
                            MCPToolProvider.tenant_id == self._tenant_id,
                            MCPToolProvider.id == provider_id,
                        )
                        .limit(1)
                    )
                    if self._is_uuid(provider_id)
                    else None
                )
                if mcp_provider is None:
                    mcp_provider = self._session.scalar(
                        select(MCPToolProvider)
                        .where(
                            MCPToolProvider.tenant_id == self._tenant_id,
                            MCPToolProvider.server_identifier == provider_id,
                        )
                        .limit(1)
                    )
                if mcp_provider is None:
                    return AppAvailabilityIssue(
                        type=AppAvailabilityIssueType.TOOL,
                        reason="missing",
                        resource_id=resource_id,
                        provider=provider_id,
                    )
                if not mcp_provider.authed:
                    return AppAvailabilityIssue(
                        type=AppAvailabilityIssueType.TOOL,
                        reason="no-configure",
                        resource_id=resource_id,
                        provider=provider_id,
                    )
                names = {
                    str(item.get("name"))
                    for item in mcp_provider.tool_dict
                    if isinstance(item, Mapping) and item.get("name")
                }
                if not names or (tool_name and tool_name not in names):
                    return AppAvailabilityIssue(
                        type=AppAvailabilityIssueType.TOOL,
                        reason="missing",
                        resource_id=resource_id,
                        provider=mcp_provider.server_identifier,
                    )
                return None
        except Exception:
            logger.exception(
                "Failed to resolve tool availability, tenant_id=%s provider=%s tool=%s",
                self._tenant_id,
                provider_id,
                tool_name,
            )
            return AppAvailabilityIssue(
                type=AppAvailabilityIssueType.TOOL,
                reason="evaluation-failed",
                resource_id=resource_id,
                provider=provider_id,
            )

        return AppAvailabilityIssue(
            type=AppAvailabilityIssueType.TOOL,
            reason="invalid-configuration",
            resource_id=resource_id,
            provider=provider_id,
        )

    def _check_plugin(
        self,
        issues: list[AppAvailabilityIssue],
        *,
        plugin_id: Any,
        resource_id: str,
    ) -> None:
        if not isinstance(plugin_id, str) or not plugin_id:
            self._add_issue(
                issues,
                type=AppAvailabilityIssueType.TOOL,
                reason="not-configured",
                resource_id=resource_id,
            )
            return
        self._dependencies.append(AppPluginDependency(plugin_id, resource_id))

    def _tool_credential_exists(self, provider_id: str, credential_id: Any) -> bool:
        providers = {provider_id}
        if provider_id.count("/") >= 2:
            providers.add(ToolProviderID(provider_id).provider_name)
        statement = select(BuiltinToolProvider.encrypted_credentials).where(
            BuiltinToolProvider.tenant_id == self._tenant_id,
            BuiltinToolProvider.provider.in_(providers),
        )
        if credential_id:
            if not isinstance(credential_id, str) or not self._is_uuid(credential_id):
                return False
            statement = statement.where(BuiltinToolProvider.id == credential_id)
        credentials = self._session.scalar(
            statement.order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc()).limit(1)
        )
        return bool(credentials and credentials != "{}")

    def _load_draft_workflow(self, app_id: str) -> Workflow | None:
        if app_id not in self._draft_workflow_cache:
            self._draft_workflow_cache[app_id] = self._session.scalar(
                select(Workflow)
                .where(
                    Workflow.app_id == app_id,
                    Workflow.tenant_id == self._tenant_id,
                    Workflow.version == Workflow.VERSION_DRAFT,
                )
                .limit(1)
            )
        return self._draft_workflow_cache[app_id]

    def _load_agent_soul(self, snapshot_id: str, agent_id: str) -> AgentSoulConfig | None:
        key = (snapshot_id, agent_id)
        if key in self._agent_soul_cache:
            return self._agent_soul_cache[key]
        snapshot = self._session.scalar(
            select(AgentConfigSnapshot)
            .where(
                AgentConfigSnapshot.id == snapshot_id,
                AgentConfigSnapshot.agent_id == agent_id,
                AgentConfigSnapshot.tenant_id == self._tenant_id,
            )
            .limit(1)
        )
        if snapshot is None:
            self._agent_soul_cache[key] = None
            return None
        try:
            soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
        except Exception:
            logger.exception("Failed to parse Agent snapshot, snapshot_id=%s", snapshot_id)
            soul = None
        self._agent_soul_cache[key] = soul
        return soul

    @staticmethod
    def _iter_tool_configs(value: Any) -> list[Mapping[str, Any]]:
        result: list[Mapping[str, Any]] = []
        if isinstance(value, Mapping):
            if (
                "provider_type" in value
                or "provider_id" in value
                or (value.get("type") in {"builtin", "plugin", "api", "workflow", "mcp"} and "provider_name" in value)
            ):
                result.append(value)
            for child in value.values():
                result.extend(AppAvailabilityRepository._iter_tool_configs(child))
        elif isinstance(value, list):
            for child in value:
                result.extend(AppAvailabilityRepository._iter_tool_configs(child))
        return result

    @staticmethod
    def _value(value: Any, key: str) -> Any:
        if isinstance(value, Mapping):
            return value.get(key)
        return None

    @staticmethod
    def _is_uuid(value: str) -> bool:
        try:
            UUID(value)
        except (ValueError, TypeError):
            return False
        return True

    @staticmethod
    def _string_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [item for item in value if isinstance(item, str) and item]

    @staticmethod
    def _enum_value(value: Any) -> str | None:
        if value is None:
            return None
        return str(value.value) if isinstance(value, Enum) else str(value)

    @staticmethod
    def _plugin_id(provider: str) -> str:
        if provider.count("/") >= 2:
            return "/".join(provider.split("/")[:2])
        return provider

    @staticmethod
    def _add_issue(
        issues: list[AppAvailabilityIssue],
        *,
        type: AppAvailabilityIssueType,
        reason: str,
        resource_id: str | None = None,
        provider: str | None = None,
        model: str | None = None,
    ) -> None:
        issues.append(
            AppAvailabilityIssue(
                type=type,
                reason=reason,
                resource_id=resource_id,
                provider=provider,
                model=model,
            )
        )


__all__ = ["AppAvailabilityRepository"]
