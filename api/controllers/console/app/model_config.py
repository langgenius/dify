
from flask import request
from flask_login import current_user
from flask_restful import Resource

from controllers.console import api
from controllers.console.app import _get_app
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from events.app_event import app_model_config_was_updated
from extensions.ext_database import db
from libs.login import login_required
from models.model import AppModelConfig
from services.app_model_config_service import AppModelConfigService


class ModelConfigResource(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id):
        """Modify app model config"""
        app_id = str(app_id)

        app = _get_app(app_id)

        # validate config
        model_configuration = AppModelConfigService.validate_configuration(
            tenant_id=current_user.current_tenant_id,
            account=current_user,
            config=request.json,
            app_mode=app.mode
        )

        new_app_model_config = AppModelConfig(
            app_id=app.id,
        )
        new_app_model_config = new_app_model_config.from_model_config_dict(model_configuration)

        db.session.add(new_app_model_config)
        db.session.flush()

        app.app_model_config_id = new_app_model_config.id
        db.session.commit()

        app_model_config_was_updated.send(
            app,
            app_model_config=new_app_model_config
        )

        return {'result': 'success'}


api.add_resource(ModelConfigResource, '/apps/<uuid:app_id>/model-config')
