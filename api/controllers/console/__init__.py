from flask import Blueprint

from libs.external_api import ExternalApi

bp = Blueprint('console', __name__, url_prefix='/console/api')
api = ExternalApi(bp)

# Import other controllers
from . import setup, version, apikey, admin

# Import app controllers
from .app import app, site, completion, model_config, statistic, conversation, message, generator

# Import auth controllers
from .auth import login, oauth, data_source_oauth

# Import datasets controllers
from .datasets import datasets, datasets_document, datasets_segments, file, hit_testing, data_source

# Import workspace controllers
from .workspace import workspace, members, providers, account

# Import explore controllers
from .explore import installed_app, recommended_app, completion, conversation, message, parameter, saved_message
