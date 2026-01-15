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
    app,
    audio,
    completion,
    conversation,
    feature,
    files,
    forgot_password,
    login,
    message,
    passport,
    remote_files,
    saved_message,
    site,
    workflow,
)

api.add_namespace(web_ns)

__all__ = [
    "api",
    "app",
    "audio",
    "bp",
    "completion",
    "conversation",
    "feature",
    "files",
    "forgot_password",
    "login",
    "message",
    "passport",
    "remote_files",
    "saved_message",
    "site",
    "web_ns",
    "workflow",
]
