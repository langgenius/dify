"""Remove application-owned storage before deleting the durable database references.

Uploads owned by accounts, subscription-wide trigger requests, tenant telemetry,
and manually named exports do not have exclusive application ownership. They are
deliberately retained rather than deleting another resource's data.
"""

import logging

from sqlalchemy import and_, delete, exists, or_, select, update
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql.selectable import Exists

from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from models import Conversation, EndUser, Message, MessageFile, UploadFile
from models.enums import CreatorUserRole
from models.tools import ToolFile
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
)
from repositories.knowledge.upload_file_repository import (
    AgentConfigToolFileCleanup,
    claim_orphan_agent_config_tool_files,
    claim_orphan_upload_files,
    delete_claimed_agent_config_tool_files,
    delete_orphan_upload_files,
    detach_workflow_node_execution_offloads_and_claim_uploads,
    find_claimed_upload_files,
    recheck_claimed_agent_config_tool_files,
    recheck_claimed_orphan_upload_files,
)
from services.knowledge.file_cleanup_gate import assert_physical_file_cleanup_enabled
from services.knowledge.indexing.cleanup import UploadFileCleanup

logger = logging.getLogger(__name__)
_BATCH_SIZE = 500


def _delete_object(key: str) -> None:
    """Allow redelivery after a storage delete succeeded but the DB commit failed."""
    assert_physical_file_cleanup_enabled()
    try:
        storage.delete(key)
    except FileNotFoundError:
        return
    except Exception:
        # Some backends return False from exists() for permission failures too;
        # never use that as evidence that a failed deletion actually succeeded.
        logger.exception("Application storage cleanup failed for key=%s", key)
        raise


def cleanup_app_storage(tenant_id: str, app_id: str) -> None:
    """Clean exclusively owned files with external I/O outside DB transactions.

    Call before deleting runs, conversations, messages, or end users. A storage
    failure propagates to the App deletion task so its durable operation can
    retry while the remaining references still resolve the keys. Each
    successful batch removes its references atomically.
    """
    # The App row is already deleted by the caller. Validate trace ownership
    # against remaining tenant-scoped resources before removing those resources.
    with session_factory.create_session() as session:
        owns_traces = any(
            session.scalar(select(exists().where(model.tenant_id == tenant_id, model.app_id == app_id)))
            for model in (Workflow, WorkflowRun, EndUser)
        )
    _cleanup_claimed_upload_files(tenant_id)
    _cleanup_pauses(tenant_id, app_id)
    _cleanup_node_offloads(tenant_id, app_id)
    _cleanup_tool_files(tenant_id, app_id)
    _cleanup_end_user_uploads(tenant_id, app_id)
    if owns_traces:
        _cleanup_traces(app_id)


def _cleanup_claimed_upload_files(tenant_id: str) -> None:
    """Resume one bounded tenant batch claimed before the App transaction committed."""

    with session_factory.create_session() as session:
        pending = find_claimed_upload_files(session, tenant_id=tenant_id, limit=_BATCH_SIZE)
    candidates = tuple(file for _, file in pending)
    if not candidates:
        return
    with session_factory.create_session() as session, session.begin():
        candidates = recheck_claimed_orphan_upload_files(session, tenant_id=tenant_id, files=candidates)
    for file in candidates:
        if file.key:
            _delete_object(file.key)
    with session_factory.create_session() as session, session.begin():
        delete_orphan_upload_files(session, tenant_id=tenant_id, files=candidates)


def _cleanup_pauses(tenant_id: str, app_id: str) -> None:
    run_ids = select(WorkflowRun.id).where(WorkflowRun.tenant_id == tenant_id, WorkflowRun.app_id == app_id)
    while True:
        with session_factory.create_session() as session:
            rows = session.execute(
                select(WorkflowPause.id, WorkflowPause.state_object_key)
                .where(WorkflowPause.workflow_run_id.in_(run_ids))
                .limit(_BATCH_SIZE)
            ).all()
        if not rows:
            return
        for _, key in rows:
            _delete_object(key)
        ids = [row.id for row in rows]
        with session_factory.create_session() as session, session.begin():
            session.execute(delete(WorkflowPauseReason).where(WorkflowPauseReason.pause_id.in_(ids)))
            session.execute(delete(WorkflowPause).where(WorkflowPause.id.in_(ids)))


def _cleanup_node_offloads(tenant_id: str, app_id: str) -> None:
    nested_execution_ids = select(WorkflowNodeExecutionModel.id).where(
        WorkflowNodeExecutionModel.workflow_tool_owned_by_app(tenant_id=tenant_id, app_id=app_id)
    )
    owned_offloads = and_(
        WorkflowNodeExecutionOffload.tenant_id == tenant_id,
        or_(
            WorkflowNodeExecutionOffload.app_id == app_id,
            and_(
                WorkflowNodeExecutionOffload.node_execution_id.is_not(None),
                WorkflowNodeExecutionOffload.node_execution_id.in_(nested_execution_ids),
            ),
        ),
    )
    while True:
        with session_factory.create_session() as session:
            owner_ids = tuple(
                session.scalars(
                    select(WorkflowNodeExecutionOffload.id)
                    .where(owned_offloads)
                    .order_by(WorkflowNodeExecutionOffload.id)
                    .limit(_BATCH_SIZE)
                ).all()
            )
        if not owner_ids:
            return
        with session_factory.create_session() as session, session.begin():
            claimed_files = detach_workflow_node_execution_offloads_and_claim_uploads(
                session,
                tenant_id=tenant_id,
                offload_ids=owner_ids,
            )
            # Legacy rows may contain a cross-tenant offload pointing at this
            # tenant's UploadFile. It is not a valid owner chain, but deleting
            # a still-referenced blob would leave that row dangling. The
            # UploadFile lock held by the detach helper makes this global
            # conservative check stable until commit.
            claimed_ids = tuple(file.id for file in claimed_files)
            if claimed_ids:
                globally_referenced_ids = set(
                    session.scalars(
                        select(WorkflowNodeExecutionOffload.file_id)
                        .where(WorkflowNodeExecutionOffload.file_id.in_(claimed_ids))
                        .with_for_update(nowait=True)
                    ).all()
                )
                if globally_referenced_ids:
                    session.execute(
                        update(UploadFile)
                        .where(
                            UploadFile.tenant_id == tenant_id,
                            UploadFile.id.in_(globally_referenced_ids),
                        )
                        .values(knowledge_cleanup_started_at=None)
                    )
                    claimed_files = tuple(file for file in claimed_files if file.id not in globally_referenced_ids)
        with session_factory.create_session() as session, session.begin():
            claimed_files = recheck_claimed_orphan_upload_files(
                session,
                tenant_id=tenant_id,
                files=claimed_files,
            )
        for file in claimed_files:
            if file.key is not None:
                _delete_object(file.key)
        with session_factory.create_session() as session, session.begin():
            delete_orphan_upload_files(session, tenant_id=tenant_id, files=claimed_files)


def _other_app_message_reference(file_column: InstrumentedAttribute[str], app_id: str) -> Exists:
    # Include orphan message references conservatively: their ownership cannot be
    # established, so they must not authorize destruction of the underlying file.
    return exists(
        select(MessageFile.id)
        .outerjoin(Message, Message.id == MessageFile.message_id)
        .where(MessageFile.upload_file_id == file_column, or_(Message.app_id != app_id, Message.id.is_(None)))
    )


def _cleanup_tool_files(tenant_id: str, app_id: str) -> None:
    # Conversation has no tenant column; its app owner plus ToolFile.tenant_id
    # together constrain the complete ownership chain.
    conversation_ids = select(Conversation.id).where(Conversation.app_id == app_id)
    # A file with no conversation can still be owned by an app end user. Account
    # files without a conversation are reusable workspace assets and are retained.
    end_user_ids = select(EndUser.id).where(EndUser.tenant_id == tenant_id, EndUser.app_id == app_id)
    last_file_id: str | None = None
    while True:
        with session_factory.create_session() as session:
            statement = (
                select(ToolFile.id, ToolFile.file_key)
                .where(
                    ToolFile.tenant_id == tenant_id,
                    or_(
                        ToolFile.conversation_id.in_(conversation_ids),
                        ToolFile.conversation_id.is_(None) & ToolFile.user_id.in_(end_user_ids),
                    ),
                    ~_other_app_message_reference(ToolFile.id, app_id),
                )
                .order_by(ToolFile.id)
                .limit(_BATCH_SIZE)
            )
            if last_file_id is not None:
                statement = statement.where(ToolFile.id > last_file_id)
            rows = session.execute(statement).all()
        if not rows:
            return
        last_file_id = rows[-1].id
        with session_factory.create_session() as session, session.begin():
            claimed_files = claim_orphan_agent_config_tool_files(
                session,
                tenant_id=tenant_id,
                files=tuple(AgentConfigToolFileCleanup(id=row.id, key=row.file_key) for row in rows),
                excluding_conversation_app_id=app_id,
            )
        with session_factory.create_session() as session, session.begin():
            claimed_files = recheck_claimed_agent_config_tool_files(
                session,
                tenant_id=tenant_id,
                files=claimed_files,
                excluding_conversation_app_id=app_id,
            )
        for file in claimed_files:
            _delete_object(file.key)
        with session_factory.create_session() as session, session.begin():
            delete_claimed_agent_config_tool_files(
                session,
                tenant_id=tenant_id,
                files=claimed_files,
                excluding_conversation_app_id=app_id,
            )


def _cleanup_end_user_uploads(tenant_id: str, app_id: str) -> None:
    end_user_ids = select(EndUser.id).where(EndUser.tenant_id == tenant_id, EndUser.app_id == app_id)
    last_file_id: str | None = None
    while True:
        with session_factory.create_session() as session:
            statement = (
                select(UploadFile.id, UploadFile.key)
                .where(
                    UploadFile.tenant_id == tenant_id,
                    UploadFile.created_by_role == CreatorUserRole.END_USER,
                    UploadFile.created_by.in_(end_user_ids),
                )
                .order_by(UploadFile.id)
                .limit(_BATCH_SIZE)
            )
            if last_file_id is not None:
                statement = statement.where(UploadFile.id > last_file_id)
            rows = session.execute(statement).all()
        if not rows:
            return
        last_file_id = rows[-1].id
        with session_factory.create_session() as session, session.begin():
            claimed_files = claim_orphan_upload_files(
                session,
                tenant_id=tenant_id,
                files=tuple(UploadFileCleanup(id=row.id, key=row.key) for row in rows),
                excluding_message_app_id=app_id,
            )
        with session_factory.create_session() as session, session.begin():
            claimed_files = recheck_claimed_orphan_upload_files(
                session,
                tenant_id=tenant_id,
                files=claimed_files,
                excluding_message_app_id=app_id,
            )
        for file in claimed_files:
            if file.key is not None:
                _delete_object(file.key)
        with session_factory.create_session() as session, session.begin():
            delete_orphan_upload_files(
                session,
                tenant_id=tenant_id,
                files=claimed_files,
                excluding_message_app_id=app_id,
            )


def _cleanup_traces(app_id: str) -> None:
    prefix = f"ops_trace/{app_id}/"
    try:
        keys = storage.scan(prefix)
    except FileNotFoundError:
        return
    for key in keys:
        if not key.startswith(prefix):
            raise ValueError(f"Trace storage listing returned a key outside application prefix: {key}")
        _delete_object(key)
