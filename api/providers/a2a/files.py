"""Authorized Dify file/storage bridges for the frozen BYOA byte profile.

Storage references are reconstructed from owned DB rows. Returned remote URLs
are fetched through remote_fetcher, never with the Agent Bearer credential.
Deletion/expiry is checked before and atomically at materialization binding.
"""

import base64
import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

import httpx
from sqlalchemy.orm import Session, sessionmaker

from services.external_agents.file_profile import (
    DEFAULT_FILE_LIMITS,
    FileLimits,
    file_byte_limit,
    normalize_media_type,
    validate_blob,
)
from services.external_agents.io_contracts import (
    ExternalIOError,
    FileBlob,
    FileLifecyclePort,
    FileReference,
    FileScope,
    JsonObject,
    StoredFile,
)

from .gateway import checked_url
from .transport import BoundedTransport, TransportError

if TYPE_CHECKING:
    from extensions.ext_storage import Storage
    from services.file_service import FileService

logger = logging.getLogger(__name__)


class RemoteFileRequester:
    def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        """Use the unified file owner; caller's explicit FileAccessScope crosses the I/O thread."""
        from core.file import remote_fetcher

        return remote_fetcher.make_request(method, url, **kwargs)  # type: ignore[arg-type]


def _access_scope(scope: FileScope):
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
    from core.app.file_access import FileAccessScope

    return FileAccessScope(
        tenant_id=scope.tenant_id,
        user_id=scope.actor_id,
        user_from=UserFrom.ACCOUNT if scope.actor_role == "account" else UserFrom.END_USER,
        invoke_from=InvokeFrom.DEBUGGER if scope.actor_role == "account" else InvokeFrom.WEB_APP,
        granted_upload_file_ids=scope.granted_upload_file_ids,
        granted_tool_file_ids=scope.granted_tool_file_ids,
    )


class DifyFileAdapter:
    def __init__(
        self,
        *,
        sessions: sessionmaker[Session],
        storage: "Storage",
        files: "FileService",
        lifecycle: FileLifecyclePort,
        remote_transport: BoundedTransport,
        limits: FileLimits = DEFAULT_FILE_LIMITS,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        """Receive owned DB/storage adapters and a mandatory deletion/idempotency gate."""
        self._sessions = sessions
        self._storage = storage
        self._files = files
        self._lifecycle = lifecycle
        self._remote = remote_transport
        self._limits = limits
        self._now = now or (lambda: datetime.now(UTC))

    def _remaining(self, scope: FileScope) -> float:
        remaining = 30.0
        if scope.io_deadline is not None:
            remaining = min(remaining, (scope.io_deadline - self._now()).total_seconds())
        if remaining <= 0:
            raise ExternalIOError("file_io_deadline_exceeded", "The file operation exceeded its admitted I/O deadline.")
        return remaining

    def read_authorized(self, scope: FileScope, reference: FileReference, *, max_bytes: int) -> FileBlob:
        """Read an admitted file under complete tenant/principal grants before storage I/O."""
        from core.app.file_access import DatabaseFileAccessController

        self._lifecycle.ensure_input_access(scope, reference)
        self._remaining(scope)
        access = DatabaseFileAccessController()
        record = None
        with self._sessions() as session:
            if reference.kind in ("upload", "datasource"):
                upload = access.get_upload_file(session=session, file_id=reference.file_id, scope=_access_scope(scope))
                if upload is not None:
                    record = (upload.key, upload.name, upload.mime_type or "", upload.size)
            if record is None and reference.kind in ("tool", "datasource"):
                tool = access.get_tool_file(session=session, file_id=reference.file_id, scope=_access_scope(scope))
                if tool is not None:
                    record = (tool.file_key, tool.name, tool.mimetype or "", tool.size)
        if record is None:
            raise ExternalIOError("file_not_available", "The referenced file is absent or not authorized.")
        key, name, media_type, size = record
        bound = min(max_bytes, file_byte_limit(media_type, self._limits))
        if size > bound:
            raise ExternalIOError("file_too_large", "The authorized file exceeds the effective byte limit.")
        chunks: list[bytes] = []
        received = 0
        for chunk in self._storage.load_stream(key):
            self._remaining(scope)
            received += len(chunk)
            if received > bound:
                raise ExternalIOError("file_too_large", "File storage exceeded the declared bounded size.")
            chunks.append(chunk)
            self._remaining(scope)
        self._lifecycle.ensure_input_access(scope, reference)
        self._remaining(scope)
        blob = FileBlob(filename=name, media_type=normalize_media_type(media_type), data=b"".join(chunks))
        validate_blob(blob, self._limits)
        return blob

    def materialize(
        self,
        scope: FileScope,
        part: JsonObject,
        *,
        artifact_id: str,
        part_index: int,
        max_bytes: int | None = None,
    ) -> StoredFile:
        """Boundedly decode/fetch then persist once per invocation/artifact/part.

        A revoked parent/test lease prevents future reads or rebinding. The
        repository gate supplies atomic uniqueness; a concurrent upload loser is
        deleted without touching shared originals or the existing winning file.
        """
        self._lifecycle.ensure_access(scope)
        self._remaining(scope)
        existing = self._lifecycle.find_stored(scope, artifact_id=artifact_id, part_index=part_index)
        if existing is not None:
            if max_bytes is not None and existing.size > max_bytes:
                raise ExternalIOError("file_total_too_large", "The stored file exceeds the remaining output budget.")
            return existing
        media_type = part.get("mediaType")
        filename = part.get("filename")
        if not isinstance(media_type, str) or not isinstance(filename, str):
            raise ExternalIOError("invalid_file_part", "File MIME type and filename are required for storage.")
        bound = file_byte_limit(media_type, self._limits)
        if max_bytes is not None:
            bound = min(bound, max_bytes)
        if bound < 0:
            raise ExternalIOError("file_total_too_large", "The output byte budget is exhausted.")
        raw = part.get("raw")
        url = part.get("url")
        if isinstance(raw, str) and url is None:
            if len(raw) > 4 * ((bound + 2) // 3):
                raise ExternalIOError("file_too_large", "The encoded file exceeds the effective byte limit.")
            try:
                data = base64.b64decode(raw, validate=True)
            except ValueError as error:
                raise ExternalIOError("invalid_file_part", "File bytes are not valid base64.") from error
        elif isinstance(url, str) and raw is None:
            data = self._fetch_file(scope, url, bound)
        else:
            raise ExternalIOError("invalid_file_part", "Exactly one raw file or file URL is required.")
        if len(data) > bound:
            raise ExternalIOError("file_too_large", "The output file exceeds the remaining byte limit.")
        blob = FileBlob(filename=filename, media_type=normalize_media_type(media_type), data=data)
        validate_blob(blob, self._limits)
        return self.store(scope, blob, artifact_id=artifact_id, part_index=part_index)

    def _fetch_file(self, scope: FileScope, url: str, bound: int) -> bytes:
        # File URLs may contain signed query parameters; grammar validation is
        # separate from Agent endpoint validation, and credentials never follow.
        from urllib.parse import urlsplit, urlunsplit

        from core.app.file_access import bind_file_access_scope

        parsed = urlsplit(url)
        checked_url(urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", "")))
        if parsed.fragment or "\r" in url or "\n" in url:
            raise ExternalIOError("invalid_file_url", "The remote file URL is invalid.")
        deadline = time.monotonic() + self._remaining(scope)
        headers = {"Accept-Encoding": "identity"}
        try:
            with bind_file_access_scope(_access_scope(scope)):
                head = self._remote.request(
                    "HEAD",
                    url,
                    headers=headers,
                    body=None,
                    timeout_seconds=self._remaining(scope),
                    max_bytes=max(1, bound),
                )
                if head.status in (401, 403):
                    raise ExternalIOError(
                        "file_access_denied", "The returned file is not accessible without additional credentials."
                    )
                if 300 <= head.status < 400:
                    raise ExternalIOError("file_redirect_rejected", "File redirects are not followed.")
                if head.status >= 400 and head.status not in (405, 501):
                    raise ExternalIOError("file_fetch_failed", "The returned file could not be read.")
                reply = self._remote.request(
                    "GET",
                    url,
                    headers=headers,
                    body=None,
                    timeout_seconds=deadline - time.monotonic(),
                    max_bytes=max(1, bound),
                )
        except TransportError as error:
            raise ExternalIOError(
                "file_fetch_failed", "Remote file retrieval exceeded safe network/byte bounds."
            ) from error
        if reply.status != 200:
            raise ExternalIOError("file_fetch_failed", "The returned file could not be safely retrieved.")
        if len(reply.body) > bound:
            raise ExternalIOError("file_too_large", "The returned file exceeds the output budget.")
        return reply.body

    def store(self, scope: FileScope, blob: FileBlob, *, artifact_id: str, part_index: int) -> StoredFile:
        """Persist an authorized result through FileService and atomic lifecycle binding."""
        from models.enums import CreatorUserRole
        from services.file_service import FileUploadActor

        self._lifecycle.ensure_access(scope)
        self._remaining(scope)
        existing = self._lifecycle.find_stored(scope, artifact_id=artifact_id, part_index=part_index)
        if existing is not None:
            return existing
        validate_blob(blob, self._limits)
        role = CreatorUserRole.ACCOUNT if scope.actor_role == "account" else CreatorUserRole.END_USER
        proposed_id = str(uuid4())
        key = self._files.reserved_upload_key(tenant_id=scope.tenant_id, file_id=proposed_id, filename=blob.filename)
        reservation = self._lifecycle.prepare_stored(
            scope,
            blob,
            artifact_id=artifact_id,
            part_index=part_index,
            file_id=proposed_id,
            storage_key=key,
        )
        if reservation.existing is not None:
            return reservation.existing
        expected_key = self._files.reserved_upload_key(
            tenant_id=scope.tenant_id, file_id=reservation.file_id, filename=blob.filename
        )
        if expected_key != reservation.storage_key:
            raise ExternalIOError("file_materialization_conflict", "The original file materialization differs.")
        try:
            uploaded = self._files.upload_file_for_actor(
                actor=FileUploadActor(id=scope.actor_id, creator_role=role),
                resource_tenant_id=scope.tenant_id,
                filename=blob.filename,
                content=blob.data,
                mimetype=blob.media_type,
                source_url="",
                reserved_file_id=reservation.file_id,
            )
            self._remaining(scope)
            file = StoredFile(
                file_id=uploaded.id,
                size=uploaded.size,
                media_type=uploaded.mime_type,
                value={
                    "dify_model_identity": "__dify__file__",
                    "id": uploaded.id,
                    "tenant_id": scope.tenant_id,
                    "type": "image" if blob.media_type.startswith("image/") else "document",
                    "transfer_method": "local_file",
                    "related_id": uploaded.id,
                    "upload_file_id": uploaded.id,
                    "filename": uploaded.name,
                    "extension": uploaded.extension,
                    "mime_type": uploaded.mime_type,
                    "size": uploaded.size,
                },
            )
            winner = self._lifecycle.record_stored(scope, artifact_id=artifact_id, part_index=part_index, file=file)
        except Exception as error:
            # Re-entry owns an older durable plan, not the right to delete a
            # concurrent writer's bytes. Keep it for the fenced TTL cleaner.
            if reservation.file_id == proposed_id:
                try:
                    committed = self._lifecycle.find_stored(scope, artifact_id=artifact_id, part_index=part_index)
                    if committed is None:
                        self._files.delete_file(reservation.file_id)
                        self._storage.delete(reservation.storage_key)
                        self._lifecycle.abort_stored(
                            scope,
                            artifact_id=artifact_id,
                            part_index=part_index,
                            file_id=reservation.file_id,
                        )
                except Exception:
                    # Failed cleanup must retain the pending cleanup intent.
                    logger.warning("External file compensation remains pending.")
            if isinstance(error, ExternalIOError):
                raise
            raise ExternalIOError("file_store_failed", "The returned file could not be durably stored.") from None
        if winner.file_id != file.file_id:
            self._files.delete_file(uploaded.id)
        return winner
