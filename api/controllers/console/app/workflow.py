from flask_restful import Resource, reqparse

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
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument('app_mode', type=str, required=True, nullable=False,
                            choices=[AppMode.CHAT.value, AppMode.WORKFLOW.value], location='args')
        args = parser.parse_args()

        app_mode = args.get('app_mode')
        app_mode = AppMode.value_of(app_mode)

        # TODO: implement this

        return {
            "blocks": []
        }


api.add_resource(DefaultBlockConfigApi, '/default-workflow-block-configs')
