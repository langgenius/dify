"""Read adapter for authorized segment content and attachment preview values."""

import base64
import hashlib
import hmac
import os
import re
import time
from collections.abc import Sequence
from typing import Literal, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.tools.signature import bind_file_uri, sign_tool_file_uri
from models.dataset import AttachmentItem, DocumentSegment
from models.model import UploadFile
from models.tools import ToolFile
from repositories.knowledge.segment_query_repository import get_segment_attachment_files

# Consume the entire old query string and replace matches in source order.
_FILE_ID = r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"
_FILE_LINK = re.compile(
    rf"/files/(?:(?P<upload>{_FILE_ID})/(?P<preview>image-preview|file-preview)"
    rf"|tools/(?P<tool>{_FILE_ID})\.(?P<extension>[a-zA-Z0-9]+))"
    r"(?:\?[^\s)\"'<>]*)?"
)


def segment_content_file_ids(content: str) -> tuple[set[str], set[str]]:
    """Return normalized upload and tool IDs referenced by persisted segment content."""

    matches = list(_FILE_LINK.finditer(content))
    return (
        {match["upload"].lower() for match in matches if match["upload"]},
        {match["tool"].lower() for match in matches if match["tool"]},
    )


def get_content_file_ids(
    tenant_id: str,
    *,
    upload_ids: set[str],
    tool_ids: set[str],
    session: Session,
) -> tuple[set[str], set[str]]:
    """Validate one batch of content references against tenant and execution scope."""

    access = DatabaseFileAccessController()
    uploads = (
        session.scalars(
            access.apply_upload_file_filters(
                select(UploadFile).where(UploadFile.id.in_(upload_ids), UploadFile.tenant_id == tenant_id)
            )
        ).all()
        if upload_ids
        else ()
    )
    tools = (
        session.scalars(
            access.apply_tool_file_filters(
                select(ToolFile).where(ToolFile.id.in_(tool_ids), ToolFile.tenant_id == tenant_id)
            )
        ).all()
        if tool_ids
        else ()
    )
    return {file.id for file in uploads}, {file.id for file in tools}


def _sign_upload_file_uri(upload_file_id: str, *, preview_kind: Literal["image", "file"] = "file") -> str:
    """Sign an upload ID whose ownership was checked by this read adapter."""
    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    payload = f"{preview_kind}-preview|{upload_file_id}|{timestamp}|{nonce}"
    signature = hmac.new(dify_config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest()
    encoded_sign = base64.urlsafe_b64encode(signature).decode()
    return f"/files/{upload_file_id}/{preview_kind}-preview?timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"


def sign_segment_content(segment: DocumentSegment, *, session: Session) -> str:
    """Refresh links only after checking persisted file ownership.

    The segment must come from an authorized knowledge read. File queries also
    enforce its tenant and the current execution's file-access scope. Inaccessible
    references lose their old signature and never receive a new one.
    """
    upload_ids, tool_ids = segment_content_file_ids(segment.content)
    if not (upload_ids or tool_ids):
        return segment.content
    allowed_uploads, allowed_tools = get_content_file_ids(
        segment.tenant_id,
        upload_ids=upload_ids,
        tool_ids=tool_ids,
        session=session,
    )
    return sign_segment_text(segment.content, allowed_uploads=allowed_uploads, allowed_tools=allowed_tools)


def sign_segment_text(
    content: str,
    *,
    allowed_uploads: set[str] | frozenset[str],
    allowed_tools: set[str] | frozenset[str],
) -> str:
    """Sign persisted, authorized file IDs after the repository read session closes."""

    def replace(match: re.Match[str]) -> str:
        if upload_id := match["upload"]:
            upload_id = upload_id.lower()
            if upload_id not in allowed_uploads:
                return match.group().split("?", 1)[0]
            return _sign_upload_file_uri(
                upload_id, preview_kind="image" if match["preview"] == "image-preview" else "file"
            )
        tool_id = match["tool"].lower()
        if tool_id not in allowed_tools:
            return match.group().split("?", 1)[0]
        return sign_tool_file_uri(tool_id, "." + match["extension"])

    return _FILE_LINK.sub(replace, content)


class AttachmentFile(Protocol):
    @property
    def id(self) -> str: ...

    @property
    def name(self) -> str: ...

    @property
    def size(self) -> int: ...

    @property
    def extension(self) -> str: ...

    @property
    def mime_type(self) -> str | None: ...


def format_segment_attachments(files: Sequence[UploadFile | AttachmentFile]) -> list[AttachmentItem]:
    base_url = dify_config.FILES_URL or dify_config.CONSOLE_API_URL or ""
    return [
        {
            "id": file.id,
            "name": file.name,
            "size": file.size,
            "extension": file.extension,
            "mime_type": file.mime_type or "application/octet-stream",
            "source_url": bind_file_uri(_sign_upload_file_uri(file.id, preview_kind="image"), base_url),
        }
        for file in files
    ]


def get_segment_attachments(segment: DocumentSegment, *, session: Session) -> list[AttachmentItem]:
    return format_segment_attachments(get_segment_attachment_files(segment, session=session))
