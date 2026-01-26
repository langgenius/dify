from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("files", __name__, url_prefix="/files")

api = ExternalApi(
    bp,
    version="1.0",
    title="Files API",
    description="API for file operations including upload and preview",
)

files_ns = Namespace("files", description="File operations", path="/")

from . import (
    app_assets_download,
    app_assets_upload,
    image_preview,
    sandbox_archive,
    sandbox_file_downloads,
    storage_download,
    tool_files,
    upload,
)

api.add_namespace(files_ns)

__all__ = [
    "api",
    "app_assets_download",
    "app_assets_upload",
    "bp",
    "files_ns",
    "image_preview",
    "sandbox_archive",
    "sandbox_file_downloads",
    "storage_download",
    "tool_files",
    "upload",
]
