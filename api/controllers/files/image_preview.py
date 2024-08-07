from flask import Response, request
from flask_restful import Resource
from werkzeug.exceptions import NotFound

import services
from controllers.files import api
from libs.exception import BaseHTTPException
from services.account_service import TenantService
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
    

class WorkspaceWebappLogoApi(Resource):
    def get(self, workspace_id):
        workspace_id = str(workspace_id)

        custom_config = TenantService.get_custom_config(workspace_id)
        webapp_logo_file_id = custom_config.get('replace_webapp_logo') if custom_config is not None else None

        if not webapp_logo_file_id:
            raise NotFound('webapp logo is not found')

        try:
            generator, mimetype = FileService.get_public_image_preview(
                webapp_logo_file_id,
            )
        except services.errors.file.UnsupportedFileTypeError:
            raise UnsupportedFileTypeError()

        return Response(generator, mimetype=mimetype)


api.add_resource(ImagePreviewApi, '/files/<uuid:file_id>/image-preview')
api.add_resource(WorkspaceWebappLogoApi, '/files/workspaces/<uuid:workspace_id>/webapp-logo')


class UnsupportedFileTypeError(BaseHTTPException):
    error_code = 'unsupported_file_type'
    description = "File type not allowed."
    code = 415
