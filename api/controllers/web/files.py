from flask import request

import services
from controllers.common.errors import (
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import register_schema_models
from controllers.web import web_ns
from controllers.web.wraps import WebApiResource
from extensions.ext_database import db
from fields.file_fields import FileResponse
from services.file_service import FileService

register_schema_models(web_ns, FileResponse)


@web_ns.route("/files/upload")
class FileApi(WebApiResource):
    @web_ns.doc("upload_file")
    @web_ns.doc(description="Upload a file for use in web applications")
    @web_ns.doc(
        responses={
            201: "File uploaded successfully",
            400: "Bad request - invalid file or parameters",
            413: "File too large",
            415: "Unsupported file type",
        }
    )
    @web_ns.response(201, "File uploaded successfully", web_ns.models[FileResponse.__name__])
    def post(self, app_model, end_user):
        """Upload a file for use in web applications.

        Accepts file uploads for use within web applications, supporting
        multiple file types with automatic validation and storage.

        Args:
            app_model: The associated application model
            end_user: The end user uploading the file

        Form Parameters:
            file: The file to upload (required)
            source: Optional source type (datasets or None)

        Returns:
            dict: File information including ID, URL, and metadata
            int: HTTP status code 201 for success

        Raises:
            NoFileUploadedError: No file provided in request
            TooManyFilesError: Multiple files provided (only one allowed)
            FilenameNotExistsError: File has no filename
            FileTooLargeError: File exceeds size limit
            UnsupportedFileTypeError: File type not supported
        """
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        file = request.files["file"]
        if not file.filename:
            raise FilenameNotExistsError

        source = request.form.get("source")
        if source not in ("datasets", None):
            source = None

        try:
            upload_file = FileService(db.engine).upload_file(
                filename=file.filename,
                content=file.read(),
                mimetype=file.mimetype,
                user=end_user,
                source="datasets" if source == "datasets" else None,
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        response = FileResponse.model_validate(upload_file, from_attributes=True)
        return response.model_dump(mode="json"), 201
