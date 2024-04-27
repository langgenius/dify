from flask import Blueprint

from libs.flask_restx_external_api import FlaskRestxExternalApi

from .app import api as app_ns
from .dataset import api as dataset_ns

bp = Blueprint('service_api', __name__, url_prefix='/v1')
api = FlaskRestxExternalApi(bp, doc='/docs/', title='Dify OpenAPI', version='1.0', description='Dify OpenAPI')
api.add_namespace(app_ns)
api.add_namespace(dataset_ns)

from .app import app, audio, completion, conversation, file, message, workflow
from .dataset import dataset, document, segment
