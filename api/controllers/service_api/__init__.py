# -*- coding:utf-8 -*-
from flask import Blueprint

from libs.external_api import ExternalApi

bp = Blueprint('service_api', __name__, url_prefix='/v1')
api = ExternalApi(bp)


from .app import completion, app, conversation, message, audio

from .dataset import document
