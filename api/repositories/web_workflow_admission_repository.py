"""Atomically validate current Web resources and register execution before launch."""

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from constants.end_user_connections import ConnectionCredentialStatus
from context.connection_execution import ConnectionExecutionContext
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.account import Account, AccountStatus
from models.end_user_connection import EndUserConnection
from models.enums import AppStatus, ConversationFromSource, CreatorUserRole, EndUserType, MessageStatus
from models.model import App, Conversation, Message
from models.workflow import Workflow, WorkflowRun
from repositories.conversation_access import conversation_owner_scope
from repositories.conversation_file_access import require_execution_file_ownership
from repositories.end_user_execution_lock import lock_end_user, translate_end_user_lock_errors
from repositories.entities.web_execution import EndUserBusyError, WebExecutionResourcesChangedError


class WebWorkflowAdmissionRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def reject_pending_message(self, *, tenant_id: str, app_id: str, end_user_id: str, run_id: str) -> None:
        """An admission failure must release Chatflow's pre-Run acceptance marker."""
        with self._sessions.begin() as session:
            session.execute(
                sa.update(Message)
                .where(
                    Message.app_id == app_id,
                    Message.from_end_user_id == end_user_id,
                    Message.from_source == ConversationFromSource.API,
                    Message.from_account_id.is_(None),
                    Message.workflow_run_id == run_id,
                    sa.exists(sa.select(App.id).where(App.id == app_id, App.tenant_id == tenant_id)),
                    ~sa.exists(sa.select(WorkflowRun.id).where(WorkflowRun.id == run_id)),
                )
                .values(status=MessageStatus.ERROR, error="Workflow execution could not start.")
            )

    @translate_end_user_lock_errors()
    def admit(
        self,
        run: WorkflowRun,
        *,
        account_id: str | None,
        conversation_id: str | None,
        upload_ids: frozenset[str],
        tool_ids: frozenset[str],
        resume: bool,
    ) -> None:
        if run.created_by_role != CreatorUserRole.END_USER:
            raise WebExecutionResourcesChangedError()
        with self._sessions.begin() as session:
            # This must be the first read: locking reads precede the snapshot on MySQL too.
            user = lock_end_user(
                session, tenant_id=run.tenant_id, app_id=run.app_id, end_user_id=run.created_by, exclusive=False
            )
            if user is None or user.type != EndUserType.BROWSER or user.account_id != account_id:
                raise WebExecutionResourcesChangedError()
            app = session.scalar(
                sa.select(App.id).where(
                    App.id == run.app_id,
                    App.tenant_id == run.tenant_id,
                    App.status == AppStatus.NORMAL,
                    App.enable_site.is_(True),
                )
            )
            workflow = session.scalar(
                sa.select(Workflow.id).where(
                    Workflow.id == run.workflow_id,
                    Workflow.app_id == run.app_id,
                    Workflow.tenant_id == run.tenant_id,
                    Workflow.version != Workflow.VERSION_DRAFT,
                )
            )
            if app is None or workflow is None:
                raise WebExecutionResourcesChangedError()
            if (
                account_id is not None
                and session.scalar(
                    sa.select(Account.id).where(
                        Account.id == account_id,
                        Account.status.in_((AccountStatus.ACTIVE, AccountStatus.UNINITIALIZED)),
                    )
                )
                is None
            ):
                raise WebExecutionResourcesChangedError()
            if conversation_id is not None:
                if (
                    session.scalar(
                        sa.select(Conversation.id).where(
                            Conversation.id == conversation_id, *conversation_owner_scope(run.app_id, user)
                        )
                    )
                    is None
                ):
                    raise WebExecutionResourcesChangedError()
            require_execution_file_ownership(
                session,
                tenant_id=run.tenant_id,
                app_id=run.app_id,
                user=user,
                conversation_id=conversation_id,
                upload_ids=upload_ids,
                tool_ids=tool_ids,
            )
            if run.connection_context is not None:
                context = ConnectionExecutionContext.model_validate_json(run.connection_context)
                if (
                    context.tenant_id,
                    context.app_id,
                    context.workflow_id,
                    context.end_user_id,
                    context.account_id,
                ) != (run.tenant_id, run.app_id, run.workflow_id, user.id, user.account_id):
                    raise WebExecutionResourcesChangedError()
                owner = (
                    sa.and_(EndUserConnection.end_user_id == user.id, EndUserConnection.account_id.is_(None))
                    if user.account_id is None
                    else sa.and_(
                        EndUserConnection.account_id == user.account_id, EndUserConnection.end_user_id.is_(None)
                    )
                )
                connection_ids = {item.connection_id for item in context.selections if item.connection_id is not None}
                records = (
                    {
                        row[0]: row[1]
                        for row in session.execute(
                            sa.select(EndUserConnection.id, EndUserConnection.provider).where(
                                EndUserConnection.id.in_(connection_ids),
                                EndUserConnection.tenant_id == run.tenant_id,
                                EndUserConnection.status == ConnectionCredentialStatus.CONNECTED,
                                owner,
                            )
                        )
                    }
                    if connection_ids
                    else {}
                )
                if any(
                    item.connection_id is None or records.get(item.connection_id) != item.provider
                    for item in context.selections
                ):
                    raise WebExecutionResourcesChangedError()
            existing = session.get(WorkflowRun, run.id)
            if resume:
                if existing is None or (
                    existing.tenant_id,
                    existing.app_id,
                    existing.workflow_id,
                    existing.created_by_role,
                    existing.created_by,
                ) != (run.tenant_id, run.app_id, run.workflow_id, CreatorUserRole.END_USER, user.id):
                    raise WebExecutionResourcesChangedError()
                if (
                    existing.status not in (WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED)
                    or existing.stop_requested_at
                ):
                    raise WebExecutionResourcesChangedError()
                if existing.connection_context is not None and (
                    run.connection_context is None
                    or ConnectionExecutionContext.model_validate_json(existing.connection_context)
                    != ConnectionExecutionContext.model_validate_json(run.connection_context)
                ):
                    raise WebExecutionResourcesChangedError()
                # The durable pause owner already arbitrates duplicate resume attempts.
                updated = session.execute(
                    sa.update(WorkflowRun)
                    .where(
                        WorkflowRun.id == run.id,
                        WorkflowRun.tenant_id == run.tenant_id,
                        WorkflowRun.app_id == run.app_id,
                        WorkflowRun.status.in_((WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED)),
                        WorkflowRun.stop_requested_at.is_(None),
                    )
                    .values(status=WorkflowExecutionStatus.RUNNING, task_id=run.task_id)
                    .execution_options(synchronize_session=False)
                )
                if not isinstance(updated, sa.CursorResult) or updated.rowcount != 1:
                    raise WebExecutionResourcesChangedError()
            else:
                if existing is not None:
                    raise EndUserBusyError()
                session.add(run)

    def finish_unstarted_or_incomplete(self, *, tenant_id: str, app_id: str, end_user_id: str, run_id: str) -> None:
        """Only the exiting worker/failed launcher may settle its unfinished admission."""
        with self._sessions.begin() as session:
            updated = session.execute(
                sa.update(WorkflowRun)
                .where(
                    WorkflowRun.id == run_id,
                    WorkflowRun.tenant_id == tenant_id,
                    WorkflowRun.app_id == app_id,
                    WorkflowRun.created_by_role == CreatorUserRole.END_USER,
                    WorkflowRun.created_by == end_user_id,
                    WorkflowRun.status == WorkflowExecutionStatus.RUNNING,
                )
                .values(
                    status=sa.case(
                        (WorkflowRun.stop_requested_at.is_not(None), WorkflowExecutionStatus.STOPPED),
                        else_=WorkflowExecutionStatus.FAILED,
                    ),
                    error="Workflow execution ended before completion.",
                    finished_at=naive_utc_now(),
                )
            )
            if isinstance(updated, sa.CursorResult) and updated.rowcount:
                session.execute(
                    sa.update(Message)
                    .where(
                        Message.app_id == app_id,
                        Message.workflow_run_id == run_id,
                        Message.from_end_user_id == end_user_id,
                        Message.from_source == ConversationFromSource.API,
                        Message.from_account_id.is_(None),
                    )
                    .values(status=MessageStatus.ERROR, error="Workflow execution ended before completion.")
                )
