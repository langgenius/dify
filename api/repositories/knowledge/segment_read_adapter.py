"""Read adapter for authorized segment content and attachment preview values."""

import base64
import hashlib
import hmac
import os
import re
import time
from collections.abc import Sequence
from typing import Literal

from sqlalchemy.orm import Session

from configs import dify_config
from core.tools.signature import bind_file_uri, sign_tool_file_uri
from models.dataset import AttachmentItem, DocumentSegment
from models.model import UploadFile
from repositories.knowledge.dataset_read_repository import get_segment_attachment_files, get_segment_content_file_ids

# Consume the entire old query string and replace matches in source order.
_FILE_ID = r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"
_FILE_LINK = re.compile(
    rf"/files/(?:(?P<upload>{_FILE_ID})/(?P<preview>image-preview|file-preview)"
    rf"|tools/(?P<tool>{_FILE_ID})\.(?P<extension>[a-zA-Z0-9]+))"
    r"(?:\?[^\s)\"'<>]*)?"
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
    matches = list(_FILE_LINK.finditer(segment.content))
    if not matches:
        return segment.content
    upload_ids = {match["upload"].lower() for match in matches if match["upload"]}
    tool_ids = {match["tool"].lower() for match in matches if match["tool"]}
    allowed_uploads, allowed_tools = get_segment_content_file_ids(
        segment, upload_ids=upload_ids, tool_ids=tool_ids, session=session
    )

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

    return _FILE_LINK.sub(replace, segment.content)


def format_segment_attachments(files: Sequence[UploadFile]) -> list[AttachmentItem]:
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
