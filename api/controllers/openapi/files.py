"""POST /openapi/v1/apps/<app_id>/files — upload a file for use in app inputs."""

from __future__ import annotations

from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._files import end_read_transaction, upload
from controllers.openapi._models import FileUploadPayload
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
        examples=(
            Example(title="Upload a local PDF and get a file id", input={"app_id": "<app_id>", "file": "./report.pdf"}),
        ),
        requirements=(
            CheckSubject(allowed=(AccountSubject, ExternalSsoSubject)),
            CheckAppApiEnabled(),
            CheckWorkspaceMember(),
            CheckScope(Scope.APPS_RUN),
            CheckAppAccess(),
        ),
        body=FileUploadPayload,
        returns=(201, FileResponse, "File uploaded"),
    )
    def post(self, ctx: Context, app_id: str, *, body: FileUploadPayload):
        end_read_transaction(ctx.session)
        return FileResponse.model_validate(upload(body.file, ctx.caller), from_attributes=True)
