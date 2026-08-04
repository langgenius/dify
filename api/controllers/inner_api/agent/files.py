"""Agent-owned inner endpoints for CLI file URL allocation."""

from __future__ import annotations

from typing import Literal

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, ValidationError, model_validator

from configs import dify_config
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.plugin.wraps import get_user
from controllers.inner_api.wraps import plugin_inner_api_only
from core.tools.signature import bind_file_uri, get_signed_file_uri_for_plugin
from core.workflow.file_reference import is_canonical_file_reference
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from models import Tenant
from services.file_request_service import FileRequestService


class AgentFileRequestHttpError(BaseHTTPException):
    error_code = "agent_file_request_failed"
    description = "Agent file request failed."
    code = 500

    def __init__(self, *, error_code: str, description: str, status_code: int) -> None:
        self.error_code = error_code
        self.description = description
        self.code = status_code
        super().__init__(description)


class AgentFileUploadRequestPayload(BaseModel):
    tenant_id: str
    user_id: str
    filename: str
    mimetype: str
    conversation_id: str | None = None

    model_config = ConfigDict(extra="forbid")


class AgentFileMappingPayload(BaseModel):
    transfer_method: Literal["local_file", "tool_file", "datasource_file", "remote_url"]
    reference: str | None = None
    url: str | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_locator(self) -> AgentFileMappingPayload:
        if self.transfer_method == "remote_url":
            if not self.url:
                raise ValueError("url is required when transfer_method is remote_url")
            if self.reference is not None:
                raise ValueError("reference is not allowed when transfer_method is remote_url")
            return self
        if not self.reference:
            raise ValueError("reference is required for non-remote file mappings")
        if not is_canonical_file_reference(self.reference):
            raise ValueError("reference must be a canonical Dify file reference")
        if self.url is not None:
            raise ValueError("url is not allowed for non-remote file mappings")
        return self


class AgentFileDownloadRequestPayload(BaseModel):
    tenant_id: str
    user_id: str
    user_from: Literal["account", "end-user"]
    invoke_from: Literal[
        "service-api",
        "openapi",
        "web-app",
        "trigger",
        "explore",
        "debugger",
        "published",
        "validation",
    ]
    file: AgentFileMappingPayload
    for_frontend: bool = True

    model_config = ConfigDict(extra="forbid")


class AgentFileUploadRequestResponse(ResponseModel):
    upload_uri: str


class AgentFileDownloadRequestResponse(ResponseModel):
    filename: str
    mime_type: str | None = None
    size: int
    download_uri: str


register_schema_models(inner_api_ns, AgentFileUploadRequestPayload, AgentFileDownloadRequestPayload)
register_response_schema_models(
    inner_api_ns,
    AgentFileUploadRequestResponse,
    AgentFileDownloadRequestResponse,
)


@inner_api_ns.route("/agent/files/upload-request")
class AgentFileUploadRequestApi(Resource):
    """Allocate an origin-free signed upload URI for the Agent CLI."""

    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("inner_agent_file_upload_request")
    @inner_api_ns.expect(inner_api_ns.models[AgentFileUploadRequestPayload.__name__])
    @inner_api_ns.response(
        200,
        "Upload URI allocated",
        inner_api_ns.models[AgentFileUploadRequestResponse.__name__],
    )
    def post(self) -> dict[str, object]:
        try:
            payload = AgentFileUploadRequestPayload.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise AgentFileRequestHttpError(
                error_code="invalid_request",
                description=str(exc),
                status_code=400,
            ) from exc

        tenant = db.session.get(Tenant, payload.tenant_id)
        if tenant is None:
            raise AgentFileRequestHttpError(
                error_code="tenant_not_found",
                description="tenant not found",
                status_code=404,
            )
        try:
            user = get_user(tenant.id, payload.user_id)
            upload_uri = get_signed_file_uri_for_plugin(
                filename=payload.filename,
                mimetype=payload.mimetype,
                tenant_id=tenant.id,
                user_id=user.id,
                conversation_id=payload.conversation_id,
            )
        except ValueError as exc:
            raise AgentFileRequestHttpError(
                error_code="user_not_found",
                description=str(exc),
                status_code=404,
            ) from exc

        return AgentFileUploadRequestResponse(upload_uri=upload_uri).model_dump(mode="json")


@inner_api_ns.route("/agent/files/download-request")
class AgentFileDownloadRequestApi(Resource):
    """Allocate a transfer URI or frontend URL for one Agent CLI file."""

    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("inner_agent_file_download_request")
    @inner_api_ns.expect(inner_api_ns.models[AgentFileDownloadRequestPayload.__name__])
    @inner_api_ns.response(
        200,
        "Download URI allocated",
        inner_api_ns.models[AgentFileDownloadRequestResponse.__name__],
    )
    def post(self) -> dict[str, object]:
        try:
            payload = AgentFileDownloadRequestPayload.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise AgentFileRequestHttpError(
                error_code="invalid_request",
                description=str(exc),
                status_code=400,
            ) from exc

        if db.session.get(Tenant, payload.tenant_id) is None:
            raise AgentFileRequestHttpError(
                error_code="tenant_not_found",
                description="tenant not found",
                status_code=404,
            )
        try:
            result = FileRequestService().request_download(
                tenant_id=payload.tenant_id,
                user_id=payload.user_id,
                user_from=payload.user_from,
                invoke_from=payload.invoke_from,
                file_mapping=payload.file.model_dump(mode="python", exclude_none=True),
            )
        except ValueError as exc:
            raise AgentFileRequestHttpError(
                error_code="file_not_accessible",
                description=str(exc),
                status_code=404,
            ) from exc

        download_uri = result.download_uri
        if payload.for_frontend:
            download_uri = bind_file_uri(download_uri, dify_config.FILES_URL)

        return AgentFileDownloadRequestResponse(
            filename=result.filename,
            mime_type=result.mime_type,
            size=result.size,
            download_uri=download_uri,
        ).model_dump(mode="json")


__all__ = [
    "AgentFileDownloadRequestApi",
    "AgentFileDownloadRequestPayload",
    "AgentFileDownloadRequestResponse",
    "AgentFileUploadRequestApi",
    "AgentFileUploadRequestPayload",
    "AgentFileUploadRequestResponse",
]
