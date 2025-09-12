from flask import Blueprint
from flask_restx import Namespace

from libs.external_api import ExternalApi

bp = Blueprint("web", __name__, url_prefix="/api")

api = ExternalApi(
    bp,
    version="1.0",
    title="Web API",
    description="Public APIs for web applications including file uploads, chat interactions, and app management",
)

# Create namespace
web_ns = Namespace("web", description="Web application API operations", path="/")

from . import (
    app,  # pyright: ignore[reportUnusedImport]
    audio,  # pyright: ignore[reportUnusedImport]
    completion,  # pyright: ignore[reportUnusedImport]
    conversation,  # pyright: ignore[reportUnusedImport]
    feature,  # pyright: ignore[reportUnusedImport]
    files,  # pyright: ignore[reportUnusedImport]
    forgot_password,  # pyright: ignore[reportUnusedImport]
    login,  # pyright: ignore[reportUnusedImport]
    message,  # pyright: ignore[reportUnusedImport]
    passport,  # pyright: ignore[reportUnusedImport]
    remote_files,  # pyright: ignore[reportUnusedImport]
    saved_message,  # pyright: ignore[reportUnusedImport]
    site,  # pyright: ignore[reportUnusedImport]
    workflow,  # pyright: ignore[reportUnusedImport]
)

api.add_namespace(web_ns)
