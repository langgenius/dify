"""Mint AppDeploy file grants for the enterprise control plane.

This is the only endpoint that asserts an AppDeploy identity: the application
service upserts the subject's ``EndUser`` row, validates the files the caller
claims to reference, and signs a short-lived grant.
"""

from __future__ import annotations

from flask_restx import Resource
from pydantic import BaseModel, Field, ValidationError

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import setup_required
from controllers.files.wraps import GrantedFileNotFoundError
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from fields.file_grant_fields import ResolvedFileResponse
from libs.exception import BaseHTTPException
from services.entities.file_grant_entities import FileGrantMintRequest, FileGrantScope, FileKind, FileRef
from services.file_grant_service import (
    AppNotFoundError,
    EndUserNotFoundError,
    TooManyFileRefsError,
)
from services.file_grant_service import (
    GrantedFileNotFoundError as ServiceGrantedFileNotFoundError,
)
from services.file_grant_service import (
    GrantTtlTooLongError as ServiceGrantTtlTooLongError,
)
from services.file_grant_service import (
    InvalidGrantRequestError as ServiceInvalidGrantRequestError,
)
from services.file_grant_service import (
    InvalidSubjectError as ServiceInvalidSubjectError,
)


class InvalidGrantRequestError(BaseHTTPException):
    error_code = "invalid_request"
    description = "The file grant request is malformed."
    code = 400


class GrantTtlTooLongError(BaseHTTPException):
    error_code = "grant_ttl_too_long"
    description = "The requested file grant lifetime exceeds its allowed window."
    code = 400


class InvalidSubjectError(BaseHTTPException):
    error_code = "invalid_subject"
    description = "The subject is empty or contains a NUL byte."
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


class FileGrantMintResponse(ResponseModel):
    grant: str
    expires_at: int
    limits: FileGrantLimits
    files: list[FileGrantFileMetadata]
    optional_files: list[ResolvedFileResponse]


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

        try:
            result = application_services().file_grants.mint(
                FileGrantMintRequest(
                    tenant_id=payload.tenant_id,
                    app_id=payload.app_id,
                    subject=payload.subject,
                    is_anonymous=payload.is_anonymous,
                    scopes=tuple(payload.scopes),
                    ttl_seconds=payload.ttl_seconds,
                    file_refs=tuple(FileRef(id=ref.id, kind=ref.kind) for ref in payload.file_ids),
                    optional_file_refs=tuple(FileRef(id=ref.id, kind=ref.kind) for ref in payload.optional_file_ids),
                    run_deadline=payload.run_deadline,
                )
            )
        except AppNotFoundError as exc:
            raise GrantAppNotFoundError() from exc
        except ServiceGrantTtlTooLongError as exc:
            raise GrantTtlTooLongError() from exc
        except ServiceInvalidSubjectError as exc:
            raise InvalidSubjectError() from exc
        except (ServiceInvalidGrantRequestError, TooManyFileRefsError) as exc:
            raise InvalidGrantRequestError(str(exc)) from exc
        except (EndUserNotFoundError, ServiceGrantedFileNotFoundError) as exc:
            raise GrantedFileNotFoundError() from exc

        return FileGrantMintResponse(
            grant=result.grant,
            expires_at=result.expires_at,
            limits=FileGrantLimits(
                file_size_limit=result.limits.file_size_limit,
                image_file_size_limit=result.limits.image_file_size_limit,
                audio_file_size_limit=result.limits.audio_file_size_limit,
                video_file_size_limit=result.limits.video_file_size_limit,
                workflow_file_upload_limit=result.limits.workflow_file_upload_limit,
                batch_count_limit=result.limits.batch_count_limit,
            ),
            files=[
                FileGrantFileMetadata(
                    id=file.id,
                    kind=file.kind,
                    name=file.name,
                    size=file.size,
                    extension=file.extension,
                    mime_type=file.mime_type,
                )
                for file in result.files
            ],
            optional_files=[
                ResolvedFileResponse.from_resolved(ref.id, access)
                for ref, access in zip(
                    payload.optional_file_ids,
                    result.optional_files,
                    strict=True,
                )
            ],
        ).model_dump(mode="json")


__all__ = [
    "EnterpriseFileGrantApi",
    "FileGrantMintPayload",
    "FileGrantMintResponse",
]
