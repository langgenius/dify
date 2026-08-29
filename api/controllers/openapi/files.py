"""POST /openapi/v1/apps/<app_id>/files — upload a file for use in app inputs."""

from __future__ import annotations

from flask import request
from flask_restx import Resource
from werkzeug.exceptions import BadRequest

import services
from controllers.common.errors import (
    BlockedFileExtensionError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.openapi import openapi_ns
from controllers.openapi._contract import endpoint
from controllers.openapi._errors import FilenameNotExists
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import load_caller
from controllers.openapi.auth.requirements import (
    CheckAppApiEnabled,
    RequireWebappAccess,
    RequireWorkspaceMembership,
    SubjectCheck,
    TokenScope,
)
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject
from extensions.ext_application_services import application_services
from fields.file_fields import FileResponse
from libs.oauth_bearer import Scope


@openapi_ns.route("/apps/<string:app_id>/files")
class AppFileUploadApi(Resource):
    @openapi_ns.doc("upload_file_for_app_input")
    @openapi_ns.doc(description="Upload a file to use as an input variable when running the app")
    @openapi_ns.doc(
        responses={
            201: "File uploaded successfully",
            400: "Bad request — no file, multiple files, invalid filename, or blocked extension",
            401: "Unauthorized — invalid or expired bearer token",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @endpoint(
        requirements=(
            SubjectCheck(allowed=(AccountSubject, ExternalSsoSubject)),
            CheckAppApiEnabled(),
            RequireWorkspaceMembership(),
            TokenScope(Scope.APPS_RUN),
            RequireWebappAccess(),
        ),
        returns=(201, FileResponse, "File uploaded"),
        write=False,
    )
    def post(self, ctx: Context, app_id: str):
        if "file" not in request.files:
            raise NoFileUploadedError()
        if len(request.files) > 1:
            raise TooManyFilesError()

        file = request.files["file"]
        if not file.mimetype:
            raise UnsupportedFileTypeError()
        if not file.filename:
            raise FilenameNotExists()

        try:
            upload_file = application_services().files.upload_file(
                filename=file.filename,
                content=file.stream.read(),
                mimetype=file.mimetype,
                user=load_caller(ctx),
            )
        except services.errors.file.FileTooLargeError as exc:
            raise FileTooLargeError(exc.description) from exc
        except services.errors.file.UnsupportedFileTypeError as exc:
            raise UnsupportedFileTypeError() from exc
        except services.errors.file.BlockedFileExtensionError as exc:
            raise BlockedFileExtensionError(exc.description) from exc
        except ValueError as exc:
            raise BadRequest(str(exc)) from exc

        return FileResponse.model_validate(upload_file, from_attributes=True)
