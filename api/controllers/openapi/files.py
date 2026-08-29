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
from controllers.openapi.auth.requirements import (
    CheckAppApiEnabled,
    RequireWebappAccess,
    RequireWorkspaceMembership,
    SubjectCheck,
    TokenScope,
)
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject
from extensions.ext_database import db
from fields.file_fields import FileResponse
from libs.oauth_bearer import Scope
from services.file_service import FileService


@openapi_ns.route("/apps/<string:app_id>/files")
class AppFileUploadApi(Resource):
    @openapi_ns.doc("upload_file_for_app_input")
    @openapi_ns.doc(description="Upload a file to use as an input variable when running the app")
    @openapi_ns.doc(
        responses={
            201: "File uploaded successfully",
            400: "Bad request — no file or filename missing",
            401: "Unauthorized — invalid or expired bearer token",
            413: "File too large",
            415: "Unsupported file type or blocked extension",
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
            upload_file = FileService(db.engine).upload_file(
                filename=file.filename,
                content=file.stream.read(),
                mimetype=file.mimetype,
                user=ctx.caller,
            )
        except ValueError as exc:
            raise BadRequest(str(exc))
        except services.errors.file.FileTooLargeError as exc:
            raise FileTooLargeError(exc.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()
        except services.errors.file.BlockedFileExtensionError as exc:
            raise BlockedFileExtensionError(exc.description)

        return FileResponse.model_validate(upload_file, from_attributes=True)
