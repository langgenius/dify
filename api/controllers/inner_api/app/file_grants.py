"""Mint AppDeploy file grants for the enterprise control plane.

This is the only endpoint that asserts an AppDeploy identity: it upserts the
subject's ``EndUser`` row, validates the files the caller claims to reference,
and signs a short-lived grant. Every other file endpoint is stateless from
here on and trusts the grant's signature.
"""

from __future__ import annotations

from flask_restx import Resource
from pydantic import BaseModel, Field, ValidationError

from configs import dify_config
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import setup_required
from controllers.files.wraps import GrantedFileNotFoundError
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.file_grant import FileGrantScope, FileKind, build_content_url, issue_file_grant
from services.file_grant_service import AppNotFoundError, FileGrantService, FileRef, ResolvedFile

MAX_GRANT_TTL_SECONDS = 7200


class InvalidGrantRequestError(BaseHTTPException):
    error_code = "invalid_request"
    description = "The file grant request is malformed."
    code = 400


class GrantTtlTooLongError(BaseHTTPException):
    error_code = "grant_ttl_too_long"
    description = f"A file grant may not live longer than {MAX_GRANT_TTL_SECONDS} seconds."
    code = 400


class InvalidSubjectError(BaseHTTPException):
    error_code = "invalid_subject"
    description = "The subject is empty."
    code = 400


class GrantAppNotFoundError(BaseHTTPException):
    error_code = "app_not_found"
    description = "App not found."
    code = 404


class FileGrantFileRef(BaseModel):
    id: str
    kind: FileKind


class FileGrantMintPayload(BaseModel):
    tenant_id: str
    app_id: str
    subject: str
    is_anonymous: bool = False
    scopes: list[FileGrantScope]
    ttl_seconds: int = Field(gt=0)
    # Recorded by the enterprise caller's own audit log; it never enters the
    # grant because a rotated key must not strand the files it uploaded.
    actor_key_digest: str | None = None
    file_ids: list[FileGrantFileRef] = Field(default_factory=list)
    optional_file_ids: list[FileGrantFileRef] = Field(default_factory=list)
    run_deadline: int | None = None


class FileGrantLimits(ResponseModel):
    file_size_limit: int
    image_file_size_limit: int
    audio_file_size_limit: int
    video_file_size_limit: int
    workflow_file_upload_limit: int
    batch_count_limit: int


class FileGrantFileMetadata(ResponseModel):
    id: str
    kind: FileKind
    name: str
    size: int
    extension: str
    mime_type: str | None = None


class FileGrantOptionalFile(ResponseModel):
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


class FileGrantMintResponse(ResponseModel):
    grant: str
    expires_at: int
    limits: FileGrantLimits
    files: list[FileGrantFileMetadata]
    optional_files: list[FileGrantOptionalFile]


register_schema_models(inner_api_ns, FileGrantMintPayload)
register_response_schema_models(inner_api_ns, FileGrantMintResponse)


@inner_api_ns.route("/enterprise/file-grants")
class EnterpriseFileGrantApi(Resource):
    """Assert one AppDeploy subject and sign a grant for it."""

    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc("enterprise_mint_file_grant")
    @inner_api_ns.expect(inner_api_ns.models[FileGrantMintPayload.__name__])
    @inner_api_ns.response(
        200,
        "File grant minted",
        inner_api_ns.models[FileGrantMintResponse.__name__],
    )
    @inner_api_ns.doc(
        responses={
            400: "Invalid request, subject, or grant TTL",
            404: "App not found, or a required file is not owned by the subject",
        }
    )
    def post(self):
        try:
            payload = FileGrantMintPayload.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise InvalidGrantRequestError(str(exc)) from exc

        if payload.ttl_seconds > MAX_GRANT_TTL_SECONDS:
            raise GrantTtlTooLongError()
        if not payload.subject.strip():
            raise InvalidSubjectError()

        try:
            end_user = FileGrantService.get_or_create_end_user(
                tenant_id=payload.tenant_id,
                app_id=payload.app_id,
                subject=payload.subject,
                is_anonymous=payload.is_anonymous,
            )
        except AppNotFoundError as exc:
            raise GrantAppNotFoundError() from exc

        files = _resolve_strict(payload, end_user_id=end_user.id)
        optional_files = _resolve_lenient(payload, end_user_id=end_user.id)

        grant, expires_at = issue_file_grant(
            end_user_id=end_user.id,
            tenant_id=payload.tenant_id,
            app_id=payload.app_id,
            scopes=payload.scopes,
            ttl_seconds=payload.ttl_seconds,
        )

        return FileGrantMintResponse(
            grant=grant,
            expires_at=expires_at,
            limits=FileGrantLimits(
                file_size_limit=dify_config.UPLOAD_FILE_SIZE_LIMIT,
                image_file_size_limit=dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT,
                audio_file_size_limit=dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT,
                video_file_size_limit=dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT,
                workflow_file_upload_limit=dify_config.WORKFLOW_FILE_UPLOAD_LIMIT,
                batch_count_limit=dify_config.UPLOAD_FILE_BATCH_LIMIT,
            ),
            files=files,
            optional_files=optional_files,
        ).model_dump(mode="json")


def _resolve_strict(payload: FileGrantMintPayload, *, end_user_id: str) -> list[FileGrantFileMetadata]:
    """Resolve the whole batch or fail it, without signing any URL.

    Grants outlive the ``FILES_ACCESS_TIMEOUT`` window, so URLs are signed only
    when a worker is about to read the bytes.
    """

    resolved = FileGrantService.resolve_files(
        tenant_id=payload.tenant_id,
        end_user_id=end_user_id,
        refs=[FileRef(id=ref.id, kind=ref.kind) for ref in payload.file_ids],
    )
    if any(file is None for file in resolved):
        raise GrantedFileNotFoundError()

    return [
        FileGrantFileMetadata(
            id=file.id,
            kind=file.kind,
            name=file.name,
            size=file.size,
            extension=file.extension,
            mime_type=file.mime_type,
        )
        for file in resolved
        if file is not None
    ]


def _resolve_lenient(payload: FileGrantMintPayload, *, end_user_id: str) -> list[FileGrantOptionalFile]:
    """Resolve history files item by item so one miss cannot block a run."""

    refs = [FileRef(id=ref.id, kind=ref.kind) for ref in payload.optional_file_ids]
    resolved = FileGrantService.resolve_files(
        tenant_id=payload.tenant_id,
        end_user_id=end_user_id,
        refs=refs,
    )
    return [_optional_file(ref.id, file) for ref, file in zip(refs, resolved, strict=True)]


def _optional_file(file_id: str, file: ResolvedFile | None) -> FileGrantOptionalFile:
    if file is None:
        return FileGrantOptionalFile(id=file_id, ok=False, error="not_found")

    return FileGrantOptionalFile(
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
    "EnterpriseFileGrantApi",
    "FileGrantMintPayload",
    "FileGrantMintResponse",
]
