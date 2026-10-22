"""Read adapter for authorized segment content and attachment preview values."""

import base64
import hashlib
import hmac
import os
import re
import time
from collections.abc import Sequence
from typing import Literal, Protocol

from sqlalchemy.orm import Session

from configs import dify_config
from core.tools.signature import bind_file_uri, sign_tool_file_uri
from models.dataset import AttachmentItem, DocumentSegment
from models.model import UploadFile
from repositories.knowledge.dataset_read_repository import (
    SEGMENT_FILE_LINK,
    get_content_file_ids,
    get_segment_attachment_files,
    segment_content_file_ids,
)


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
        segment.tenant_id, upload_ids=upload_ids, tool_ids=tool_ids, session=session
    )
    return sign_segment_text(segment.content, allowed_uploads=allowed_uploads, allowed_tools=allowed_tools)


def sign_segment_text(
    content: str, *, allowed_uploads: set[str] | frozenset[str], allowed_tools: set[str] | frozenset[str]
) -> str:
    """Sign persisted, authorized file IDs after the read session has closed."""

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

    return SEGMENT_FILE_LINK.sub(replace, content)


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
    def mime_type(self) -> str: ...


def format_segment_attachments(files: Sequence[UploadFile | AttachmentFile]) -> list[AttachmentItem]:
    base_url = dify_config.FILES_URL or dify_config.CONSOLE_API_URL or ""
    return [
        {
            "id": file.id,
            "name": file.name,
            "size": file.size,
            "extension": file.extension,
            "mime_type": file.mime_type,
            "source_url": bind_file_uri(_sign_upload_file_uri(file.id, preview_kind="image"), base_url),
        }
        for file in files
    ]


def get_segment_attachments(segment: DocumentSegment, *, session: Session) -> list[AttachmentItem]:
    return format_segment_attachments(get_segment_attachment_files(segment, session=session))
