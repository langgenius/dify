import services
from controllers.files import api
from flask import Response, request
from flask_restful import Resource
from libs.exception import BaseHTTPException
from services.account_service import TenantService
from services.file_service import FileService
from werkzeug.exceptions import NotFound

from core.tools.tool_file_manager import ToolFileManager

class ImagePreviewApi(Resource):
    def get(self, file_id, extension):
        file_id = str(file_id)

        try:
            result = ToolFileManager.get_file_generator(
                file_id,
            )

            if not result:
                raise NotFound(f'file is not found')
            
            generator, mimetype = result
        except Exception:
            raise UnsupportedFileTypeError()

        return Response(generator, mimetype=mimetype)

api.add_resource(ImagePreviewApi, '/files/tools/<uuid:file_id>.<string:extension>')

class UnsupportedFileTypeError(BaseHTTPException):
    error_code = 'unsupported_file_type'
    description = "File type not allowed."
    code = 415
