from flask import Blueprint
from libs.external_api import ExternalApi

bp = Blueprint("inner_tools", __name__, url_prefix="/inner_tools")
api = ExternalApi(bp)

from . import markdown_to_pdf
