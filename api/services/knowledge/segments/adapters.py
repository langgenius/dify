"""Infrastructure adapters for dataset segment use cases."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
from collections.abc import Callable, Sequence
from typing import Any, Literal, Protocol

from configs import dify_config
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from core.tools.signature import bind_file_uri, sign_tool_file_uri
from graphon.model_runtime.entities.model_entities import ModelType
from models.dataset import AttachmentItem, DocumentSegment
from models.model import UploadFile
from repositories.knowledge.segment_query_repository import SEGMENT_FILE_LINK, segment_content_file_ids
from services.knowledge.entities.segments import SegmentAttachmentFile, SegmentReadSnapshot, SegmentRecord
from services.knowledge.indexing.locks import KnowledgeIndexingLock
from services.knowledge.segments.application import SegmentModelProviderError
from services.knowledge.segments.contracts import SegmentDatasetRecord

_BATCH_WAITING_TTL_SECONDS = 86_400


def _sign_upload_file_uri(upload_file_id: str, *, preview_kind: Literal["image", "file"] = "file") -> str:
    """Sign an upload ID whose ownership was checked by the query owner."""

    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    payload = f"{preview_kind}-preview|{upload_file_id}|{timestamp}|{nonce}"
    signature = hmac.new(dify_config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest()
    encoded_sign = base64.urlsafe_b64encode(signature).decode()
    return f"/files/{upload_file_id}/{preview_kind}-preview?timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"


def sign_segment_text(
    content: str,
    *,
    allowed_uploads: set[str] | frozenset[str],
    allowed_tools: set[str] | frozenset[str],
) -> str:
    """Sign persisted file links after the query owner authorizes their IDs."""

    def replace(match: re.Match[str]) -> str:
        if upload_id := match["upload"]:
            upload_id = upload_id.lower()
            if upload_id not in allowed_uploads:
                return match.group().split("?", 1)[0]
            return _sign_upload_file_uri(
                upload_id,
                preview_kind="image" if match["preview"] == "image-preview" else "file",
            )
        tool_id = match["tool"].lower()
        if tool_id not in allowed_tools:
            return match.group().split("?", 1)[0]
        return sign_tool_file_uri(tool_id, "." + match["extension"])

    return SEGMENT_FILE_LINK.sub(replace, content)


def sign_segment_content(
    segment: DocumentSegment,
    *,
    allowed_upload_file_ids: set[str] | frozenset[str],
    allowed_tool_file_ids: set[str] | frozenset[str],
) -> str:
    upload_ids, tool_ids = segment_content_file_ids(segment.content)
    if not (upload_ids or tool_ids):
        return segment.content
    return sign_segment_text(
        segment.content,
        allowed_uploads=upload_ids & set(allowed_upload_file_ids),
        allowed_tools=tool_ids & set(allowed_tool_file_ids),
    )


def format_segment_attachments(files: Sequence[UploadFile | SegmentAttachmentFile]) -> list[AttachmentItem]:
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


class RedisSegmentClient(Protocol):
    def get(self, name: str | bytes) -> Any: ...

    def set(self, name: str | bytes, value: Any, *, nx: bool = False, ex: int | None = None) -> Any: ...
    def setex(self, name: str, time: int, value: Any) -> Any: ...
    def lock(self, name: str, timeout: int) -> Any: ...


class SegmentPresentationAdapter:
    def present(self, snapshots: Sequence[SegmentReadSnapshot]) -> tuple[SegmentRecord, ...]:
        records = []
        for snapshot in snapshots:
            records.append(
                SegmentRecord.model_validate(
                    {
                        **snapshot.values,
                        "sign_content": sign_segment_text(
                            str(snapshot.values["content"]),
                            allowed_uploads=snapshot.file_access.uploads,
                            allowed_tools=snapshot.file_access.tools,
                        ),
                        "child_chunks": snapshot.child_chunks,
                        "attachments": format_segment_attachments(snapshot.attachments),
                        "summary": snapshot.summary,
                    }
                )
            )
        return tuple(records)


class ModelManagerSegmentGuard:
    def check(self, dataset: SegmentDatasetRecord) -> None:
        try:
            ModelManager.for_tenant(tenant_id=dataset.workspace_id).get_model_instance(
                tenant_id=dataset.workspace_id,
                provider=dataset.embedding_model_provider or "",
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset.embedding_model or "",
            )
        except LLMBadRequestError as error:
            raise SegmentModelProviderError(kind="bad_request", description=str(error)) from error
        except ProviderTokenNotInitError as error:
            raise SegmentModelProviderError(kind="token", description=error.description) from error


class RedisSegmentIndexingState:
    def __init__(self, redis: RedisSegmentClient, *, locks: KnowledgeIndexingLock) -> None:
        self._redis = redis
        self._locks = locks

    def lock(self, name: str, *, timeout: int):
        return self._locks.hold(name, timeout=timeout, blocking_timeout=timeout)

    def is_segment_indexing(self, segment_id: str, *, deleting: bool = False) -> bool:
        suffix = "delete_indexing" if deleting else "indexing"
        return self._redis.get(f"segment_{segment_id}_{suffix}") is not None

    def mark_segment_indexing(self, segment_id: str, *, deleting: bool = False) -> None:
        suffix = "delete_indexing" if deleting else "indexing"
        self._redis.setex(f"segment_{segment_id}_{suffix}", 600, 1)

    def is_document_indexing(self, document_id: str) -> bool:
        return self._redis.get(f"document_{document_id}_indexing") is not None

    def set_batch_waiting(self, job_id: str) -> None:
        self._redis.set(
            f"segment_batch_import_{job_id}",
            "waiting",
            nx=True,
            ex=_BATCH_WAITING_TTL_SECONDS,
        )

    def get_batch_status(self, job_id: str) -> str | None:
        value = self._redis.get(f"segment_batch_import_{job_id}")
        if value is None:
            return None
        return value.decode() if isinstance(value, bytes) else value


class CelerySegmentBatchImportDispatcher:
    def __init__(self, *, delay: Callable[..., object]) -> None:
        self._delay = delay

    def dispatch(
        self,
        *,
        job_id: str,
        upload_file_id: str,
        dataset_id: str,
        document_id: str,
        workspace_id: str,
        actor_id: str,
    ) -> None:
        self._delay(job_id, upload_file_id, dataset_id, document_id, workspace_id, actor_id)
