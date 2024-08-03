from flask import Blueprint

from libs.external_api import ExternalApi

bp = Blueprint('webhook', __name__, url_prefix='/webhook')
api = ExternalApi(bp)

print("webhook registered --------")
from . import stripe
