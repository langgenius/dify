"""Temporary Test uploads and bounded Paste-link retrieval with no Agent credentials."""

import time
from email.message import Message
from urllib.parse import unquote, urlsplit, urlunsplit
from uuid import uuid4

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope
from extensions.ext_storage import storage
from machinery.context import RequestContext
from models.enums import CreatorUserRole
from services.external_agents.file_profile import (
    FILE_MODES,
    FileLimits,
    file_byte_limit,
    normalize_media_type,
    validate_blob,
)
from services.external_agents.io_contracts import ExternalIOError, FileBlob, FileWriteReservation
from services.file_service import FileService, FileUploadActor

from .gateway import checked_url
from .transport import BoundedTransport, TransportError

_EXTENSIONS = {
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/markdown": "md",
    "image/png": "png",
    "image/jpeg": "jpg",
}


def _guessed_media_type(data: bytes, content_type: str, filename: str | None) -> str:
    """Infer only the supported finite profile, never arbitrary HTML/executable types.

    Strong supported signatures or an explicit supported response MIME win.
    Missing/generic response MIME may use a UTF-8 plain/Markdown fallback;
    undecodable binary and NUL/control bytes fail closed. Supported text may
    contain markup; this adapter does not add a text-content policy.
    """
    declared = normalize_media_type(content_type)
    magic = next(
        (
            media
            for prefix, media in (
                (b"%PDF-", "application/pdf"),
                (b"\x89PNG\r\n\x1a\n", "image/png"),
                (b"\xff\xd8\xff", "image/jpeg"),
            )
            if data.startswith(prefix)
        ),
        None,
    )
    if magic is not None:
        if declared in FILE_MODES and declared != magic:
            raise ExternalIOError("unsupported_file_type", "The URL response format does not match its content.")
        return magic
    if declared in {"application/pdf", "image/png", "image/jpeg"}:
        raise ExternalIOError("unsupported_file_type", "The URL response format does not match its content.")
    if declared not in {"", "application/octet-stream", "binary/octet-stream", "text/plain", "text/markdown"}:
        raise ExternalIOError("unsupported_file_type", "The URL does not declare a supported file format.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ExternalIOError("unsupported_file_type", "The URL file format cannot be safely inferred.") from error
    if any((ord(char) < 32 and char not in "\t\r\n") or 127 <= ord(char) < 160 for char in text):
        raise ExternalIOError("unsupported_file_type", "The URL file format cannot be safely inferred.")
    return (
        declared
        if declared in {"text/plain", "text/markdown"}
        else ("text/markdown" if filename and filename.lower().endswith((".md", ".markdown")) else "text/plain")
    )


def _inferred_filename(disposition: str, url: str, media_type: str) -> str:
    """Produce a safe bounded local basename; URL query credentials never become a name."""
    message = Message()
    if len(disposition) <= 4096:
        message["Content-Disposition"] = disposition
    suggested = message.get_filename() or unquote(urlsplit(url).path.rsplit("/", 1)[-1])
    name = suggested.replace("\\", "/").rsplit("/", 1)[-1].strip()
    extension = _EXTENSIONS[media_type]
    suffixes = {"jpg", "jpeg"} if media_type == "image/jpeg" else {extension}
    if not name or name in {".", ".."} or any(ord(char) < 32 or ord(char) == 127 for char in name):
        name = "download"
    stem, dot, existing = name.rpartition(".")
    if not dot or existing.lower() not in suffixes:
        name = (stem if dot and stem else name) + "." + extension
    if len(name) > 255:
        name = name[: 254 - len(extension)] + "." + extension
    return name


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

    def fetch(self, context: RequestContext, *, url: str, filename: str | None, media_type: str | None) -> FileBlob:
        """Fetch once under the existing SSRF/TLS policy, inferring optional safe metadata.

        Explicit overrides retain their supported-profile behavior. URL-only
        requests use bounded headers/content and never follow redirects, send
        credentials, create a second probe request or widen byte/type limits.
        """
        declared = normalize_media_type(media_type) if media_type is not None else None
        bound = (
            file_byte_limit(declared, self._limits)
            if declared is not None
            else min(max(self._limits.max_document_bytes, self._limits.max_image_bytes), self._limits.max_total_bytes)
        )
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
        disposition = Message()
        raw_disposition = reply.headers.get("content-disposition", "")
        if len(raw_disposition) <= 4096:
            disposition["Content-Disposition"] = raw_disposition
        name_hint = filename or disposition.get_filename() or unquote(parsed.path.rsplit("/", 1)[-1])
        resolved_media = declared or _guessed_media_type(reply.body, reply.headers.get("content-type", ""), name_hint)
        resolved_name = filename or _inferred_filename(
            reply.headers.get("content-disposition", ""), url, resolved_media
        )
        blob = FileBlob(filename=resolved_name, media_type=resolved_media, data=reply.body)
        validate_blob(blob, self._limits)
        return blob
