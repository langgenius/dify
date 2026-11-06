from types import ModuleType

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


def _register_controllers() -> tuple[ModuleType, ...]:
    """Load route modules after their namespaces and schema models exist."""

    from . import appdeploy_files, plugin_file_upload, tool_files, upload_file_delivery

    return (
        appdeploy_files,
        plugin_file_upload,
        tool_files,
        upload_file_delivery,
    )


(
    appdeploy_files,
    plugin_file_upload,
    tool_files,
    upload_file_delivery,
) = _register_controllers()

api.add_namespace(files_ns)

__all__ = [
    "api",
    "appdeploy_files",
    "bp",
    "files_ns",
    "plugin_file_upload",
    "tool_files",
    "upload_file_delivery",
]
