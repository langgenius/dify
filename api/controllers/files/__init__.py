# -*- coding:utf-8 -*-
from flask import Blueprint
from libs.external_api import ExternalApi

bp = Blueprint('files', __name__)
api = ExternalApi(bp)


from . import image_preview, tool_files
