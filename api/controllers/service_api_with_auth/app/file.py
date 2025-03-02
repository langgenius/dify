import services
from controllers.common.errors import FilenameNotExistsError
from controllers.service_api_with_auth import api
from controllers.service_api_with_auth.app.error import (
    FileTooLargeError,
    NoFileUploadedError,
    TooManyFilesError,
    UnsupportedFileTypeError,
)
from controllers.service_api_with_auth.wraps import FetchUserArg, WhereisUserArg, validate_user_token_and_extract_info
from fields.file_fields import file_fields
from flask import request
from flask_restful import Resource, marshal_with  # type: ignore
from models.model import App, EndUser
from services.file_service import FileService


class FileApi(Resource):
    @validate_user_token_and_extract_info
    @marshal_with(file_fields)
    def post(self, app_model: App, end_user: EndUser):
        """Upload a file.
        ---
        tags:
          - service/file
        summary: Upload file
        description: Upload a file to be used with the application
        security:
          - ApiKeyAuth: []
        consumes:
          - multipart/form-data
        parameters:
          - name: file
            in: formData
            required: true
            type: file
            description: The file to upload
        responses:
          201:
            description: File uploaded successfully
            schema:
              type: object
              properties:
                id:
                  type: string
                name:
                  type: string
                size:
                  type: integer
                extension:
                  type: string
                mime_type:
                  type: string
                url:
                  type: string
                created_at:
                  type: string
                  format: date-time
          400:
            description: Invalid request, no file uploaded, unsupported file type, or too many files
          401:
            description: Invalid or missing token
          413:
            description: File too large
        """
        file = request.files["file"]

        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if not file.mimetype:
            raise UnsupportedFileTypeError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        if not file.filename:
            raise FilenameNotExistsError

        try:
            upload_file = FileService.upload_file(
                filename=file.filename,
                content=file.read(),
                mimetype=file.mimetype,
                user=end_user,
            )
        except services.errors.file.FileTooLargeError as file_too_large_error:
            raise FileTooLargeError(file_too_large_error.description)
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return upload_file, 201


api.add_resource(FileApi, "/files/upload")
