"""Short draft transactions shared by App, Snippet and Pipeline use cases."""

import json
from collections.abc import Callable, Generator, Sequence
from contextlib import contextmanager, nullcontext
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from factories import variable_factory
from graphon.variables import VariableBase
from machinery.context import RequestContext
from models import App
from models.workflow import Workflow
from repositories.agent.workflow_binding_repository import WorkflowAgentBindingRepository
from repositories.app.console_repository import console_app_actor
from repositories.workflow.definition_repository import WorkflowDefinitionStore, workflow_snapshot
from services.app.console_service import ConsoleAppNotFoundError
from services.errors.app import WorkflowHashNotEqualError, WorkflowNotFoundError
from services.workflow.contracts import (
    DraftBindingTransaction,
    DraftSyncCommand,
    PreparedDraftSync,
    WorkflowOwner,
    WorkflowSnapshot,
)
from services.workflow.variable_contracts import DraftVariableContext, DraftVariableOwnerNotFoundError


def _after_import_commit(session: Session, callback: Callable[[], None]) -> None:
    """Run draft effects only after the encompassing import releases its transaction."""
    key = "workflow_draft_completion"
    if key not in session.info:
        callbacks: list[Callable[[], None]] = []
        session.info[key] = callbacks
        committed = False

        def mark_commit(current: Session) -> None:
            nonlocal committed
            if not current.in_nested_transaction():
                committed = True

        def mark_rollback(current: Session) -> None:
            nonlocal committed
            if not current.in_nested_transaction():
                committed = False
                callbacks.clear()

        def finish(_session: Session, transaction: SessionTransaction) -> None:
            nonlocal committed
            if transaction.parent is not None:
                return
            pending = callbacks[:]
            callbacks.clear()
            success, committed = committed, False
            if success:
                for complete in pending:
                    complete()

        event.listen(session, "after_commit", mark_commit)
        event.listen(session, "after_rollback", mark_rollback)
        event.listen(session, "after_transaction_end", finish)
    session.info[key].append(callback)


class _DraftTransaction:
    def __init__(self, session: Session, workflow: Workflow, bindings: WorkflowAgentBindingRepository):
        self._session = session
        self._workflow = workflow
        self.bindings = bindings
        self.completions: list[Callable[[], None]] = []

    @property
    def workflow(self) -> WorkflowSnapshot:
        return workflow_snapshot(self._workflow)

    def replace_graph(self, graph: dict[str, Any]) -> None:
        self._workflow.graph = json.dumps(graph)
        self._session.flush()

    def after_commit(self, callback: Callable[[], None]) -> None:
        self.completions.append(callback)


class WorkflowDraftRepository:
    def __init__(self, sessions: sessionmaker[Session], *, import_session: Session | None = None) -> None:
        self._sessions = sessions
        self._import_session = import_session

    def variable_context(
        self, context: RequestContext, owner: WorkflowOwner, *, include_draft: bool
    ) -> DraftVariableContext:
        with self._sessions() as session:
            try:
                row = WorkflowDefinitionStore.owner(session, context, owner)
            except (ConsoleAppNotFoundError, WorkflowNotFoundError) as error:
                raise DraftVariableOwnerNotFoundError(owner.kind) from error
            workflow = (
                WorkflowDefinitionStore.get_draft_workflow(
                    row, session=session, kind="snippet" if owner.kind == "snippet" else None
                )
                if include_draft
                else None
            )
            return DraftVariableContext(
                mode=row.mode if isinstance(row, App) else None,
                workflow=workflow,
                snapshot=workflow_snapshot(workflow) if workflow is not None else None,
            )

    def update_draft_variables(
        self,
        context: RequestContext,
        app_id: str,
        *,
        expected: WorkflowSnapshot,
        environment_variables: str | None,
        conversation_variables: Sequence[VariableBase] | None,
    ) -> None:
        with self._sessions.begin() as session:
            app = WorkflowDefinitionStore.lock_app(session, context, app_id)
            WorkflowDefinitionStore.update_draft_variables(
                session=session,
                app_model=app,
                account_id=context.account_id,
                expected=expected,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
            )

    def snapshot(
        self, context: RequestContext, owner: WorkflowOwner, workflow_id: str | None = None
    ) -> WorkflowSnapshot | None:
        with nullcontext(self._import_session) if self._import_session is not None else self._sessions() as session:
            row = WorkflowDefinitionStore.owner(session, context, owner)
            workflow = WorkflowDefinitionStore.get_draft_workflow(
                row, workflow_id, session=session, kind="snippet" if owner.kind == "snippet" else None
            )
            return workflow_snapshot(workflow) if workflow is not None else None

    @contextmanager
    def draft_sync(
        self, context: RequestContext, owner: WorkflowOwner, command: DraftSyncCommand, prepared: PreparedDraftSync
    ) -> Generator[DraftBindingTransaction[WorkflowAgentBindingRepository], None, None]:
        conversations = [
            variable_factory.build_conversation_variable_from_mapping(value) for value in command.conversation_variables
        ]
        with (
            nullcontext(self._import_session) if self._import_session is not None else self._sessions.begin() as session
        ):
            row = WorkflowDefinitionStore.owner(session, context, owner, lock=True)
            workflow = WorkflowDefinitionStore.sync_draft_workflow(
                app_model=row,
                account_id=context.account_id,
                session=session,
                graph=command.graph,
                features=command.features,
                conversation_variables=conversations,
                prepared=prepared,
                graph_only=command.is_collaborative,
                clear_debug_variables=command.clear_debug_variables,
                rag_pipeline_variables=command.rag_pipeline_variables,
                input_fields=command.input_fields,
            )
            transaction = _DraftTransaction(session, workflow, WorkflowAgentBindingRepository(session))
            yield transaction
            if self._import_session is not None:
                for callback in transaction.completions:
                    _after_import_commit(session, callback)
        if self._import_session is None:
            for callback in transaction.completions:
                callback()

    @contextmanager
    def draft_restore(
        self, context: RequestContext, owner: WorkflowOwner, source: WorkflowSnapshot
    ) -> Generator[DraftBindingTransaction[WorkflowAgentBindingRepository], None, None]:
        with self._sessions.begin() as session:
            row = WorkflowDefinitionStore.owner(session, context, owner, lock=True)
            current = WorkflowDefinitionStore.get_published_workflow_by_id(
                row, source.id, session=session, for_update=True, kind="snippet" if owner.kind == "snippet" else None
            )
            if current is None:
                raise WorkflowNotFoundError("Workflow not found")
            if workflow_snapshot(current) != source:
                raise WorkflowHashNotEqualError()
            workflow = WorkflowDefinitionStore.restore_published_workflow_to_draft(
                session=session, app_model=row, workflow_id=source.id, account=console_app_actor(session, context)
            )
            transaction = _DraftTransaction(session, workflow, WorkflowAgentBindingRepository(session))
            yield transaction
        for callback in transaction.completions:
            callback()
