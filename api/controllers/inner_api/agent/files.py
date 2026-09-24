"""Agent-owned inner endpoints for CLI file URL allocation."""

from __future__ import annotations

from typing import Literal

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from configs import dify_config
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.common.session import with_session
from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.plugin.wraps import get_user
from controllers.inner_api.wraps import plugin_inner_api_only
from core.plugin.entities.request import RequestDownloadFileMapping, RequestRequestUploadFile
from core.tools.signature import bind_file_uri, get_signed_file_uri_for_plugin
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from services.account_service import TenantService
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


class AgentFileUploadRequestPayload(RequestRequestUploadFile):
    tenant_id: str
    user_id: str
    user_from: Literal["account", "end-user"] | None = None
    max_size: int = Field(ge=0, description="Maximum upload size in bytes")

    model_config = ConfigDict(extra="forbid")


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
    file: RequestDownloadFileMapping
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
    @with_session(write=False)
    def post(self, session: Session) -> dict[str, object]:
        try:
            payload = AgentFileUploadRequestPayload.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise AgentFileRequestHttpError(
                error_code="invalid_request",
                description=str(exc),
                status_code=400,
            ) from exc

        tenant = TenantService.get_tenant_by_id(payload.tenant_id, session=session)
        if tenant is None:
            raise AgentFileRequestHttpError(
                error_code="tenant_not_found",
                description="tenant not found",
                status_code=404,
            )
        try:
            if payload.user_from == "account":
                if not TenantService.account_belongs_to_tenant(payload.user_id, tenant.id, session=session):
                    raise ValueError("account not found")
                owner_id = payload.user_id
            else:
                owner_id = get_user(tenant.id, payload.user_id).id
            upload_uri = get_signed_file_uri_for_plugin(
                filename=payload.filename,
                mimetype=payload.mimetype,
                tenant_id=tenant.id,
                user_id=owner_id,
                conversation_id=payload.conversation_id,
                user_from=payload.user_from,
                max_size=payload.max_size,
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
    @with_session(write=False)
    def post(self, session: Session) -> dict[str, object]:
        try:
            payload = AgentFileDownloadRequestPayload.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise AgentFileRequestHttpError(
                error_code="invalid_request",
                description=str(exc),
                status_code=400,
            ) from exc

        if TenantService.get_tenant_by_id(payload.tenant_id, session=session) is None:
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
