from flask import Blueprint

from libs.external_api import ExternalApi

from . import image_preview, tool_files, upload

bp = Blueprint("files", __name__)
api = ExternalApi(bp)
