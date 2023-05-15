# -*- coding:utf-8 -*-
import json

from flask import request
from flask_restful import Resource
from flask_login import login_required, current_user

from controllers.console import api
from controllers.console.app import _get_app
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from events.app_event import app_model_config_was_updated
from extensions.ext_database import db
from models.model import AppModelConfig
from services.app_model_config_service import AppModelConfigService


class ModelConfigResource(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id):
        """Modify app model config"""
        app_id = str(app_id)

        app_model = _get_app(app_id)

        # validate config
        model_configuration = AppModelConfigService.validate_configuration(
            account=current_user,
            config=request.json,
            mode=app_model.mode
        )

        new_app_model_config = AppModelConfig(
            app_id=app_model.id,
            provider="",
            model_id="",
            configs={},
            opening_statement=model_configuration['opening_statement'],
            suggested_questions=json.dumps(model_configuration['suggested_questions']),
            suggested_questions_after_answer=json.dumps(model_configuration['suggested_questions_after_answer']),
            more_like_this=json.dumps(model_configuration['more_like_this']),
            model=json.dumps(model_configuration['model']),
            user_input_form=json.dumps(model_configuration['user_input_form']),
            pre_prompt=model_configuration['pre_prompt'],
            agent_mode=json.dumps(model_configuration['agent_mode']),
        )

        db.session.add(new_app_model_config)
        db.session.flush()

        app_model.app_model_config_id = new_app_model_config.id
        db.session.commit()

        app_model_config_was_updated.send(
            app_model,
            app_model_config=new_app_model_config
        )

        return {'result': 'success'}


api.add_resource(ModelConfigResource, '/apps/<uuid:app_id>/model-config')
