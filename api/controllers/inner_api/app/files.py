"""Enterprise AppDeploy file broker endpoints.

Enterprise authenticates the browser passport before forwarding these requests.
This module turns its trusted environment subject into Dify's stable end-user
session, so Dify remains the sole owner of upload records and stored objects.
"""

from __future__ import annotations

from typing import Literal

import httpx
from flask_restx import Resource
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound, ServiceUnavailable

import services
from configs import dify_config
from controllers.common import helpers
from controllers.common.errors import (
    BlockedFileExtensionError,
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    RemoteFileUploadError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.file import remote_fetcher
from core.helper import ssrf_proxy
from core.tools.errors import ToolSSRFError
from extensions.ext_database import db
from fields.file_fields import FileWithSignedUrl, UploadConfig
from graphon.file import helpers as file_helpers
from models import App, EndUser, UploadFile
from models.enums import CreatorUserRole, EndUserType
from services.file_service import FileService

DEFAULT_LOCATOR_TTL = 600
MAX_LOCATOR_TTL = 3600


class AppDeployFileIdentity(BaseModel):
    tenant_id: str
    app_id: str
    environment_id: str
    subject_id: str
    subject_type: Literal["anonymous", "account"]


class AppDeployRemoteFileUploadPayload(BaseModel):
    url: HttpUrl


class AppDeployFileResolvePayload(BaseModel):
    file_ids: list[str] = Field(min_length=1, max_length=100)
    minimum_locator_ttl: int = Field(default=DEFAULT_LOCATOR_TTL, ge=1, le=MAX_LOCATOR_TTL)


register_schema_models(
    inner_api_ns,
    AppDeployRemoteFileUploadPayload,
    AppDeployFileResolvePayload,
    FileWithSignedUrl,
    UploadConfig,
)


def _session_identity(*, environment_id: str, subject_type: str, subject_id: str) -> str:
    return f"appdeploy:{environment_id}:{subject_type}:{subject_id}"


def _identity_from_request() -> AppDeployFileIdentity:
    from flask import request

    return AppDeployFileIdentity.model_validate(
        {
            "tenant_id": request.headers.get("X-AppDeploy-Tenant-ID"),
            "app_id": request.headers.get("X-AppDeploy-App-ID"),
            "environment_id": request.headers.get("X-AppDeploy-Environment-ID"),
            "subject_id": request.headers.get("X-AppDeploy-Subject-ID"),
            "subject_type": request.headers.get("X-AppDeploy-Subject-Type"),
        }
    )


def _get_end_user(identity: AppDeployFileIdentity) -> EndUser:
    session_id = _session_identity(
        environment_id=identity.environment_id,
        subject_type=identity.subject_type,
        subject_id=identity.subject_id,
    )
    with Session(db.engine, expire_on_commit=False) as session, session.begin():
        app_model = session.scalar(
            select(App).where(App.id == identity.app_id, App.tenant_id == identity.tenant_id).with_for_update().limit(1)
        )
        if app_model is None:
            raise NotFound("App not found")

        end_user = session.scalar(
            select(EndUser)
            .where(
                EndUser.tenant_id == identity.tenant_id,
                EndUser.app_id == identity.app_id,
                EndUser.session_id == session_id,
                EndUser.type == EndUserType.APP_DEPLOY,
            )
            .limit(1)
        )
        if end_user is None:
            end_user = EndUser(
                tenant_id=identity.tenant_id,
                app_id=identity.app_id,
                type=EndUserType.APP_DEPLOY,
                is_anonymous=identity.subject_type == "anonymous",
                session_id=session_id,
                external_user_id=session_id,
            )
            session.add(end_user)
        return end_user


def _upload_response(upload_file: UploadFile) -> dict[str, object]:
    return FileWithSignedUrl(
        id=upload_file.id,
        name=upload_file.name,
        size=upload_file.size,
        extension=upload_file.extension,
        url=file_helpers.get_signed_file_url(upload_file_id=upload_file.id),
        mime_type=upload_file.mime_type,
        created_by=upload_file.created_by,
        created_at=int(upload_file.created_at.timestamp()),
    ).model_dump(mode="json")


def _upload_remote_file(*, url: str, end_user: EndUser) -> UploadFile:
    try:
        response = remote_fetcher.make_request("GET", url=url, timeout=3, follow_redirects=True, stream_response=True)
        if response.status_code != httpx.codes.OK:
            response.close()
            raise RemoteFileUploadError(f"Failed to fetch file from {url}: status {response.status_code}")
        response = ssrf_proxy.buffer_response(response, max_response_bytes=_max_upload_bytes())
    except ssrf_proxy.ResponseTooLargeError as exc:
        raise FileTooLargeError() from exc
    except (
        httpx.RequestError,
        ssrf_proxy.MaxRetriesExceededError,
        ssrf_proxy.UnsupportedResponseEncodingError,
        ToolSSRFError,
    ) as exc:
        raise RemoteFileUploadError(f"Failed to fetch file from {url}: {exc}") from exc

    file_info = helpers.guess_file_info_from_response(response)
    if not FileService.is_file_size_within_limit(extension=file_info.extension, file_size=file_info.size):
        raise FileTooLargeError()

    try:
        return FileService(db.engine).upload_file(
            filename=file_info.filename,
            content=response.content,
            mimetype=file_info.mimetype,
            user=end_user,
            source_url=url,
        )
    except services.errors.file.FileTooLargeError as exc:
        raise FileTooLargeError(exc.description) from exc
    except services.errors.file.UnsupportedFileTypeError as exc:
        raise UnsupportedFileTypeError() from exc
    except services.errors.file.BlockedFileExtensionError as exc:
        raise BlockedFileExtensionError(exc.description) from exc


def _max_upload_bytes() -> int:
    return (
        max(
            dify_config.UPLOAD_FILE_SIZE_LIMIT,
            dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT,
            dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT,
            dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT,
        )
        * 1024
        * 1024
    )


@inner_api_ns.route("/enterprise/app-deploy/files/upload")
class EnterpriseAppDeployFileUpload(Resource):
    @enterprise_inner_api_only
    def post(self):
        from flask import request

        end_user = _get_end_user(_identity_from_request())
        if "file" not in request.files:
            raise NoFileUploadedError()
        if len(request.files) > 1:
            raise TooManyFilesError()
        file = request.files["file"]
        if not file.filename:
            raise FilenameNotExistsError()

        max_upload_bytes = _max_upload_bytes()
        content = file.stream.read(max_upload_bytes + 1)
        if len(content) > max_upload_bytes:
            raise FileTooLargeError()

        try:
            upload_file = FileService(db.engine).upload_file(
                filename=file.filename,
                content=content,
                mimetype=file.mimetype,
                user=end_user,
            )
        except services.errors.file.FileTooLargeError as exc:
            raise FileTooLargeError(exc.description) from exc
        except services.errors.file.UnsupportedFileTypeError as exc:
            raise UnsupportedFileTypeError() from exc
        except services.errors.file.BlockedFileExtensionError as exc:
            raise BlockedFileExtensionError(exc.description) from exc

        return _upload_response(upload_file), 201


@inner_api_ns.route("/enterprise/app-deploy/remote-files/upload")
class EnterpriseAppDeployRemoteFileUpload(Resource):
    @enterprise_inner_api_only
    def post(self):
        from flask import request

        payload = AppDeployRemoteFileUploadPayload.model_validate(request.get_json() or {})
        upload_file = _upload_remote_file(url=str(payload.url), end_user=_get_end_user(_identity_from_request()))
        return _upload_response(upload_file), 201


@inner_api_ns.route("/enterprise/app-deploy/files/resolve")
class EnterpriseAppDeployFileResolve(Resource):
    @enterprise_inner_api_only
    def post(self):
        from flask import request

        payload = AppDeployFileResolvePayload.model_validate(request.get_json() or {})
        if payload.minimum_locator_ttl > dify_config.FILES_ACCESS_TIMEOUT:
            raise ServiceUnavailable(f"FILES_ACCESS_TIMEOUT must be at least {payload.minimum_locator_ttl} seconds")

        identity = _identity_from_request()
        end_user = _get_end_user(identity)
        unique_file_ids = set(payload.file_ids)
        with Session(db.engine, expire_on_commit=False) as session:
            upload_files = session.scalars(
                select(UploadFile).where(
                    UploadFile.id.in_(unique_file_ids),
                    UploadFile.tenant_id == identity.tenant_id,
                    UploadFile.created_by_role == CreatorUserRole.END_USER,
                    UploadFile.created_by == end_user.id,
                )
            ).all()
        upload_files_by_id = {upload_file.id: upload_file for upload_file in upload_files}
        if len(upload_files_by_id) != len(unique_file_ids):
            raise NotFound("File not found")

        signed_urls: dict[str, str] = {}
        resolved_files: list[dict[str, object]] = []
        for file_id in payload.file_ids:
            signed_url = signed_urls.get(file_id)
            if signed_url is None:
                signed_url = file_helpers.get_signed_file_url(upload_file_id=file_id)
                signed_urls[file_id] = signed_url
            upload_file = upload_files_by_id[file_id]
            resolved_files.append(
                {
                    "id": file_id,
                    "name": upload_file.name,
                    "size": upload_file.size,
                    "extension": upload_file.extension,
                    "mime_type": upload_file.mime_type,
                    "url": signed_url,
                }
            )
        return {"files": resolved_files}, 200


@inner_api_ns.route("/enterprise/app-deploy/files/config")
class EnterpriseAppDeployFileConfig(Resource):
    @enterprise_inner_api_only
    def get(self):
        return UploadConfig(
            file_size_limit=dify_config.UPLOAD_FILE_SIZE_LIMIT,
            batch_count_limit=dify_config.UPLOAD_FILE_BATCH_LIMIT,
            file_upload_limit=dify_config.BATCH_UPLOAD_LIMIT,
            image_file_size_limit=dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT,
            video_file_size_limit=dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT,
            audio_file_size_limit=dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT,
            skill_file_size_limit=dify_config.UPLOAD_SKILL_FILE_SIZE_LIMIT,
            workflow_file_upload_limit=dify_config.WORKFLOW_FILE_UPLOAD_LIMIT,
            image_file_batch_limit=dify_config.IMAGE_FILE_BATCH_LIMIT,
            single_chunk_attachment_limit=dify_config.SINGLE_CHUNK_ATTACHMENT_LIMIT,
            attachment_image_file_size_limit=dify_config.ATTACHMENT_IMAGE_FILE_SIZE_LIMIT,
        ).model_dump(mode="json"), 200
