from flask import Blueprint
from flask_restx import Api

from .webhook_controller import ns as webhook_ns

bp = Blueprint('webhook', __name__, url_prefix='/webhooks')
api = Api(bp, version='1.0', title='Webhook API', description='Webhook API')
api.add_namespace(webhook_ns, path='')
