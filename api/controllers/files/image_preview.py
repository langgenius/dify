from flask import request, Response
from flask_restful import Resource

import services
from controllers.files import api
from libs.exception import BaseHTTPException
from services.file_service import FileService


class ImagePreviewApi(Resource):
    def get(self, file_id):
        file_id = str(file_id)

        timestamp = request.args.get('timestamp')
        nonce = request.args.get('nonce')
        sign = request.args.get('sign')

        if not timestamp or not nonce or not sign:
            return {'content': 'Invalid request.'}, 400

        try:
            generator, mimetype = FileService.get_image_preview(
                file_id,
                timestamp,
                nonce,
                sign
            )
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return Response(generator, mimetype=mimetype)


api.add_resource(ImagePreviewApi, '/files/<uuid:file_id>/image-preview')


class UnsupportedFileTypeError(BaseHTTPException):
    error_code = 'unsupported_file_type'
    description = "File type not allowed."
    code = 415
