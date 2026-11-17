"""Validate parsed Web execution files against their current persistent owner."""

from collections.abc import Mapping

import sqlalchemy as sa
from sqlalchemy.orm import Session

from core.workflow.file_reference import resolve_file_record_id
from graphon.file import File, FileTransferMethod
from models.enums import CreatorUserRole
from models.model import EndUser, UploadFile
from models.tools import ToolFile
from repositories.entities.web_execution import WebExecutionResourcesChangedError


def execution_file_references(value: object) -> tuple[frozenset[str], frozenset[str]]:
    uploads: set[str] = set()
    tools: set[str] = set()

    def collect(item: object) -> None:
        if isinstance(item, File):
            if item.reference:
                record_id = resolve_file_record_id(item.reference)
                if record_id:
                    (tools if item.transfer_method == FileTransferMethod.TOOL_FILE else uploads).add(record_id)
        elif isinstance(item, Mapping):
            for child in item.values():
                collect(child)
        elif isinstance(item, (list, tuple)):
            for child in item:
                collect(child)

    collect(value)
    return frozenset(uploads), frozenset(tools)


def require_execution_file_ownership(
    session: Session,
    *,
    tenant_id: str,
    app_id: str,
    user: EndUser,
    upload_ids: frozenset[str],
    tool_ids: frozenset[str],
    granted_upload_ids: frozenset[str] = frozenset(),
) -> None:
    """Validate current file access while the caller holds the identity fence.

    Granted uploads come only from trusted execution-local App defaults, never
    request-owned identifiers. They still require matching persistent tenant
    scope. An empty grant preserves strict original-user ownership validation.
    Missing or inaccessible files raise without mutation.
    """
    if (user.tenant_id, user.app_id) != (tenant_id, app_id):
        raise WebExecutionResourcesChangedError()
    visible_uploads: set[str] = set()
    visible_tools: set[str] = set()
    if upload_ids:
        visible_uploads = set(
            session.scalars(
                sa.select(UploadFile.id).where(
                    UploadFile.id.in_(upload_ids),
                    UploadFile.tenant_id == tenant_id,
                    sa.or_(
                        sa.and_(
                            UploadFile.created_by_role == CreatorUserRole.END_USER,
                            UploadFile.created_by == user.id,
                        ),
                        UploadFile.id.in_(granted_upload_ids),
                    ),
                )
            )
        )
    if tool_ids:
        visible_tools = set(
            session.scalars(
                sa.select(ToolFile.id).where(
                    ToolFile.id.in_(tool_ids),
                    ToolFile.tenant_id == tenant_id,
                    ToolFile.user_id == user.id,
                )
            )
        )
    if visible_uploads != upload_ids or visible_tools != tool_ids:
        raise WebExecutionResourcesChangedError()
