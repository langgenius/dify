from flask import Blueprint

from libs.external_api import ExternalApi

bp = Blueprint('console', __name__, url_prefix='/console/api')
api = ExternalApi(bp)

# Import other controllers
from . import admin, apikey, extension, feature, ping, setup, version

# Import app controllers
from .app import (
    advanced_prompt_template,
    agent,
    annotation,
    app,
    audio,
    completion,
    conversation,
    generator,
    message,
    model_config,
    site,
    statistic,
    workflow,
    workflow_app_log,
    workflow_run,
    workflow_statistic,
)

# Import auth controllers
from .auth import activate, data_source_oauth, login, oauth

# Import billing controllers
from .billing import billing

# Import datasets controllers
from .datasets import data_source, datasets, datasets_document, datasets_segments, file, hit_testing

# Import enterprise controllers
from .enterprise import enterprise_sso

# Import explore controllers
from .explore import (
    audio,
    completion,
    conversation,
    installed_app,
    message,
    parameter,
    recommended_app,
    saved_message,
    workflow,
)

# Import tag controllers
from .tag import tags

# Import workspace controllers
from .workspace import account, members, model_providers, models, tool_providers, workspace
