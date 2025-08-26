from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("files", __name__, url_prefix="/files")

api = ExternalApi(
    bp,
    version="1.0",
    title="Files API",
    description="API for file operations including upload and preview",
    doc="/docs",  # Enable Swagger UI at /files/docs
)

files_ns = Namespace("files", description="File operations", path="/")

from . import image_preview, tool_files, upload

api.add_namespace(files_ns)
