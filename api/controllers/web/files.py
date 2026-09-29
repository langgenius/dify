from flask import request

import services
from controllers.common.errors import (
    BlockedFileExtensionError,
    FilenameNotExistsError,
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.common.schema import JsonResponseWithStatus, register_response_schema_models
from controllers.web import web_ns
from controllers.web.wraps import WebApiResource
from extensions.ext_application_services import application_services
from fields.file_fields import FileResponse
from libs.helper import dump_response
from models.model import App, EndUser

register_response_schema_models(web_ns, FileResponse)


@web_ns.route("/files/upload")
class FileApi(WebApiResource):
    @web_ns.doc("upload_file")
    @web_ns.doc(description="Upload a file for use in web applications")
    @web_ns.doc(
        responses={
            201: "File uploaded successfully",
            400: (
                "- `no_file_uploaded` : No file was provided in the request.\n"
                "- `too_many_files` : Only one file is allowed per request.\n"
                "- `filename_not_exists_error` : The uploaded file has no filename.\n"
                "- `file_extension_blocked` : The file extension is blocked for security reasons."
            ),
            413: "`file_too_large` : File size exceeded.",
            415: "`unsupported_file_type` : File type not allowed.",
        }
    )
    @web_ns.response(201, "File uploaded successfully", web_ns.models[FileResponse.__name__])
    def post(self, app_model: App, end_user: EndUser) -> JsonResponseWithStatus:
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
            BlockedFileExtensionError: File extension is blocked
        """
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        file = request.files["file"]
        if not file.filename:
            raise FilenameNotExistsError()

        source = request.form.get("source")
        if source not in ("datasets", None):
            source = None

        try:
            upload_file = application_services().files.upload_file(
                filename=file.filename,
                content=file.stream.read(),
                mimetype=file.mimetype,
                user=end_user,
                source="datasets" if source == "datasets" else None,
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description) from file_too_large_error
        except services.errors.file.UnsupportedFileTypeError as unsupported_file_type_error:
            raise UnsupportedFileTypeError() from unsupported_file_type_error
        except services.errors.file.BlockedFileExtensionError as blocked_file_extension_error:
            raise BlockedFileExtensionError() from blocked_file_extension_error

        return dump_response(FileResponse, upload_file), 201
