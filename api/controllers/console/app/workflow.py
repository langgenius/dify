from flask_restful import Resource

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.entities.application_entities import AppMode
from libs.login import login_required


class DefaultBlockConfigApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.WORKFLOW])
    def post(self, app_model):
        return 'success', 200


api.add_resource(DefaultBlockConfigApi, '/apps/<uuid:app_id>/default-workflow-block-configs')
