from flask import Blueprint

from libs.external_api import ExternalApi

from .plugin import plugin
from .workspace import workspace

bp = Blueprint("inner_api", __name__, url_prefix="/inner/api")
api = ExternalApi(bp)
