"""Remove application-owned storage before deleting the durable database references.

Uploads owned by accounts, subscription-wide trigger requests, tenant telemetry,
and manually named exports do not have exclusive application ownership. They are
deliberately retained rather than deleting another resource's data.
"""

import logging

from sqlalchemy import delete, exists, or_, select
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql.selectable import Exists

from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from models import Conversation, EndUser, Message, MessageFile, UploadFile
from models.enums import CreatorUserRole
from models.human_input import HumanInputFormUploadFile
from models.tools import ToolFile
from models.workflow import (
    Workflow,
    WorkflowDraftVariableFile,
    WorkflowNodeExecutionOffload,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
)

logger = logging.getLogger(__name__)
_BATCH_SIZE = 500


def _delete_object(key: str) -> None:
    """Allow redelivery after a storage delete succeeded but the DB commit failed."""
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
    failure propagates to the app deletion task so its existing retry can still
    resolve the keys. Each successful batch removes its references atomically.
    """
    # The App row is already deleted by the caller. Validate trace ownership
    # against remaining tenant-scoped resources before removing those resources.
    with session_factory.create_session() as session:
        owns_traces = any(
            session.scalar(select(exists().where(model.tenant_id == tenant_id, model.app_id == app_id)))
            for model in (Workflow, WorkflowRun, EndUser)
        )
    _cleanup_pauses(tenant_id, app_id)
    _cleanup_node_offloads(tenant_id, app_id)
    _cleanup_tool_files(tenant_id, app_id)
    _cleanup_end_user_uploads(tenant_id, app_id)
    if owns_traces:
        _cleanup_traces(app_id)


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
    while True:
        with session_factory.create_session() as session:
            rows = session.execute(
                select(WorkflowNodeExecutionOffload.id, WorkflowNodeExecutionOffload.file_id, UploadFile.key)
                .outerjoin(
                    UploadFile,
                    (UploadFile.id == WorkflowNodeExecutionOffload.file_id) & (UploadFile.tenant_id == tenant_id),
                )
                .where(
                    WorkflowNodeExecutionOffload.tenant_id == tenant_id,
                    WorkflowNodeExecutionOffload.app_id == app_id,
                )
                .limit(_BATCH_SIZE)
            ).all()
            file_ids = [row.file_id for row in rows]
            shared = set(
                session.scalars(
                    select(WorkflowNodeExecutionOffload.file_id).where(
                        WorkflowNodeExecutionOffload.file_id.in_(file_ids),
                        or_(
                            WorkflowNodeExecutionOffload.tenant_id != tenant_id,
                            WorkflowNodeExecutionOffload.app_id != app_id,
                        ),
                    )
                )
            )
        if not rows:
            return
        for row in rows:
            if row.key is not None and row.file_id not in shared:
                _delete_object(row.key)
        with session_factory.create_session() as session, session.begin():
            session.execute(
                delete(WorkflowNodeExecutionOffload).where(
                    WorkflowNodeExecutionOffload.id.in_([row.id for row in rows]),
                    WorkflowNodeExecutionOffload.tenant_id == tenant_id,
                    WorkflowNodeExecutionOffload.app_id == app_id,
                )
            )
            session.execute(
                delete(UploadFile).where(
                    UploadFile.tenant_id == tenant_id,
                    UploadFile.id.in_(
                        [row.file_id for row in rows if row.key is not None and row.file_id not in shared]
                    ),
                )
            )


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
    while True:
        with session_factory.create_session() as session:
            rows = session.execute(
                select(ToolFile.id, ToolFile.file_key)
                .where(
                    ToolFile.tenant_id == tenant_id,
                    or_(
                        ToolFile.conversation_id.in_(conversation_ids),
                        ToolFile.conversation_id.is_(None) & ToolFile.user_id.in_(end_user_ids),
                    ),
                    ~_other_app_message_reference(ToolFile.id, app_id),
                )
                .limit(_BATCH_SIZE)
            ).all()
        if not rows:
            return
        for _, key in rows:
            _delete_object(key)
        with session_factory.create_session() as session, session.begin():
            session.execute(
                delete(ToolFile).where(ToolFile.tenant_id == tenant_id, ToolFile.id.in_([r.id for r in rows]))
            )


def _cleanup_end_user_uploads(tenant_id: str, app_id: str) -> None:
    end_user_ids = select(EndUser.id).where(EndUser.tenant_id == tenant_id, EndUser.app_id == app_id)
    while True:
        with session_factory.create_session() as session:
            rows = session.execute(
                select(UploadFile.id, UploadFile.key)
                .where(
                    UploadFile.tenant_id == tenant_id,
                    UploadFile.created_by_role == CreatorUserRole.END_USER,
                    UploadFile.created_by.in_(end_user_ids),
                    ~_other_app_message_reference(UploadFile.id, app_id),
                    ~exists().where(WorkflowNodeExecutionOffload.file_id == UploadFile.id),
                    ~exists().where(WorkflowDraftVariableFile.upload_file_id == UploadFile.id),
                    ~exists().where(HumanInputFormUploadFile.upload_file_id == UploadFile.id),
                )
                .limit(_BATCH_SIZE)
            ).all()
        if not rows:
            return
        for _, key in rows:
            _delete_object(key)
        with session_factory.create_session() as session, session.begin():
            session.execute(
                delete(UploadFile).where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_([row.id for row in rows]))
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
