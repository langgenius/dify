"""One draft-write use case for the editor and atomic DSL imports."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Protocol

from machinery.context import RequestContext
from services.workflow.contracts import (
    DraftBindingTransaction,
    DraftImportResult,
    DraftSyncCommand,
    PreparedDraftSync,
    PreparedEnvironmentVariables,
    WorkflowAgentServices,
    WorkflowOwner,
    WorkflowSnapshot,
)


class DraftDefinitions[BindingStore](Protocol):
    def draft_sync(
        self, context: RequestContext, owner: WorkflowOwner, command: DraftSyncCommand, prepared: PreparedDraftSync
    ) -> AbstractContextManager[DraftBindingTransaction[BindingStore]]: ...

    def draft_restore(
        self, context: RequestContext, owner: WorkflowOwner, source: WorkflowSnapshot
    ) -> AbstractContextManager[DraftBindingTransaction[BindingStore]]: ...


class DraftLifecycle(Protocol):
    def prepare_sync(
        self,
        context: RequestContext,
        owner: WorkflowOwner,
        command: DraftSyncCommand,
        environment: PreparedEnvironmentVariables | None,
    ) -> PreparedDraftSync: ...
    def validate_restore(self, context: RequestContext, owner: WorkflowOwner, workflow_id: str) -> WorkflowSnapshot: ...
    def draft_synced(self, context: RequestContext, owner: WorkflowOwner, workflow: WorkflowSnapshot) -> None: ...


class DraftAgentRetirement(Protocol):
    def retire_unowned(self, *, tenant_id: str, agent_ids: list[str], account_id: str) -> None: ...


class WorkflowDraftService[BindingStore]:
    def __init__(
        self,
        *,
        definitions: DraftDefinitions[BindingStore],
        lifecycle: DraftLifecycle,
        retirement: DraftAgentRetirement,
        agent_services: WorkflowAgentServices[BindingStore],
    ):
        self._definitions = definitions
        self._lifecycle = lifecycle
        self._retirement = retirement
        self._agent_services = agent_services

    def sync(
        self,
        context: RequestContext,
        owner: WorkflowOwner,
        command: DraftSyncCommand,
        *,
        materialize: Callable[[WorkflowSnapshot], DraftImportResult] | None = None,
        environment: PreparedEnvironmentVariables | None = None,
    ) -> WorkflowSnapshot:
        prepared = self._lifecycle.prepare_sync(context, owner, command, environment)
        with self._definitions.draft_sync(context, owner, command, prepared) as transaction:
            agents = self._agent_services(repository=transaction.bindings)
            if owner.kind == "pipeline":
                retired: set[str] = set()
            elif materialize is None:
                retired = agents.synchronize_draft(draft_workflow=transaction.workflow, account_id=context.account_id)
            else:
                imported = materialize(transaction.workflow)
                transaction.replace_graph(imported.graph)
                retired = imported.retired_agents
                agents.validate_agent_nodes_for_draft_sync(draft_workflow=transaction.workflow)
            workflow = transaction.workflow

            def completed() -> None:
                self._retirement.retire_unowned(
                    tenant_id=context.active_workspace_id, agent_ids=sorted(retired), account_id=context.account_id
                )
                self._lifecycle.draft_synced(context, owner, workflow)

            transaction.after_commit(completed)
        return workflow

    def restore(self, context: RequestContext, owner: WorkflowOwner, workflow_id: str) -> WorkflowSnapshot:
        source = self._lifecycle.validate_restore(context, owner, workflow_id)
        with self._definitions.draft_restore(context, owner, source) as transaction:
            retired = (
                self._agent_services(repository=transaction.bindings).restore_agent_node_bindings_to_draft(
                    source_workflow=source, draft_workflow=transaction.workflow, account_id=context.account_id
                )
                if owner.kind != "pipeline"
                else set()
            )
            workflow = transaction.workflow

            def completed() -> None:
                self._retirement.retire_unowned(
                    tenant_id=context.active_workspace_id, agent_ids=sorted(retired), account_id=context.account_id
                )
                self._lifecycle.draft_synced(context, owner, workflow)

            transaction.after_commit(completed)
        return workflow
