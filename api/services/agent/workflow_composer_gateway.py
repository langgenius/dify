"""Connect Console workflow and snippet Composer routes to the shared draft runtime."""

from enum import StrEnum
from typing import NamedTuple

from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.model import AppMode
from repositories.app.console_repository import find_console_app
from repositories.workflow_agent_composer_queries import (
    WorkflowAgentImpact,
    find_composer_snippet_id,
    read_workflow_agent_impact,
)
from services.agent.composer_service import AgentComposerService
from services.agent.composer_tools import list_workspace_dify_tools
from services.agent.composer_validator import ComposerConfigValidator
from services.entities.agent_entities import (
    ComposerCandidatesResponse,
    ComposerSavePayload,
    WorkflowComposerCopyFromRosterPayload,
)


class WorkflowComposerTargetKind(StrEnum):
    """Select the workspace-scoped owner lookup for the target ID."""

    WORKFLOW = "workflow"
    SNIPPET = "snippet"


class WorkflowComposerTarget(NamedTuple):
    kind: WorkflowComposerTargetKind
    id: str


class WorkflowComposerAppMissingError(Exception):
    """No eligible Console App exists for the requested workspace."""


class WorkflowComposerSnippetMissingError(Exception):
    """No snippet exists for the requested workspace."""


class WorkflowComposerGateway:
    """Own sessions around the legacy Workflow and Snippet Composer operations.

    TODO: Remove this gateway when the repository owns draft queries and the
    atomic binding and snapshot writes, and the Composer service owns KnowledgeFS
    authorization, tool discovery, and post-commit retirement. Preserve inline
    debug conversation initialization when migrating the read path.
    """

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        """Use the application's session factory for scoped reads and write transactions."""
        self._sessions = session_factory

    @staticmethod
    def _require_target(session: Session, *, tenant_id: str, target: WorkflowComposerTarget) -> str:
        """Resolve an eligible tenant App or snippet, preserving each surface's owner gate."""
        if target.kind == WorkflowComposerTargetKind.SNIPPET:
            snippet_id = find_composer_snippet_id(session, tenant_id=tenant_id, snippet_id=target.id)
            if snippet_id is None:
                raise WorkflowComposerSnippetMissingError
            return snippet_id

        app = find_console_app(session, workspace_id=tenant_id, app_id=target.id)
        if app is None:
            raise WorkflowComposerAppMissingError
        if AppMode.value_of(app.mode) not in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
            raise WorkflowComposerAppMissingError(
                "App mode is not in the supported list: {'workflow', 'advanced-chat'}"
            )
        return app.id

    def get(
        self, context: RequestContext, target: WorkflowComposerTarget, *, node_id: str, snapshot_id: str | None
    ) -> dict[str, object]:
        """Load the requested Composer state and commit any inline debug conversation initialization."""
        tenant_id = context.active_workspace_id
        with self._sessions.begin() as session:
            app_id = self._require_target(session, tenant_id=tenant_id, target=target)
            return AgentComposerService.load_workflow_composer(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                node_id=node_id,
                account_id=context.account_id,
                snapshot_id=snapshot_id,
            )

    def save(
        self, context: RequestContext, target: WorkflowComposerTarget, *, node_id: str, payload: ComposerSavePayload
    ) -> dict[str, object]:
        """Save using the shared draft engine, which commits before scheduling retirement."""
        tenant_id = context.active_workspace_id
        with self._sessions() as session:
            app_id = self._require_target(session, tenant_id=tenant_id, target=target)
            return AgentComposerService.save_workflow_composer(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                node_id=node_id,
                account_id=context.account_id,
                payload=payload,
            )

    def copy_from_roster(
        self,
        context: RequestContext,
        target: WorkflowComposerTarget,
        *,
        node_id: str,
        payload: WorkflowComposerCopyFromRosterPayload,
    ) -> dict[str, object]:
        """Commit the owned inline Agent and its binding as one unit."""
        tenant_id = context.active_workspace_id
        with self._sessions.begin() as session:
            app_id = self._require_target(session, tenant_id=tenant_id, target=target)
            return AgentComposerService.copy_workflow_composer_from_roster(
                session=session,
                tenant_id=tenant_id,
                app_id=app_id,
                node_id=node_id,
                account_id=context.account_id,
                source_agent_id=payload.source_agent_id,
                source_snapshot_id=payload.source_snapshot_id,
                idempotency_key=payload.idempotency_key,
            )

    def validate(
        self, context: RequestContext, target: WorkflowComposerTarget, *, payload: ComposerSavePayload
    ) -> dict[str, object]:
        """Validate publish rules and dataset ownership without changing the draft."""
        tenant_id = context.active_workspace_id
        with self._sessions() as session:
            self._require_target(session, tenant_id=tenant_id, target=target)
            ComposerConfigValidator.validate_publish_payload(payload)
            AgentComposerService.validate_knowledge_datasets(
                session=session, tenant_id=tenant_id, agent_soul=payload.agent_soul
            )
        return {"result": "success", "errors": [], **AgentComposerService.collect_validation_findings(payload=payload)}

    def candidates(
        self, context: RequestContext, target: WorkflowComposerTarget, *, node_id: str
    ) -> ComposerCandidatesResponse:
        """Materialize workflow candidates before calling the workspace plugin discovery API."""
        tenant_id = context.active_workspace_id
        with self._sessions() as session:
            app_id = self._require_target(session, tenant_id=tenant_id, target=target)
            response = AgentComposerService.prepare_workflow_candidates(
                session=session, tenant_id=tenant_id, app_id=app_id, node_id=node_id, user_id=context.account_id
            )
        tools = list_workspace_dify_tools(tenant_id=tenant_id, user_id=context.account_id)
        return AgentComposerService.attach_workflow_candidate_tools(response, tools)

    def impact(
        self, context: RequestContext, target: WorkflowComposerTarget, *, snapshot_id: str | None
    ) -> WorkflowAgentImpact:
        """Return affected bindings of the tenant snapshot, or the empty impact for no selection."""
        tenant_id = context.active_workspace_id
        with self._sessions() as session:
            self._require_target(session, tenant_id=tenant_id, target=target)
            return read_workflow_agent_impact(session, tenant_id=tenant_id, current_snapshot_id=snapshot_id or None)
