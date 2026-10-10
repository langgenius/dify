"""Workflow definition persistence shared by Console and callers with an existing transaction.

WorkflowDefinitionStore stages changes in a caller-owned Session. The Console
repository owns a short transaction for every write and returns committed values;
validation, notifications and Agent retirement belong to the application use case.
"""

import json
import uuid
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from core.helper.encrypter import full_mask_token
from core.workflow.nodes.trigger_schedule.entities import ScheduleConfig
from factories import variable_factory
from graphon.variables import SegmentType, VariableBase
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models import Account, App
from models.dataset import AppDatasetJoin, Pipeline
from models.snippet import CustomizedSnippet
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowKind, WorkflowType
from repositories.agent.workflow_binding_repository import WorkflowAgentBindingRepository, workflow_binding_scope
from repositories.app.console_repository import console_app_actor, require_console_app
from repositories.trigger.workflow_repository import WorkflowTriggerRepository
from repositories.workflow.draft_variable_repository import delete_workflow_variables
from repositories.workflow.version_repository import allocate_version_number
from services.errors.app import (
    IsDraftWorkflowError,
    WorkflowHashNotEqualError,
    WorkflowIdFormatError,
    WorkflowNotFoundError,
)
from services.errors.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError
from services.workflow.contracts import (
    DeletedWorkflowBinding,
    DraftWorkflowMissingError,
    DraftWorkflowRead,
    PreparedDraftSync,
    WorkflowDebugNode,
    WorkflowOwner,
    WorkflowPublicationTransaction,
    WorkflowRecord,
    WorkflowSnapshot,
)
from services.workflow_ref_service import WorkflowRef, WorkflowRefService
from services.workflow_restore import apply_published_workflow_snapshot_to_draft
from tasks.new_agent_beta_task import register_new_agent_beta_workflow_publish_after_commit


class WorkflowDefinitionStore:
    """Persistence operations for callers that already own a transaction."""

    @staticmethod
    def prepare_execution_workflow(
        app_model: App,
        *,
        workflow_id: str | None,
        draft: bool,
        session: Session,
        snapshot: WorkflowSnapshot | None = None,
    ) -> Workflow:
        """Finish the request's read phase before handing detached inputs to execution.

        The generation adapter transfers ownership of its read Session here.
        Closing it detaches the loaded App, actor and Workflow without expiring
        their scalar values. Execution records are written by separate repositories.
        """
        with session:
            return (
                workflow_from_snapshot(snapshot)
                if snapshot is not None
                else WorkflowDefinitionStore.get_execution_workflow(
                    app_model, workflow_id=workflow_id, draft=draft, session=session
                )
            )

    @staticmethod
    def get_by_id(session: Session, *, tenant_id: str, app_id: str, workflow_id: str) -> Workflow | None:
        return session.scalar(
            select(Workflow).where(
                Workflow.tenant_id == tenant_id, Workflow.app_id == app_id, Workflow.id == workflow_id
            )
        )

    @staticmethod
    def get_by_version(session: Session, *, tenant_id: str, app_id: str, version: str) -> Workflow | None:
        """Read a pinned version, or the newest publication for an unpinned tool."""
        query = select(Workflow).where(Workflow.tenant_id == tenant_id, Workflow.app_id == app_id)
        if version:
            query = query.where(Workflow.version == version)
        else:
            query = query.where(Workflow.version != Workflow.VERSION_DRAFT).order_by(Workflow.created_at.desc())
        return session.scalars(query.limit(1)).first()

    @staticmethod
    def get_execution_workflow(app_model: App, *, workflow_id: str | None, draft: bool, session: Session) -> Workflow:
        if workflow_id:
            try:
                uuid.UUID(workflow_id)
            except ValueError:
                raise WorkflowIdFormatError(f"Invalid workflow_id format: '{workflow_id}'. ")
            workflow = WorkflowDefinitionStore.get_published_workflow_by_id(app_model, workflow_id, session=session)
            if workflow is None:
                raise WorkflowNotFoundError(f"Workflow not found with id: {workflow_id}")
            return workflow
        workflow = (
            WorkflowDefinitionStore.get_draft_workflow(app_model, session=session)
            if draft
            else WorkflowDefinitionStore.get_published_workflow(app_model, session=session)
        )
        if workflow is None:
            raise ValueError("Workflow not initialized" if draft else "Workflow not published")
        return workflow

    @staticmethod
    def lock_app(session: Session, context: RequestContext, app_id: str) -> App:
        app = require_console_app(session, context, app_id)
        return session.scalars(
            select(App)
            .where(App.tenant_id == app.tenant_id, App.id == app.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).one()

    @staticmethod
    def owner(
        session: Session, context: RequestContext, owner: WorkflowOwner, *, lock: bool = False
    ) -> App | Pipeline | CustomizedSnippet:
        if owner.kind == "app":
            return (
                WorkflowDefinitionStore.lock_app(session, context, owner.id)
                if lock
                else require_console_app(session, context, owner.id)
            )
        model = CustomizedSnippet if owner.kind == "snippet" else Pipeline
        query = select(model).where(model.tenant_id == context.active_workspace_id, model.id == owner.id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        row = session.scalar(query)
        if row is None:
            raise WorkflowNotFoundError(f"{owner.kind.capitalize()} not found")
        return row

    @staticmethod
    def activate(session: Session, app: App, workflow_id: str, account_id: str) -> None:
        app.workflow_id = workflow_id
        app.updated_by = account_id
        app.updated_at = naive_utc_now()
        session.flush()

    @staticmethod
    def sync_dataset_relationships(session: Session, app: App, dataset_ids: set[str]) -> None:
        existing = set(session.scalars(select(AppDatasetJoin.dataset_id).where(AppDatasetJoin.app_id == app.id)))
        for dataset_id in dataset_ids - existing:
            session.add(AppDatasetJoin(app_id=app.id, dataset_id=dataset_id))
        # Historical rows are not unique by (app_id, dataset_id). Delete every
        # removed relationship, including duplicates, without touching other apps.
        session.execute(
            delete(AppDatasetJoin).where(AppDatasetJoin.app_id == app.id, AppDatasetJoin.dataset_id.not_in(dataset_ids))
        )

    @staticmethod
    def update_draft_variables(
        *,
        session: Session,
        app_model: App,
        account_id: str,
        expected: WorkflowSnapshot,
        environment_variables: str | None,
        conversation_variables: Sequence[VariableBase] | None,
    ) -> None:
        """Compare only the collection being replaced, preserving unrelated draft edits."""
        workflow = WorkflowDefinitionStore.get_draft_workflow(app_model, session=session, for_update=True)
        if workflow is None or workflow.id != expected.id:
            raise WorkflowHashNotEqualError()
        if environment_variables is not None and json.loads(workflow._environment_variables or "{}") != json.loads(
            expected.environment_variables or "{}"
        ):
            raise WorkflowHashNotEqualError()
        if conversation_variables is not None and json.loads(workflow._conversation_variables or "{}") != json.loads(
            expected.conversation_variables or "{}"
        ):
            raise WorkflowHashNotEqualError()
        if environment_variables is not None:
            workflow._environment_variables = environment_variables
        if conversation_variables is not None:
            workflow.conversation_variables = conversation_variables
        workflow.updated_by = account_id
        workflow.updated_at = naive_utc_now()
        session.flush()

    @staticmethod
    def update_features(*, session: Session, app_model: App, account_id: str, features: dict[str, Any]) -> None:
        workflow = WorkflowDefinitionStore.get_draft_workflow(app_model, session=session, for_update=True)
        if workflow is None:
            raise ValueError("No draft workflow found.")
        workflow.features = json.dumps(features)
        workflow.updated_by = account_id
        workflow.updated_at = naive_utc_now()

    @staticmethod
    def get_draft_workflow(
        app_model: App | Pipeline | CustomizedSnippet,
        workflow_id: str | None = None,
        *,
        session: Session,
        kind: str | None = None,
        for_update: bool = False,
    ) -> Workflow | None:
        """
        Get draft workflow

        Reuses the caller's active session so workflow reads stay in the same
        transaction as the surrounding request or task.
        """
        if workflow_id:
            return WorkflowDefinitionStore.get_published_workflow_by_id(
                app_model, workflow_id, session=session, kind=kind, for_update=for_update
            )
        # fetch draft workflow by app_model
        stmt = (
            select(Workflow)
            .where(
                Workflow.tenant_id == app_model.tenant_id,
                Workflow.app_id == app_model.id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
            .limit(1)
        )
        if kind is not None:
            stmt = stmt.where(Workflow.kind == kind)
        if for_update:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        return session.scalar(stmt)

    @staticmethod
    def get_published_workflow_by_id(
        app_model: App | Pipeline | CustomizedSnippet,
        workflow_id: str,
        *,
        session: Session,
        for_update: bool = False,
        kind: str | None = None,
    ) -> Workflow | None:
        """Fetch a published workflow by ID in the caller's transaction.

        With ``for_update=True``, the source version stays locked until that
        transaction ends. Restore uses the lock while copying Agent bindings so
        a concurrent delete cannot release the same owner.
        """
        stmt = (
            select(Workflow)
            .where(
                Workflow.tenant_id == app_model.tenant_id,
                Workflow.app_id == app_model.id,
                Workflow.id == workflow_id,
            )
            .limit(1)
        )
        if kind is not None:
            stmt = stmt.where(Workflow.kind == kind)
        if for_update:
            stmt = stmt.with_for_update()
        workflow = session.scalar(stmt)
        if not workflow:
            return None
        if workflow.version == Workflow.VERSION_DRAFT:
            raise IsDraftWorkflowError(
                f"Cannot use draft workflow version. Workflow ID: {workflow_id}. "
                f"Please use a published workflow version or leave workflow_id empty."
            )
        return workflow

    @staticmethod
    def get_published_workflow(
        app_model: App | Pipeline | CustomizedSnippet, *, session: Session, kind: str | None = None
    ) -> Workflow | None:
        """
        Get published workflow

        Reuses the caller's active session so workflow reads stay in the same
        transaction as the surrounding request or task.
        """

        if not app_model.workflow_id:
            return None

        stmt = (
            select(Workflow)
            .where(
                Workflow.tenant_id == app_model.tenant_id,
                Workflow.app_id == app_model.id,
                Workflow.id == app_model.workflow_id,
            )
            .limit(1)
        )
        if kind is not None:
            stmt = stmt.where(Workflow.kind == kind)
        return session.scalar(stmt)

    @staticmethod
    def get_all_published_workflow(
        *,
        session: Session,
        app_model: App | Pipeline | CustomizedSnippet,
        page: int,
        limit: int,
        user_id: str | None,
        named_only: bool = False,
        kind: str | None = None,
        include_draft: bool = True,
    ) -> tuple[Sequence[Workflow], bool]:
        """
        Get published workflow with pagination
        """
        if not app_model.workflow_id:
            return [], False

        stmt = (
            select(Workflow)
            .where(Workflow.tenant_id == app_model.tenant_id, Workflow.app_id == app_model.id)
            # The draft leads the list; its `created_at` is the app's creation time, so it would
            # otherwise sort last. Published versions then order by publish time: `version` is a
            # stringified timestamp whose microseconds are omitted when zero, so ordering by it
            # misplaces versions across second boundaries, and `version_number` is NULL for
            # versions published before numbering was introduced.
            .order_by(
                (Workflow.version == Workflow.VERSION_DRAFT).desc(),
                Workflow.created_at.desc(),
                Workflow.id.desc(),
            )
            .limit(limit + 1)
            .offset((page - 1) * limit)
        )

        if user_id:
            stmt = stmt.where(Workflow.created_by == user_id)

        if named_only:
            stmt = stmt.where(Workflow.marked_name != "")

        if kind is not None:
            stmt = stmt.where(Workflow.kind == kind)
        if not include_draft:
            stmt = stmt.where(Workflow.version != Workflow.VERSION_DRAFT)

        workflows = session.scalars(stmt).all()

        has_more = len(workflows) > limit
        if has_more:
            workflows = workflows[:-1]

        return workflows, has_more

    @staticmethod
    def update_workflow(
        *,
        session: Session,
        account_id: str,
        data: dict[str, Any],
        workflow_ref: WorkflowRef,
        kind: str | None = None,
        published_only: bool = False,
    ) -> Workflow | None:
        """
        Update workflow attributes

        :param session: SQLAlchemy database session
        :param account_id: Account ID (for permission check)
        :param data: Dictionary containing fields to update
        :param workflow_ref: Owner-bound workflow reference
        :return: Updated workflow or None if not found
        """
        stmt = select(Workflow).where(
            Workflow.id == workflow_ref.workflow_id,
            Workflow.tenant_id == workflow_ref.tenant_id,
            Workflow.app_id == workflow_ref.owner_id,
        )
        if kind is not None:
            stmt = stmt.where(Workflow.kind == kind)
        if published_only:
            stmt = stmt.where(Workflow.version != Workflow.VERSION_DRAFT)
        workflow = session.scalar(stmt)

        if not workflow:
            return None

        allowed_fields = ["marked_name", "marked_comment"]

        for field, value in data.items():
            if field in allowed_fields:
                setattr(workflow, field, value)

        workflow.updated_by = account_id
        workflow.updated_at = naive_utc_now()

        return workflow

    @staticmethod
    def delete_workflow(
        *, session: Session, workflow_ref: WorkflowRef, kind: str | None = None
    ) -> list[DeletedWorkflowBinding]:
        """Stage a published Workflow and its binding owners for deletion.

        The exact owner key is tenant, App, Workflow, and Workflow version. The
        Workflow row lock serializes source-version reads and restoration with
        deletion. Return the removed bindings so the use case can decide which
        Agents to retire after a successful commit.

        :param session: SQLAlchemy database session
        :param workflow_ref: Owner-bound workflow reference
        :return: Bindings staged for deletion in the same transaction
        :raises: ValueError if workflow not found
        :raises: WorkflowInUseError if workflow is in use
        :raises: DraftWorkflowDeletionError if workflow is a draft version
        """
        stmt = (
            select(Workflow)
            .where(
                Workflow.id == workflow_ref.workflow_id,
                Workflow.tenant_id == workflow_ref.tenant_id,
                Workflow.app_id == workflow_ref.owner_id,
            )
            .with_for_update()
        )
        if kind is not None:
            stmt = stmt.where(Workflow.kind == kind)
        workflow = session.scalar(stmt)

        if not workflow:
            raise ValueError(f"Workflow with ID {workflow_ref.workflow_id} not found")

        # Check if workflow is a draft version
        if workflow.version == Workflow.VERSION_DRAFT:
            raise DraftWorkflowDeletionError("Cannot delete draft workflow versions")

        # Check if this workflow is currently referenced by an app
        app_stmt = select(App).where(App.workflow_id == workflow_ref.workflow_id)
        app = session.scalar(app_stmt)
        if app:
            # Cannot delete a workflow that's currently in use by an app
            raise WorkflowInUseError(f"Cannot delete workflow that is currently in use by app '{app.id}'")

        # Don't use workflow.tool_published as it's not accurate for specific workflow versions
        # Check if there's a tool provider using this specific workflow version
        tool_provider = session.scalar(
            select(WorkflowToolProvider).where(
                WorkflowToolProvider.tenant_id == workflow.tenant_id,
                WorkflowToolProvider.app_id == workflow.app_id,
                WorkflowToolProvider.version == workflow.version,
            )
        )

        if tool_provider:
            # Cannot delete a workflow that's published as a tool
            raise WorkflowInUseError("Cannot delete workflow that is published as a tool")

        bindings = WorkflowAgentBindingRepository(session).delete_workflow_bindings(workflow_binding_scope(workflow))
        session.delete(workflow)
        return bindings

    @staticmethod
    def sync_draft_workflow(
        *,
        app_model: App | Pipeline | CustomizedSnippet,
        graph: dict[str, Any],
        features: dict[str, Any],
        account_id: str,
        prepared: PreparedDraftSync,
        conversation_variables: Sequence[VariableBase],
        session: Session,
        graph_only: bool = False,
        clear_debug_variables: bool = False,
        rag_pipeline_variables: list[dict[str, Any]] | None = None,
        input_fields: list[dict[str, Any]] | None = None,
    ) -> Workflow:
        """Stage a prepared draft under its row lock, without invoking the key service."""
        workflow = WorkflowDefinitionStore.get_draft_workflow(app_model, session=session, for_update=True)
        current = workflow_snapshot(workflow) if workflow is not None else None
        if current != prepared.source:
            raise WorkflowHashNotEqualError()
        environment = prepared.environment
        if environment is not None and (
            environment.workflow_id != (current.id if current else None)
            or environment.source != (current.environment_variables if current else None)
        ):
            raise WorkflowHashNotEqualError()
        if workflow is None:
            workflow = Workflow(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                type=(
                    WorkflowType.from_app_mode(app_model.mode).value
                    if isinstance(app_model, App)
                    else WorkflowType.RAG_PIPELINE.value
                    if isinstance(app_model, Pipeline)
                    else WorkflowType.WORKFLOW.value
                ),
                kind="snippet" if isinstance(app_model, CustomizedSnippet) else "standard",
                version=Workflow.VERSION_DRAFT,
                graph=json.dumps(graph),
                features=json.dumps(features),
                created_by=account_id,
                _environment_variables=environment.value if environment is not None else "{}",
                conversation_variables=conversation_variables,
            )
            session.add(workflow)
        else:
            workflow.graph = json.dumps(graph)
            workflow.updated_by = account_id
            workflow.updated_at = naive_utc_now()
            if not graph_only:
                if isinstance(app_model, App):
                    workflow.features = json.dumps(features)
                workflow.conversation_variables = conversation_variables
            if environment is not None:
                workflow._environment_variables = environment.value

        if rag_pipeline_variables is not None:
            workflow.rag_pipeline_variables = rag_pipeline_variables
        if isinstance(app_model, CustomizedSnippet):
            workflow.kind = WorkflowKind.SNIPPET
            workflow._environment_variables = "{}"
            workflow._conversation_variables = "{}"
            if input_fields is not None:
                app_model.input_fields = json.dumps(input_fields)
                app_model.updated_by = account_id
                app_model.updated_at = naive_utc_now()
        if clear_debug_variables:
            # DSL replacement and debug-variable invalidation share one atomic write.
            delete_workflow_variables(session, app_id=app_model.id, user_id=None, node_id=None)
        session.flush()
        if isinstance(app_model, Pipeline) and current is None:
            app_model.workflow_id = workflow.id
            session.flush()
        return workflow

    @staticmethod
    def publish_workflow(
        *,
        session: Session,
        app_model: App,
        account: Account,
        marked_name: str,
        marked_comment: str,
    ) -> Workflow:
        """Stage a validated version; the caller owns binding writes and the commit."""
        draft_workflow = WorkflowDefinitionStore.get_draft_workflow(app_model, session=session, for_update=True)
        if draft_workflow is None:
            raise ValueError("No valid workflow found.")

        # create new workflow
        workflow = Workflow.new(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type=draft_workflow.type,
            version=Workflow.version_from_datetime(naive_utc_now()),
            version_number=allocate_version_number(session=session, app_id=app_model.id),
            graph=draft_workflow.graph,
            created_by=account.id,
            environment_variables=[],
            conversation_variables=draft_workflow.conversation_variables,
            marked_name=marked_name,
            marked_comment=marked_comment,
            rag_pipeline_variables=draft_workflow.rag_pipeline_variables,
            features=draft_workflow.features,
        )

        # Same tenant and revision: preserve ciphertext without a remote key
        # unwrap/wrap while the publication transaction holds workflow locks.
        workflow._environment_variables = draft_workflow._environment_variables
        session.add(workflow)
        session.flush()
        return workflow

    @staticmethod
    def restore_published_workflow_to_draft(
        *,
        app_model: App | Pipeline | CustomizedSnippet,
        workflow_id: str,
        account: Account,
        session: Session,
    ) -> Workflow:
        """Stage a validated published snapshot in the locked draft.

        Secret environment variables are copied server-side from the selected
        published workflow so the normal draft sync flow stays stateless.
        """
        source_workflow = WorkflowDefinitionStore.get_published_workflow_by_id(
            app_model=app_model,
            workflow_id=workflow_id,
            session=session,
            for_update=True,
        )
        if not source_workflow:
            raise WorkflowNotFoundError("Workflow not found.")

        draft_workflow = WorkflowDefinitionStore.get_draft_workflow(
            app_model=app_model, session=session, for_update=True
        )
        draft_workflow, is_new_draft = apply_published_workflow_snapshot_to_draft(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            source_workflow=source_workflow,
            draft_workflow=draft_workflow,
            account=account,
            updated_at_factory=naive_utc_now,
        )

        if is_new_draft:
            session.add(draft_workflow)

        draft_workflow.kind = source_workflow.kind
        session.flush()
        if isinstance(app_model, Pipeline) and is_new_draft:
            app_model.workflow_id = draft_workflow.id
            session.flush()
        return draft_workflow


def account_record(account: Account | None) -> dict[str, str] | None:
    return {"id": account.id, "name": account.name, "email": account.email} if account is not None else None


def workflow_record(workflow: Workflow, session: Session) -> WorkflowRecord:
    # This projection is only used for display. Decode ordinary variables, but
    # never unwrap persisted secrets just to mask them again in the response.
    environment = json.loads(workflow._environment_variables or "{}") if workflow.tenant_id else {}
    environment_variables = [
        variable_factory.build_environment_variable_from_mapping(
            {**value, "value": full_mask_token()} if value.get("value_type") == SegmentType.SECRET else value
        )
        for value in environment.values()
    ]
    return WorkflowRecord(
        id=workflow.id,
        graph=dict(workflow.graph_dict),
        features=workflow.features_dict,
        hash=workflow.unique_hash,
        version=workflow.version,
        version_number=workflow.version_number,
        marked_name=workflow.marked_name,
        marked_comment=workflow.marked_comment,
        created_by=account_record(workflow.get_created_by_account(session=session)),
        updated_by=account_record(workflow.get_updated_by_account(session=session)),
        created_at=workflow.created_at,
        updated_at=workflow.updated_at or workflow.created_at,
        tool_published=workflow.get_tool_published(session=session),
        environment_variables=environment_variables,
        conversation_variables=list(workflow.conversation_variables),
        rag_pipeline_variables=workflow.rag_pipeline_variables,
    )


def workflow_snapshot(workflow: Workflow) -> WorkflowSnapshot:
    return WorkflowSnapshot(
        id=workflow.id,
        tenant_id=workflow.tenant_id,
        app_id=workflow.app_id,
        type=workflow.type,
        kind=workflow.kind,
        version=workflow.version,
        version_number=workflow.version_number,
        marked_name=workflow.marked_name,
        marked_comment=workflow.marked_comment,
        hash=workflow.unique_hash,
        graph=workflow.graph,
        features=workflow.serialized_features,
        environment_variables=workflow._environment_variables,
        conversation_variables=workflow._conversation_variables,
        rag_pipeline_variables=workflow._rag_pipeline_variables,
        created_by=workflow.created_by,
        created_at=workflow.created_at,
        updated_by=workflow.updated_by,
        updated_at=workflow.updated_at or workflow.created_at,
    )


def workflow_from_snapshot(snapshot: WorkflowSnapshot) -> Workflow:
    """Rehydrate stored values without a query or secret re-encryption."""
    return Workflow(
        id=snapshot.id,
        tenant_id=snapshot.tenant_id,
        app_id=snapshot.app_id,
        type=snapshot.type,
        kind=snapshot.kind,
        version=snapshot.version,
        version_number=snapshot.version_number,
        marked_name=snapshot.marked_name,
        marked_comment=snapshot.marked_comment,
        graph=snapshot.graph,
        _features=snapshot.features,
        _environment_variables=snapshot.environment_variables,
        _conversation_variables=snapshot.conversation_variables,
        _rag_pipeline_variables=snapshot.rag_pipeline_variables,
        created_by=snapshot.created_by,
        created_at=snapshot.created_at,
        updated_by=snapshot.updated_by,
        updated_at=snapshot.updated_at,
    )


@dataclass
class _PublicationTransaction:
    session: Session
    app: App
    actor: Account
    draft: WorkflowSnapshot
    bindings: WorkflowAgentBindingRepository

    def create_version(self, *, marked_name: str, marked_comment: str) -> WorkflowSnapshot:
        workflow = WorkflowDefinitionStore.publish_workflow(
            session=self.session,
            app_model=self.app,
            account=self.actor,
            marked_name=marked_name,
            marked_comment=marked_comment,
        )
        return workflow_snapshot(workflow)

    def sync_webhooks(self, node_ids: Sequence[str]) -> None:
        WorkflowTriggerRepository.sync_webhooks(self.session, self.app, node_ids, remove_stale=True)

    def sync_plugins(self, relationships: Sequence[Mapping[str, Any]]) -> None:
        WorkflowTriggerRepository.sync_plugins(self.session, self.app, relationships)

    def sync_schedule(self, schedule: ScheduleConfig | None) -> None:
        WorkflowTriggerRepository.sync_schedule(self.session, self.app, schedule)

    def sync_triggers(self, triggers: Sequence[Mapping[str, Any]]) -> None:
        WorkflowTriggerRepository.sync_app_triggers(self.session, self.app, triggers)

    def sync_datasets(self, dataset_ids: set[str]) -> None:
        WorkflowDefinitionStore.sync_dataset_relationships(self.session, self.app, dataset_ids)

    def track_inline_publish(self, workflow: WorkflowSnapshot) -> None:
        register_new_agent_beta_workflow_publish_after_commit(
            session=self.session, published_workflow_id=workflow.id, published_at=workflow.created_at
        )

    def activate(self, workflow: WorkflowSnapshot) -> None:
        WorkflowDefinitionStore.activate(self.session, self.app, workflow.id, self.actor.id)


class WorkflowDefinitionRepository:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        import_session: Session | None = None,
    ) -> None:
        self._sessions = session_factory
        self._import_session = import_session

    def debug_context(
        self,
        context: RequestContext,
        app_id: str,
        *,
        workflow_id: str | None,
        snapshot: WorkflowSnapshot | None,
    ) -> tuple[App, Account, Workflow]:
        """Load execution inputs in a short read, keeping persisted secrets encrypted."""
        if snapshot is not None and (snapshot.tenant_id, snapshot.app_id) != (context.active_workspace_id, app_id):
            raise WorkflowNotFoundError("Workflow not found")
        with self._sessions() as session:
            app = require_console_app(session, context, app_id)
            actor = console_app_actor(session, context)
            workflow = (
                workflow_from_snapshot(snapshot)
                if snapshot is not None
                else WorkflowDefinitionStore.get_execution_workflow(
                    app, workflow_id=workflow_id, draft=True, session=session
                )
            )
            return app, actor, workflow

    def get_draft_workflow(self, pipeline: Pipeline) -> Workflow | None:
        with self._sessions() as session:
            return WorkflowDefinitionStore.get_draft_workflow(pipeline, session=session)

    def get_published_workflow(self, pipeline: Pipeline) -> Workflow | None:
        with self._sessions() as session:
            return WorkflowDefinitionStore.get_published_workflow(pipeline, session=session)

    def validation_state(
        self, context: RequestContext, app_id: str, workflow_id: str | None = None
    ) -> tuple[App, WorkflowSnapshot | None]:
        with nullcontext(self._import_session) if self._import_session is not None else self._sessions() as session:
            app = require_console_app(session, context, app_id)
            workflow = WorkflowDefinitionStore.get_draft_workflow(app, workflow_id, session=session)
            return app, workflow_snapshot(workflow) if workflow is not None else None

    @contextmanager
    def binding_reader(self) -> Generator[WorkflowAgentBindingRepository, None, None]:
        with self._sessions() as session:
            yield WorkflowAgentBindingRepository(session)

    def app(self, context: RequestContext, app_id: str) -> App:
        with self._sessions() as session:
            return require_console_app(session, context, app_id)

    @contextmanager
    def draft(
        self, context: RequestContext, app_id: str
    ) -> Generator[DraftWorkflowRead[WorkflowAgentBindingRepository] | None, None, None]:
        with self._sessions() as session:
            app = require_console_app(session, context, app_id)
            workflow = WorkflowDefinitionStore.get_draft_workflow(app, session=session)
            yield (
                DraftWorkflowRead(
                    workflow_record(workflow, session),
                    workflow_snapshot(workflow),
                    WorkflowAgentBindingRepository(session),
                )
                if workflow is not None
                else None
            )

    @contextmanager
    def publication(
        self, context: RequestContext, app_id: str, draft: WorkflowSnapshot
    ) -> Generator[WorkflowPublicationTransaction[WorkflowAgentBindingRepository], None, None]:
        with self._sessions.begin() as session:
            app = WorkflowDefinitionStore.lock_app(session, context, app_id)
            current = WorkflowDefinitionStore.get_draft_workflow(app, session=session, for_update=True)
            if current is None or workflow_snapshot(current) != draft:
                raise WorkflowHashNotEqualError()
            yield _PublicationTransaction(
                session,
                app,
                console_app_actor(session, context),
                workflow_snapshot(current),
                WorkflowAgentBindingRepository(session),
            )

    def debug_node(self, context: RequestContext, app_id: str, node_id: str) -> WorkflowDebugNode:
        with self._sessions() as session:
            app = require_console_app(session, context, app_id)
            workflow = WorkflowDefinitionStore.get_draft_workflow(app, session=session)
            if workflow is None:
                raise DraftWorkflowMissingError("Workflow not initialized")
            config = workflow.get_node_config_by_id(node_id)
            enclosing = workflow.get_enclosing_node_type_and_id(config)
            return WorkflowDebugNode(
                config=config,
                environment_variables=workflow._environment_variables,
                conversation_variables=list(workflow.conversation_variables),
                enclosing_node_id=enclosing[1] if enclosing else None,
            )

    def published(self, context: RequestContext, app_id: str) -> WorkflowRecord | None:
        with self._sessions() as session:
            app = require_console_app(session, context, app_id)
            workflow = WorkflowDefinitionStore.get_published_workflow(app, session=session)
            return workflow_record(workflow, session) if workflow is not None else None

    def versions(
        self, context: RequestContext, app_id: str, *, page: int, limit: int, user_id: str | None, named_only: bool
    ) -> tuple[list[WorkflowRecord], bool]:
        with self._sessions() as session:
            app = require_console_app(session, context, app_id)
            workflows, has_more = WorkflowDefinitionStore.get_all_published_workflow(
                session=session, app_model=app, page=page, limit=limit, user_id=user_id, named_only=named_only
            )
            return [workflow_record(workflow, session) for workflow in workflows], has_more

    def update(
        self, context: RequestContext, app_id: str, workflow_id: str, changes: dict[str, str]
    ) -> WorkflowRecord | None:
        with self._sessions.begin() as session:
            app = require_console_app(session, context, app_id)
            workflow = WorkflowDefinitionStore.update_workflow(
                session=session,
                account_id=context.account_id,
                data=changes,
                workflow_ref=WorkflowRefService.create_app_workflow_ref(app, workflow_id),
            )
            return workflow_record(workflow, session) if workflow is not None else None

    def delete(self, context: RequestContext, owner: WorkflowOwner, workflow_id: str) -> list[DeletedWorkflowBinding]:
        with self._sessions.begin() as session:
            row = WorkflowDefinitionStore.owner(session, context, owner, lock=True)
            if row.workflow_id == workflow_id:
                raise WorkflowInUseError(
                    f"Cannot delete workflow that is currently in use by {owner.kind} '{owner.id}'"
                )
            try:
                return WorkflowDefinitionStore.delete_workflow(
                    session=session,
                    workflow_ref=WorkflowRef(context.active_workspace_id, owner.id, workflow_id),
                    kind="snippet" if owner.kind == "snippet" else None,
                )
            except (DraftWorkflowDeletionError, WorkflowInUseError):
                raise
            except ValueError as error:
                raise WorkflowNotFoundError(str(error)) from error

    def update_features(self, context: RequestContext, app_id: str, features: dict[str, Any]) -> None:
        with self._sessions.begin() as session:
            app = require_console_app(session, context, app_id)
            WorkflowDefinitionStore.update_features(
                session=session, app_model=app, account_id=context.account_id, features=features
            )
