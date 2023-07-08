# -*- coding:utf-8 -*-
from flask import Blueprint

from libs.external_api import ExternalApi

bp = Blueprint('web', __name__, url_prefix='/api')
api = ExternalApi(bp)


from . import completion, app, conversation, message, site, saved_message, audio, passport
