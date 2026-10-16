from flask import Blueprint
from flask_restx import Namespace

from controllers.common.app_access_error import register_app_access_error_metadata
from controllers.common.errors import InternalServerError, NotFoundError, UnauthorizedError
from controllers.console.error import NotInitValidateError, NotSetupError
from controllers.web.error import (
    WebAppAccessServiceUnavailableError,
    WebAppAuthAccessDeniedError,
    WebAppAuthRequiredError,
    WebAppNotFoundError,
)
from libs.external_api import ExternalApi

bp = Blueprint("web", __name__, url_prefix="/api")
register_app_access_error_metadata(bp, surface="web")

api = ExternalApi(
    bp,
    version="1.0",
    title="Web API",
    description="Public APIs for web applications including file uploads, chat interactions, and app management",
)
# The passport guard on every Web API resource raises these; the web client answers them
# centrally (sign-in redirect, access-denied and not-found pages), so no operation lists them.
# ``not_found``, ``unauthorized`` and ``internal_server_error`` are the codes Werkzeug's own
# exceptions already produce on every operation.
api.document_generic_errors(
    NotSetupError,
    NotInitValidateError,
    WebAppNotFoundError,
    WebAppAuthRequiredError,
    WebAppAuthAccessDeniedError,
    WebAppAccessServiceUnavailableError,
    NotFoundError,
    UnauthorizedError,
    InternalServerError,
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
    human_input_file_upload,
    human_input_form,
    login,
    message,
    passport,
    remote_files,
    saved_message,
    site,
    workflow,
    workflow_events,
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
    "human_input_file_upload",
    "human_input_form",
    "login",
    "message",
    "passport",
    "remote_files",
    "saved_message",
    "site",
    "web_ns",
    "workflow",
    "workflow_events",
]
