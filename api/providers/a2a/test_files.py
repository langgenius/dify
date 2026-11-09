"""Temporary Test uploads and bounded Paste-link retrieval with no Agent credentials."""

import time
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope
from extensions.ext_storage import storage
from machinery.context import RequestContext
from models.enums import CreatorUserRole
from services.external_agents.file_profile import FileLimits, file_byte_limit, normalize_media_type, validate_blob
from services.external_agents.io_contracts import ExternalIOError, FileBlob, FileWriteReservation
from services.file_service import FileService, FileUploadActor

from .gateway import checked_url
from .transport import BoundedTransport, TransportError


class ExternalTestFileUpload:
    def __init__(self, *, files: FileService, remote: BoundedTransport, limits: FileLimits) -> None:
        self._files, self._remote, self._limits = files, remote, limits

    def plan(self, context: RequestContext, blob: FileBlob) -> FileWriteReservation:
        file_id = str(uuid4())
        return FileWriteReservation(
            file_id=file_id,
            storage_key=FileService.reserved_upload_key(
                tenant_id=context.active_workspace_id, file_id=file_id, filename=blob.filename
            ),
        )

    def upload(self, context: RequestContext, blob: FileBlob, *, reserved_file_id: str) -> str:
        validate_blob(blob, self._limits)
        return self._files.upload_file_for_actor(
            actor=FileUploadActor(id=context.account_id, creator_role=CreatorUserRole.ACCOUNT),
            resource_tenant_id=context.active_workspace_id,
            filename=blob.filename,
            content=blob.data,
            mimetype=blob.media_type,
            source_url="",
            reserved_file_id=reserved_file_id,
        ).id

    def remove(self, plan: FileWriteReservation) -> None:
        self._files.delete_file(plan.file_id)
        storage.delete(plan.storage_key)

    def fetch(self, context: RequestContext, *, url: str, filename: str, media_type: str) -> FileBlob:
        media_type = normalize_media_type(media_type)
        bound = file_byte_limit(media_type, self._limits)
        parsed = urlsplit(url)
        checked_url(urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", "")))
        if parsed.fragment or "\r" in url or "\n" in url:
            raise ExternalIOError("invalid_file_url", "The remote file URL is invalid.")
        deadline = time.monotonic() + 30
        try:
            with bind_file_access_scope(
                FileAccessScope(
                    tenant_id=context.active_workspace_id,
                    user_id=context.account_id,
                    user_from=UserFrom.ACCOUNT,
                    invoke_from=InvokeFrom.DEBUGGER,
                )
            ):
                reply = self._remote.request(
                    "GET",
                    url,
                    headers={"Accept-Encoding": "identity"},
                    body=None,
                    timeout_seconds=deadline - time.monotonic(),
                    max_bytes=max(bound, 1),
                )
        except TransportError:
            raise ExternalIOError("file_fetch_failed", "File retrieval exceeded network or byte limits.") from None
        if reply.status != 200:
            raise ExternalIOError(
                "file_fetch_failed", "The remote file cannot be retrieved without redirects or credentials."
            )
        blob = FileBlob(filename=filename, media_type=media_type, data=reply.body)
        validate_blob(blob, self._limits)
        return blob
