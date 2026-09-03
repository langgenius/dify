"""File endpoints reached with an AppDeploy file grant.

Upload, remote-upload, produce, and resolve authenticate with a Bearer grant;
content authenticates with a per-file token in the query string, because an
``<img src>`` cannot carry a header.

They stay on the public ``files`` blueprint rather than moving under
``inner_api``, whose contract is a fully trusted caller holding the master key.
None of the five meets it: ``content`` is a browser-facing surface, ``upload``
carries an end user's payload, and ``produced`` and ``resolve`` are called by
workers executing third-party plugin code. The one genuinely server-to-server
step, minting the grant, already lives in ``inner_api``.
"""

from __future__ import annotations

from typing import IO
from urllib.parse import quote
from uuid import UUID

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field, HttpUrl, ValidationError
from werkzeug.datastructures import FileStorage

import services
from controllers.common.errors import (
    BlockedFileExtensionError,
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    RemoteFileUploadError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.files import files_ns
from controllers.files.wraps import FileGrantInvalidError, GrantedFileNotFoundError, file_grant_required
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.file_fields import FileResponse
from fields.file_grant_fields import ResolvedFileResponse
from libs.exception import BaseHTTPException
from libs.helper import dump_response
from services.entities.file_grant_entities import (
    FileContent,
    FileGrantClaims,
    FileGrantContext,
    FileGrantScope,
    FileKind,
    FileRef,
    StoredUpload,
)
from services.errors.file_grant import (
    EndUserNotFoundError,
    InvalidFileGrantError,
    RemoteFileUnavailableError,
    TooManyFileRefsError,
)
from services.file_grant_service import MAX_FILE_GRANT_REFS

# Everything outside this whitelist is served as an attachment. Produced files
# carry a plugin-declared MIME type, so SVG and the rest of the XML family must
# never render in the viewer's origin.
INLINE_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})


class InvalidFileRequestError(BaseHTTPException):
    error_code = "invalid_request"
    description = "The file request is malformed."
    code = 400


class FileRefPayload(BaseModel):
    id: str
    kind: FileKind


class RemoteFileUploadPayload(BaseModel):
    url: HttpUrl = Field(description="Remote file URL to fetch and store")


class FileResolvePayload(BaseModel):
    files: list[FileRefPayload] = Field(default_factory=list, max_length=MAX_FILE_GRANT_REFS)


class FileContentQuery(BaseModel):
    token: str = Field(description="Signed content token scoped to this file")


class RemoteFileUploadResponse(FileResponse):
    """Dify's upload shape plus the ``url`` key its remote-upload clients read.

    Dify has no service-api remote upload for this endpoint to stand in for, and
    the web and console one it does have answers under ``url``. Carrying both
    names lets a client of either move over untouched; they hold one URL.
    """

    url: str


class ProducedFileResponse(ResponseModel):
    id: str
    name: str
    size: int
    mime_type: str | None = None
    url: str
    internal_url: str


class FileResolveResponse(ResponseModel):
    files: list[ResolvedFileResponse]


register_schema_models(files_ns, RemoteFileUploadPayload, FileResolvePayload)
register_response_schema_models(
    files_ns, FileResponse, RemoteFileUploadResponse, ProducedFileResponse, FileResolveResponse
)


@files_ns.route("/appdeploy/upload")
class GrantedFileUploadApi(Resource):
    """Store one uploaded file against the grant's end user."""

    @file_grant_required(FileGrantScope.UPLOAD)
    @files_ns.doc("grant_upload_file")
    @files_ns.doc(
        responses={
            201: "File uploaded",
            400: "No file uploaded, the file has no name, or its extension is blocked",
            401: "Invalid grant",
            403: "Grant lacks the upload scope",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @files_ns.response(201, "File uploaded", files_ns.models[FileResponse.__name__])
    def post(self, grant: FileGrantClaims):
        upload = _single_upload()
        upload_file = _store_upload(
            grant,
            filename=upload.filename or "",
            stream=upload.stream,
            mimetype=upload.mimetype,
        )
        return _granted_file_response(upload_file), 201


@files_ns.route("/appdeploy/remote-upload")
class GrantedRemoteFileUploadApi(Resource):
    """Fetch a remote URL through the SSRF-safe fetcher and store it."""

    @file_grant_required(FileGrantScope.UPLOAD)
    @files_ns.doc("grant_upload_remote_file")
    @files_ns.expect(files_ns.models[RemoteFileUploadPayload.__name__])
    @files_ns.doc(
        responses={
            201: "Remote file uploaded",
            400: "Invalid URL, unfetchable remote file, or a blocked extension",
            401: "Invalid grant",
            403: "Grant lacks the upload scope",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @files_ns.response(201, "Remote file uploaded", files_ns.models[RemoteFileUploadResponse.__name__])
    def post(self, grant: FileGrantClaims):
        try:
            payload = RemoteFileUploadPayload.model_validate(files_ns.payload or {})
        except ValidationError as exc:
            raise InvalidFileRequestError(str(exc)) from exc

        try:
            upload_file = application_services().file_grants.store_remote_upload(
                context=_grant_context(grant),
                url=str(payload.url),
            )
        except RemoteFileUnavailableError as exc:
            raise RemoteFileUploadError(f"Failed to fetch file from {payload.url}") from exc
        except EndUserNotFoundError as exc:
            raise GrantedFileNotFoundError() from exc
        except services.errors.file.FileTooLargeError as exc:
            raise FileTooLargeError(exc.description) from exc
        except services.errors.file.BlockedFileExtensionError as exc:
            raise BlockedFileExtensionError(exc.description) from exc
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()
        return _remote_granted_file_response(upload_file), 201


@files_ns.route("/appdeploy/produced")
class ProducedFileApi(Resource):
    """Store one file produced by a running workflow node."""

    @file_grant_required(FileGrantScope.PRODUCE)
    @files_ns.doc("grant_upload_produced_file")
    @files_ns.doc(
        responses={
            201: "Produced file stored",
            400: "No file uploaded",
            401: "Invalid grant",
            403: "Grant lacks the produce scope",
            413: "File too large",
        }
    )
    @files_ns.response(201, "Produced file stored", files_ns.models[ProducedFileResponse.__name__])
    def post(self, grant: FileGrantClaims):
        upload = _single_upload()
        try:
            tool_file, access = application_services().file_grants.store_produced(
                context=_grant_context(grant),
                filename=upload.filename,
                stream=upload.stream,
                mimetype=upload.mimetype,
            )
        except services.errors.file.FileTooLargeError as exc:
            raise FileTooLargeError(exc.description)
        except EndUserNotFoundError as exc:
            raise GrantedFileNotFoundError() from exc

        return ProducedFileResponse(
            id=tool_file.id,
            name=tool_file.name,
            size=tool_file.size,
            mime_type=tool_file.mime_type,
            url=access.external_url,
            internal_url=access.internal_url,
        ).model_dump(mode="json"), 201


@files_ns.route("/appdeploy/resolve")
class GrantedFileResolveApi(Resource):
    """Re-check ownership and sign fresh URLs at the moment of use."""

    @file_grant_required(FileGrantScope.RESOLVE)
    @files_ns.doc("grant_resolve_files")
    @files_ns.expect(files_ns.models[FileResolvePayload.__name__])
    @files_ns.doc(
        responses={
            200: "Files resolved",
            400: "Malformed request",
            401: "Invalid grant",
            403: "Grant lacks the resolve scope",
        }
    )
    @files_ns.response(200, "Files resolved", files_ns.models[FileResolveResponse.__name__])
    def post(self, grant: FileGrantClaims):
        try:
            payload = FileResolvePayload.model_validate(files_ns.payload or {})
        except ValidationError as exc:
            raise InvalidFileRequestError(str(exc)) from exc

        refs = [FileRef(id=ref.id, kind=ref.kind) for ref in payload.files]
        try:
            resolved = application_services().file_grants.resolve_file_access(
                context=_grant_context(grant),
                refs=refs,
            )
        except EndUserNotFoundError as exc:
            raise GrantedFileNotFoundError() from exc
        except TooManyFileRefsError as exc:
            raise InvalidFileRequestError(str(exc)) from exc

        return FileResolveResponse(
            files=[ResolvedFileResponse.from_resolved(ref.id, file) for ref, file in zip(refs, resolved, strict=True)]
        ).model_dump(mode="json")


@files_ns.route("/appdeploy/<uuid:file_id>/content")
class GrantedFileContentApi(Resource):
    """Stream one file's bytes to a holder of its content token."""

    @files_ns.doc("grant_file_content")
    @files_ns.doc(params=query_params_from_model(FileContentQuery))
    @files_ns.doc(
        responses={
            200: "File stream returned",
            401: "Invalid or expired content token",
            404: "File not found",
        }
    )
    def get(self, file_id: UUID):
        try:
            query = FileContentQuery.model_validate(request.args.to_dict(flat=True))
        except ValidationError as exc:
            raise FileGrantInvalidError() from exc

        try:
            content = application_services().file_grants.load_content(
                token=query.token,
                requested_file_id=str(file_id),
            )
        except InvalidFileGrantError as exc:
            raise FileGrantInvalidError() from exc
        if content is None:
            raise GrantedFileNotFoundError()

        return _content_response(content)


def _content_response(content: FileContent) -> Response:
    mime_type = _normalized_mime_type(content.mime_type)
    inline = mime_type in INLINE_MIME_TYPES

    response = Response(
        content.stream,
        mimetype=mime_type if inline else "application/octet-stream",
        direct_passthrough=True,
        headers={},
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    if not inline:
        encoded_filename = quote(content.name or "")
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"
        response.headers["Content-Type"] = "application/octet-stream"
    # The sibling preview endpoints advertise `Accept-Ranges` for audio and video.
    # Every such type downloads here, so the hint could only ever ride on a
    # response no player will seek.
    if content.size > 0:
        response.headers["Content-Length"] = str(content.size)
    return response


def _normalized_mime_type(mime_type: str | None) -> str:
    return mime_type.split(";", 1)[0].strip().lower() if mime_type else ""


def _single_upload() -> FileStorage:
    if "file" not in request.files:
        raise NoFileUploadedError()
    if len(request.files) > 1:
        raise TooManyFilesError()

    upload = request.files["file"]
    if not upload.filename:
        raise FilenameNotExistsError()
    return upload


def _store_upload(
    grant: FileGrantClaims,
    *,
    filename: str,
    stream: IO[bytes],
    mimetype: str,
) -> StoredUpload:
    try:
        return application_services().file_grants.store_upload(
            context=_grant_context(grant),
            filename=filename,
            stream=stream,
            mimetype=mimetype,
        )
    except EndUserNotFoundError as exc:
        raise GrantedFileNotFoundError() from exc
    except services.errors.file.FileTooLargeError as exc:
        raise FileTooLargeError(exc.description)
    except services.errors.file.BlockedFileExtensionError as exc:
        raise BlockedFileExtensionError(exc.description) from exc
    except services.errors.file.UnsupportedFileTypeError:
        raise UnsupportedFileTypeError()


def _grant_context(grant: FileGrantClaims) -> FileGrantContext:
    return FileGrantContext(tenant_id=grant.tenant_id, app_id=grant.app_id, end_user_id=grant.sub)


def _granted_file_response(upload_file: StoredUpload) -> dict[str, object]:
    """Answer an upload exactly as dify's own upload endpoints answer it.

    A client moving off ``POST /v1/files/upload`` must not have to read a second
    shape, so the same model reads the same ``upload_files`` row: every key dify
    leaves null for such a row is null here too. Only the value of ``source_url``
    is ours. Dify signs a ``file-preview`` URL there and this channel signs a
    content-token URL, which keeps that key's promise of a signed URL that
    retrieves the file while keeping the grant its only way in.
    """

    signed_url, _ = application_services().file_grants.content_urls(file_id=upload_file.id, kind=FileKind.UPLOAD)
    return dump_response(FileResponse, upload_file) | {"source_url": signed_url}


def _remote_granted_file_response(upload_file: StoredUpload) -> dict[str, object]:
    """Answer a remote upload with the upload shape plus dify's ``url`` key.

    Reuses the URL already signed for ``source_url`` rather than signing a
    second one, so the two keys are one value under the two names dify's two
    kinds of client look for.
    """

    response = _granted_file_response(upload_file)
    return response | {"url": response["source_url"]}


__all__ = [
    "GrantedFileContentApi",
    "GrantedFileResolveApi",
    "GrantedFileUploadApi",
    "GrantedRemoteFileUploadApi",
    "ProducedFileApi",
]
