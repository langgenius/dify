from flask import Blueprint

from libs.external_api import ExternalApi

from .files import FileApi
from .remote_files import RemoteFileInfoApi, RemoteFileUploadApi

bp = Blueprint("web", __name__, url_prefix="/api")
api = ExternalApi(bp)

# Files
api.add_resource(FileApi, "/files/upload")

# Remote files
api.add_resource(RemoteFileInfoApi, "/remote-files/<path:url>")
api.add_resource(RemoteFileUploadApi, "/remote-files/upload")

from . import app, audio, completion, conversation, feature, message, passport, saved_message, site, workflow
