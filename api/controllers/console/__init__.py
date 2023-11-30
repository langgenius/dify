from flask import Blueprint

from libs.external_api import ExternalApi

bp = Blueprint('console', __name__, url_prefix='/console/api')
api = ExternalApi(bp)

# Import other controllers
from . import extension, setup, version, apikey, admin

# Import app controllers
from .app import advanced_prompt_template, app, site, completion, model_config, statistic, conversation, message, generator, audio

# Import auth controllers
from .auth import login, oauth, data_source_oauth, activate

# Import datasets controllers
from .datasets import datasets, datasets_document, datasets_segments, file, hit_testing, data_source

# Import workspace controllers
from .workspace import workspace, members, providers, model_providers, account, tool_providers, models

# Import explore controllers
from .explore import installed_app, recommended_app, completion, conversation, message, parameter, saved_message, audio

# Import universal chat controllers
from .universal_chat import chat, conversation, message, parameter, audio

# Import webhook controllers
from .webhook import stripe

from .billing import billing
