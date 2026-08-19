"""File endpoints reached with an AppDeploy file grant.

Upload, remote-upload, produce, and resolve authenticate with a Bearer grant;
content authenticates with a per-file token in the query string, because an
``<img src>`` cannot carry a header. All five are additive: the existing
``file-preview`` and ``tools`` signature surfaces are untouched.
"""

from __future__ import annotations

from urllib.parse import quote
from uuid import UUID

import httpx
from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, Field, HttpUrl, ValidationError
from werkzeug.datastructures import FileStorage

import services
from configs import dify_config
from controllers.common import helpers
from controllers.common.errors import (
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
from core.file import remote_fetcher
from core.tools.tool_file_manager import ToolFileManager
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.file_grant import (
    FileGrantClaims,
    FileGrantScope,
    FileKind,
    InvalidFileGrantError,
    build_content_url,
    decode_file_content_token,
)
from models.model import EndUser, UploadFile
from services.file_grant_service import FileContent, FileGrantService, FileRef, ResolvedFile
from services.file_service import FileService

# Everything outside this whitelist is served as an attachment. Produced files
# carry a plugin-declared MIME type, so SVG and the rest of the XML family must
# never render in the viewer's origin.
INLINE_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})

RANGE_MIME_TYPES = frozenset(
    {
        "audio/mpeg",
        "audio/wav",
        "audio/mp4",
        "audio/ogg",
        "audio/flac",
        "audio/aac",
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "audio/x-m4a",
    }
)


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
    files: list[FileRefPayload] = Field(default_factory=list)


class FileContentQuery(BaseModel):
    token: str = Field(description="Signed content token scoped to this file")


class GrantedFileResponse(ResponseModel):
    id: str
    name: str
    size: int
    extension: str
    mime_type: str | None = None
    url: str


class ProducedFileResponse(ResponseModel):
    id: str
    name: str
    size: int
    mime_type: str | None = None
    url: str
    internal_url: str


class ResolvedFileResponse(ResponseModel):
    id: str
    ok: bool
    kind: FileKind | None = None
    name: str | None = None
    size: int | None = None
    extension: str | None = None
    mime_type: str | None = None
    url: str | None = None
    internal_url: str | None = None
    error: str | None = None


class FileResolveResponse(ResponseModel):
    files: list[ResolvedFileResponse]


register_schema_models(files_ns, RemoteFileUploadPayload, FileResolvePayload)
register_response_schema_models(files_ns, GrantedFileResponse, ProducedFileResponse, FileResolveResponse)


@files_ns.route("/api/upload")
class GrantedFileUploadApi(Resource):
    """Store one uploaded file against the grant's end user."""

    @file_grant_required(FileGrantScope.UPLOAD)
    @files_ns.doc("grant_upload_file")
    @files_ns.doc(
        responses={
            201: "File uploaded",
            400: "No file uploaded, or the file has no name",
            401: "Invalid grant",
            403: "Grant lacks the upload scope",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @files_ns.response(201, "File uploaded", files_ns.models[GrantedFileResponse.__name__])
    def post(self, grant: FileGrantClaims):
        upload = _single_upload()
        upload_file = _store_upload(
            grant,
            filename=upload.filename or "",
            content=_read_capped(upload),
            mimetype=upload.mimetype,
        )
        return _granted_file_response(upload_file), 201


@files_ns.route("/api/remote-upload")
class GrantedRemoteFileUploadApi(Resource):
    """Fetch a remote URL through the SSRF-safe fetcher and store it."""

    @file_grant_required(FileGrantScope.UPLOAD)
    @files_ns.doc("grant_upload_remote_file")
    @files_ns.expect(files_ns.models[RemoteFileUploadPayload.__name__])
    @files_ns.doc(
        responses={
            201: "Remote file uploaded",
            400: "Invalid URL, or the remote file could not be fetched",
            401: "Invalid grant",
            403: "Grant lacks the upload scope",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @files_ns.response(201, "Remote file uploaded", files_ns.models[GrantedFileResponse.__name__])
    def post(self, grant: FileGrantClaims):
        try:
            payload = RemoteFileUploadPayload.model_validate(files_ns.payload or {})
        except ValidationError as exc:
            raise InvalidFileRequestError(str(exc)) from exc

        url = str(payload.url)
        try:
            response = remote_fetcher.make_request("HEAD", url=url)
            if response.status_code != httpx.codes.OK:
                response = remote_fetcher.make_request("GET", url=url, timeout=3, follow_redirects=True)
            if response.status_code != httpx.codes.OK:
                raise RemoteFileUploadError(f"Failed to fetch file from {url}: {response.text}")
        except httpx.RequestError as exc:
            raise RemoteFileUploadError(f"Failed to fetch file from {url}: {exc}")

        file_info = helpers.guess_file_info_from_response(response)
        if not FileService.is_file_size_within_limit(extension=file_info.extension, file_size=file_info.size):
            raise FileTooLargeError()

        content = (
            response.content if response.request.method == "GET" else remote_fetcher.make_request("GET", url).content
        )
        if len(content) > _upload_size_cap():
            raise FileTooLargeError()

        upload_file = _store_upload(
            grant,
            filename=file_info.filename,
            content=content,
            mimetype=file_info.mimetype,
            source_url=url,
        )
        return _granted_file_response(upload_file), 201


@files_ns.route("/api/produced")
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
        # `create_file_by_raw` enforces no size limit of its own, so the cap has
        # to be applied here, before the bytes are buffered.
        content = _read_capped(upload)

        tool_file = ToolFileManager().create_file_by_raw(
            user_id=grant.sub,
            tenant_id=grant.tenant_id,
            conversation_id=None,
            file_binary=content,
            mimetype=upload.mimetype,
            filename=upload.filename,
        )

        return ProducedFileResponse(
            id=tool_file.id,
            name=tool_file.name,
            size=tool_file.size,
            mime_type=tool_file.mimetype,
            url=build_content_url(file_id=tool_file.id, kind=FileKind.TOOL, external=True),
            internal_url=build_content_url(file_id=tool_file.id, kind=FileKind.TOOL, external=False),
        ).model_dump(mode="json"), 201


@files_ns.route("/api/resolve")
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
        resolved = FileGrantService.resolve_files(
            tenant_id=grant.tenant_id,
            end_user_id=grant.sub,
            refs=refs,
        )

        return FileResolveResponse(
            files=[_resolved_file_response(ref.id, file) for ref, file in zip(refs, resolved, strict=True)]
        ).model_dump(mode="json")


@files_ns.route("/api/<uuid:file_id>/content")
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
            claims = decode_file_content_token(query.token)
        except InvalidFileGrantError as exc:
            raise FileGrantInvalidError() from exc

        if claims.file_id != str(file_id):
            raise GrantedFileNotFoundError()

        content = FileGrantService.load_content(file_id=str(file_id), kind=claims.kind)
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
    if mime_type in RANGE_MIME_TYPES:
        response.headers["Accept-Ranges"] = "bytes"
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


def _upload_size_cap() -> int:
    """The largest size any per-extension limit could allow, in bytes."""

    return (
        max(
            dify_config.UPLOAD_FILE_SIZE_LIMIT,
            dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT,
            dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT,
            dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT,
        )
        * 1024
        * 1024
    )


def _read_capped(upload: FileStorage) -> bytes:
    cap = _upload_size_cap()
    content = upload.stream.read(cap + 1)
    if len(content) > cap:
        raise FileTooLargeError()
    return content


def _load_end_user(grant: FileGrantClaims) -> EndUser:
    end_user = FileGrantService.load_end_user(end_user_id=grant.sub, tenant_id=grant.tenant_id)
    if end_user is None:
        raise GrantedFileNotFoundError()
    return end_user


def _store_upload(
    grant: FileGrantClaims,
    *,
    filename: str,
    content: bytes,
    mimetype: str,
    source_url: str = "",
) -> UploadFile:
    end_user = _load_end_user(grant)
    try:
        return FileService(db.engine).upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=end_user,
            source_url=source_url,
        )
    except services.errors.file.FileTooLargeError as exc:
        raise FileTooLargeError(exc.description)
    except services.errors.file.UnsupportedFileTypeError:
        raise UnsupportedFileTypeError()


def _granted_file_response(upload_file: UploadFile) -> dict[str, object]:
    return GrantedFileResponse(
        id=upload_file.id,
        name=upload_file.name,
        size=upload_file.size,
        extension=upload_file.extension,
        mime_type=upload_file.mime_type,
        url=build_content_url(file_id=upload_file.id, kind=FileKind.UPLOAD, external=True),
    ).model_dump(mode="json")


def _resolved_file_response(file_id: str, file: ResolvedFile | None) -> ResolvedFileResponse:
    if file is None:
        return ResolvedFileResponse(id=file_id, ok=False, error="not_found")

    return ResolvedFileResponse(
        id=file.id,
        ok=True,
        kind=file.kind,
        name=file.name,
        size=file.size,
        extension=file.extension,
        mime_type=file.mime_type,
        url=build_content_url(file_id=file.id, kind=file.kind, external=True),
        internal_url=build_content_url(file_id=file.id, kind=file.kind, external=False),
    )


__all__ = [
    "GrantedFileContentApi",
    "GrantedFileResolveApi",
    "GrantedFileUploadApi",
    "GrantedRemoteFileUploadApi",
    "ProducedFileApi",
]
