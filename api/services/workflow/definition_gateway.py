"""Adapt external definition validation and draft notifications to domain owners."""

from collections.abc import Mapping
from contextlib import AbstractContextManager
from typing import Any, Protocol

from sqlalchemy.orm import Session, sessionmaker

from events.app_event import app_draft_workflow_was_synced
from factories import variable_factory
from machinery.context import RequestContext
from models import App
from models.workflow import Workflow
from repositories.workflow.definition_repository import workflow_from_snapshot
from services.agent.workflow_contracts import AgentSkillReader, WorkflowAgentBindingStore
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.credentials.query import CredentialQuery
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.workflow.contracts import (
    DraftSyncCommand,
    PreparedDraftSync,
    PreparedEnvironmentVariables,
    ValidatedWorkflowPublication,
    WorkflowOwner,
    WorkflowSnapshot,
)
from services.workflow.environment_variable_service import prepare_environment_variables
from services.workflow.snippet_policy import validate_snippet_graph_forbidden_nodes


class WorkflowDefinitionReader(Protocol):
    def validation_state(
        self, context: RequestContext, app_id: str, workflow_id: str | None = None
    ) -> tuple[App, WorkflowSnapshot | None]: ...
    def binding_reader(self) -> AbstractContextManager[WorkflowAgentBindingStore]: ...
    def app(self, context: RequestContext, app_id: str) -> App: ...


class WorkflowDraftReader(Protocol):
    def snapshot(
        self, context: RequestContext, owner: WorkflowOwner, workflow_id: str | None = None
    ) -> WorkflowSnapshot | None: ...


class WorkflowDefinitionValidator(Protocol):
    def validate_features_structure(self, app_model: App, features: dict[str, Any]) -> dict[str, Any | None]: ...
    def validate_graph_structure(self, graph: Mapping[str, Any]) -> None: ...
    def validate_publication(
        self, app_model: App, draft_workflow: Workflow, *, credentials: CredentialQuery
    ) -> None: ...


class WorkflowDefinitionGateway:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        definitions: WorkflowDefinitionReader,
        drafts: WorkflowDraftReader,
        workflows: WorkflowDefinitionValidator,
        credentials: CredentialQuery,
        skills: AgentSkillReader,
    ) -> None:
        self._sessions = session_factory
        self._definitions = definitions
        self._drafts = drafts
        self._workflows = workflows
        self._credentials = credentials
        self._skills = skills

    def prepare_sync(
        self,
        context: RequestContext,
        owner: WorkflowOwner,
        command: DraftSyncCommand,
        environment: PreparedEnvironmentVariables | None,
    ) -> PreparedDraftSync:
        if command.environment_upserts is None and command.environment_deletions:
            raise ValueError("Deleted environment variable ids require an environment variable patch.")
        if owner.kind == "app":
            app, draft = self._definitions.validation_state(context, owner.id)
            if not command.is_collaborative or draft is None:
                self._workflows.validate_features_structure(app, command.features)
            self._workflows.validate_graph_structure(command.graph)
        else:
            draft = self._drafts.snapshot(context, owner)
            if owner.kind == "snippet":
                validate_snippet_graph_forbidden_nodes(command.graph)
        if command.check_hash and draft is not None and draft.hash != command.unique_hash:
            raise WorkflowHashNotEqualError()
        if owner.kind == "snippet":
            return PreparedDraftSync(draft, None)
        if environment is None:
            mappings = command.environment_upserts
            if mappings is not None:
                mappings = Workflow.normalize_environment_variable_mappings(mappings)
            elif not command.is_collaborative and command.environment_variables is not None:
                mappings = Workflow.normalize_environment_variable_mappings(command.environment_variables)
            if mappings is not None:
                environment = prepare_environment_variables(
                    tenant_id=context.active_workspace_id,
                    source=draft,
                    variables=[variable_factory.build_environment_variable_from_mapping(value) for value in mappings],
                    deleted_ids=command.environment_deletions if command.environment_upserts is not None else None,
                )
        return PreparedDraftSync(draft, environment)

    def validate_publish(self, context: RequestContext, app_id: str) -> ValidatedWorkflowPublication:
        app, snapshot = self._definitions.validation_state(context, app_id)
        if snapshot is None:
            raise ValueError("No valid workflow found.")
        self._workflows.validate_publication(app, workflow_from_snapshot(snapshot), credentials=self._credentials)
        with self._definitions.binding_reader() as bindings:
            agents = WorkflowAgentPublishService(repository=bindings).publication_state(draft_workflow=snapshot)
        WorkflowAgentPublishService.validate_publication_state(agents, skills=self._skills)
        return ValidatedWorkflowPublication(snapshot, agents)

    def validate_restore(self, context: RequestContext, owner: WorkflowOwner, workflow_id: str) -> WorkflowSnapshot:
        if owner.kind == "app":
            app, snapshot = self._definitions.validation_state(context, owner.id, workflow_id)
        else:
            app = None
            snapshot = self._drafts.snapshot(context, owner, workflow_id)
        if snapshot is None:
            raise WorkflowNotFoundError("Workflow not found.")
        if snapshot.version == Workflow.VERSION_DRAFT:
            raise IsDraftWorkflowError("source workflow must be published")
        if app is not None:
            workflow = workflow_from_snapshot(snapshot)
            self._workflows.validate_features_structure(app, workflow.normalized_features_dict)
            self._workflows.validate_graph_structure(workflow.graph_dict)
        elif owner.kind == "snippet":
            validate_snippet_graph_forbidden_nodes(snapshot.graph_dict)
        return snapshot

    def validate_features(self, context: RequestContext, app_id: str, features: dict[str, Any]) -> None:
        app = self._definitions.app(context, app_id)
        self._workflows.validate_features_structure(app, features)

    def draft_synced(self, context: RequestContext, owner: WorkflowOwner, workflow: WorkflowSnapshot) -> None:
        if owner.kind != "app":
            return
        app = self._definitions.app(context, owner.id)
        app_draft_workflow_was_synced.send(
            app, synced_draft_workflow=workflow_from_snapshot(workflow), session_factory=self._sessions
        )
