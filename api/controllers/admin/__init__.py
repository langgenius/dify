from flask import Blueprint

from libs.external_api import ExternalApi

bp = Blueprint("admin_api", __name__, url_prefix="/admin")
api = ExternalApi(bp)

from .auth import login