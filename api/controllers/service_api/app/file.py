from flask import request
from flask_restx import Resource
from flask_restx.api import HTTPStatus

import services
from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import register_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.schema import multipart_file_params
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from extensions.ext_database import db
from fields.file_fields import FileResponse
from models import App, EndUser
from services.file_service import FileService

register_schema_models(service_api_ns, FileResponse)


@service_api_ns.route("/files/upload")
class FileApi(Resource):
    @service_api_ns.doc(
        summary="Upload File",
        description=(
            "Upload a file for use when sending messages, enabling multimodal understanding of images, "
            "documents, audio, and video. Uploaded files are for use by the current end-user only."
        ),
        tags=["Files"],
        responses={
            201: "File uploaded successfully.",
            400: (
                "- `no_file_uploaded` : No file was provided in the request.\n"
                "- `too_many_files` : Only one file is allowed per request.\n"
                "- `filename_not_exists_error` : The uploaded file has no filename."
            ),
            413: "`file_too_large` : File size exceeded.",
            415: "`unsupported_file_type` : File type not allowed.",
        },
    )
    @service_api_ns.doc("upload_file")
    @service_api_ns.doc(description="Upload a file for use in conversations")
    @service_api_ns.doc(consumes=["multipart/form-data"], params=multipart_file_params(include_user=True))
    @service_api_ns.doc(
        responses={
            201: "File uploaded successfully",
            400: "Bad request - no file or invalid file",
            401: "Unauthorized - invalid API token",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.FORM))  # type: ignore
    @service_api_ns.response(HTTPStatus.CREATED, "File uploaded", service_api_ns.models[FileResponse.__name__])
    def post(self, app_model: App, end_user: EndUser):
        """Upload a file for use in conversations.

        Accepts a single file upload via multipart/form-data.
        """
        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        file = request.files["file"]
        if not file.mimetype:
            raise UnsupportedFileTypeError()

        if not file.filename:
            raise FilenameNotExistsError

        try:
            upload_file = FileService(db.engine).upload_file(
                filename=file.filename,
                content=file.stream.read(),
                mimetype=file.mimetype,
                user=end_user,
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        response = FileResponse.model_validate(upload_file, from_attributes=True)
        return response.model_dump(mode="json"), 201
