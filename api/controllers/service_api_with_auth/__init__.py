from flask import Blueprint
from libs.external_api import ExternalApi

bp = Blueprint("service_api_with_auth", __name__, url_prefix="/service")
api = ExternalApi(bp)

from .app import app, audio, completion, conversation, file, image, message, workflow
from .auth import login
from .user import profile
