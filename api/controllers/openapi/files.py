"""POST /openapi/v1/apps/<app_id>/files — upload a file for use in app inputs."""

from __future__ import annotations

from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._contract import Kind, endpoint
from controllers.openapi._files import upload
from controllers.openapi._models import FileUploadRequest
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    CheckAppAccess,
    CheckAppApiEnabled,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
)
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject
from fields.file_fields import FileResponse
from libs.oauth_bearer import Scope


@openapi_ns.route("/apps/<string:app_id>/files")
class AppFileUploadApi(Resource):
    @openapi_ns.doc("upload_file_for_app_input")
    @openapi_ns.doc(description="Upload a file to use as an input variable when running the app")
    @openapi_ns.doc(
        responses={
            201: "File uploaded successfully",
            400: "Bad request — invalid filename or blocked extension",
            401: "Unauthorized — invalid or expired bearer token",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @endpoint(
        op="console_app.file.upload",
        kind=Kind.OBJECT,
        summary="Upload a file and get a file id for later runs",
        requirements=(
            CheckSubject(allowed=(AccountSubject, ExternalSsoSubject)),
            CheckAppApiEnabled(),
            CheckWorkspaceMember(),
            CheckScope(Scope.APPS_RUN),
            CheckAppAccess(),
        ),
        body=FileUploadRequest,
        returns=(201, FileResponse, "File uploaded"),
    )
    def post(self, ctx: Context, app_id: str, *, body: FileUploadRequest):
        return FileResponse.model_validate(upload(body.file, ctx.caller), from_attributes=True)
