from flask import Blueprint

from libs.external_api import ExternalApi

bp = Blueprint('stock', __name__, url_prefix='/stock')
api = ExternalApi(bp)


from . import index
from .app import app