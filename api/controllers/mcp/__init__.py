from flask import Blueprint

from libs.external_api import ExternalApi

bp = Blueprint("mcp", __name__, url_prefix="/mcp")
api = ExternalApi(bp)

from . import mcp
