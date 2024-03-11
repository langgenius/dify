import json
import logging
from datetime import datetime

from flask_login import current_user
from flask_restful import Resource, abort, inputs, marshal_with, reqparse
from werkzeug.exceptions import Forbidden

from constants.languages import demo_model_templates, languages
from constants.model_template import model_templates
from controllers.console import api
from controllers.console.app.error import AppNotFoundError, ProviderNotInitializeError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.provider_manager import ProviderManager
from events.app_event import app_was_created, app_was_deleted
from extensions.ext_database import db
from fields.app_fields import (
    app_detail_fields,
    app_detail_fields_with_site,
    app_pagination_fields,
    template_list_fields,
)
from libs.login import login_required
from models.model import App, AppModelConfig, Site
from services.app_model_config_service import AppModelConfigService
from core.tools.utils.configuration import ToolParameterConfigurationManager
from core.tools.tool_manager import ToolManager
from core.entities.application_entities import AgentToolEntity

def _get_app(app_id, tenant_id):
    app = db.session.query(App).filter(App.id == app_id, App.tenant_id == tenant_id).first()
    if not app:
        raise AppNotFoundError
    return app


class AppListApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_pagination_fields)
    def get(self):
        """Get app list"""
        parser = reqparse.RequestParser()
        parser.add_argument('page', type=inputs.int_range(1, 99999), required=False, default=1, location='args')
        parser.add_argument('limit', type=inputs.int_range(1, 100), required=False, default=20, location='args')
        parser.add_argument('mode', type=str, choices=['chat', 'completion', 'all'], default='all', location='args', required=False)
        parser.add_argument('name', type=str, location='args', required=False)
        args = parser.parse_args()

        filters = [
            App.tenant_id == current_user.current_tenant_id,
            App.is_universal == False
        ]

        if args['mode'] == 'completion':
            filters.append(App.mode == 'completion')
        elif args['mode'] == 'chat':
            filters.append(App.mode == 'chat')
        else:
            pass

        if 'name' in args and args['name']:
            filters.append(App.name.ilike(f'%{args["name"]}%'))

        app_models = db.paginate(
            db.select(App).where(*filters).order_by(App.created_at.desc()),
            page=args['page'],
            per_page=args['limit'],
            error_out=False
        )

        return app_models

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields)
    @cloud_edition_billing_resource_check('apps')
    def post(self):
        """Create app"""
        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=True, location='json')
        parser.add_argument('mode', type=str, choices=['completion', 'chat', 'assistant'], location='json')
        parser.add_argument('icon', type=str, location='json')
        parser.add_argument('icon_background', type=str, location='json')
        parser.add_argument('model_config', type=dict, location='json')
        args = parser.parse_args()

        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        try:
            provider_manager = ProviderManager()
            default_model_entity = provider_manager.get_default_model(
                tenant_id=current_user.current_tenant_id,
                model_type=ModelType.LLM
            )
        except (ProviderTokenNotInitError, LLMBadRequestError):
            default_model_entity = None
        except Exception as e:
            logging.exception(e)
            default_model_entity = None

        if args['model_config'] is not None:
            # validate config
            model_config_dict = args['model_config']

            # Get provider configurations
            provider_manager = ProviderManager()
            provider_configurations = provider_manager.get_configurations(current_user.current_tenant_id)

            # get available models from provider_configurations
            available_models = provider_configurations.get_models(
                model_type=ModelType.LLM,
                only_active=True
            )

            # check if model is available
            available_models_names = [f'{model.provider.provider}.{model.model}' for model in available_models]
            provider_model = f"{model_config_dict['model']['provider']}.{model_config_dict['model']['name']}"
            if provider_model not in available_models_names:
                if not default_model_entity:
                    raise ProviderNotInitializeError(
                        "No Default System Reasoning Model available. Please configure "
                        "in the Settings -> Model Provider.")
                else:
                    model_config_dict["model"]["provider"] = default_model_entity.provider.provider
                    model_config_dict["model"]["name"] = default_model_entity.model

            model_configuration = AppModelConfigService.validate_configuration(
                tenant_id=current_user.current_tenant_id,
                account=current_user,
                config=model_config_dict,
                app_mode=args['mode']
            )

            app = App(
                enable_site=True,
                enable_api=True,
                is_demo=False,
                api_rpm=0,
                api_rph=0,
                status='normal'
            )

            app_model_config = AppModelConfig()
            app_model_config = app_model_config.from_model_config_dict(model_configuration)
        else:
            if 'mode' not in args or args['mode'] is None:
                abort(400, message="mode is required")

            model_config_template = model_templates[args['mode'] + '_default']

            app = App(**model_config_template['app'])
            app_model_config = AppModelConfig(**model_config_template['model_config'])

            # get model provider
            model_manager = ModelManager()

            try:
                model_instance = model_manager.get_default_model_instance(
                    tenant_id=current_user.current_tenant_id,
                    model_type=ModelType.LLM
                )
            except ProviderTokenNotInitError:
                model_instance = None

            if model_instance:
                model_dict = app_model_config.model_dict
                model_dict['provider'] = model_instance.provider
                model_dict['name'] = model_instance.model
                app_model_config.model = json.dumps(model_dict)

        app.name = args['name']
        app.mode = args['mode']
        app.icon = args['icon']
        app.icon_background = args['icon_background']
        app.tenant_id = current_user.current_tenant_id

        db.session.add(app)
        db.session.flush()

        app_model_config.app_id = app.id
        db.session.add(app_model_config)
        db.session.flush()

        app.app_model_config_id = app_model_config.id

        account = current_user

        site = Site(
            app_id=app.id,
            title=app.name,
            default_language=account.interface_language,
            customize_token_strategy='not_allow',
            code=Site.generate_code(16)
        )

        db.session.add(site)
        db.session.commit()

        app_was_created.send(app)

        return app, 201
    

class AppTemplateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(template_list_fields)
    def get(self):
        """Get app demo templates"""
        account = current_user
        interface_language = account.interface_language

        templates = demo_model_templates.get(interface_language)
        if not templates:
            templates = demo_model_templates.get(languages[0])

        return {'data': templates}


class AppApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields_with_site)
    def get(self, app_id):
        """Get app detail"""
        app_id = str(app_id)
        app: App = _get_app(app_id, current_user.current_tenant_id)

        # get original app model config
        model_config: AppModelConfig = app.app_model_config
        agent_mode = model_config.agent_mode_dict
        # decrypt agent tool parameters if it's secret-input
        for tool in agent_mode.get('tools') or []:
            agent_tool_entity = AgentToolEntity(**tool)
            # get tool
            try:
                tool_runtime = ToolManager.get_agent_tool_runtime(
                    tenant_id=current_user.current_tenant_id,
                    agent_tool=agent_tool_entity,
                    agent_callback=None
                )
                manager = ToolParameterConfigurationManager(
                    tenant_id=current_user.current_tenant_id,
                    tool_runtime=tool_runtime,
                    provider_name=agent_tool_entity.provider_id,
                    provider_type=agent_tool_entity.provider_type,
                )

                # get decrypted parameters
                if agent_tool_entity.tool_parameters:
                    parameters = manager.decrypt_tool_parameters(agent_tool_entity.tool_parameters or {})
                    masked_parameter = manager.mask_tool_parameters(parameters or {})
                else:
                    masked_parameter = {}

                # override tool parameters
                tool['tool_parameters'] = masked_parameter
            except Exception as e:
                pass

        # override agent mode
        model_config.agent_mode = json.dumps(agent_mode)

        return app

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, app_id):
        """Delete app"""
        app_id = str(app_id)

        if not current_user.is_admin_or_owner:
            raise Forbidden()

        app = _get_app(app_id, current_user.current_tenant_id)

        db.session.delete(app)
        db.session.commit()

        # todo delete related data??
        # model_config, site, api_token, conversation, message, message_feedback, message_annotation

        app_was_deleted.send(app)

        return {'result': 'success'}, 204


class AppNameApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields)
    def post(self, app_id):
        app_id = str(app_id)
        app = _get_app(app_id, current_user.current_tenant_id)

        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=True, location='json')
        args = parser.parse_args()

        app.name = args.get('name')
        app.updated_at = datetime.utcnow()
        db.session.commit()
        return app


class AppIconApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields)
    def post(self, app_id):
        app_id = str(app_id)
        app = _get_app(app_id, current_user.current_tenant_id)

        parser = reqparse.RequestParser()
        parser.add_argument('icon', type=str, location='json')
        parser.add_argument('icon_background', type=str, location='json')
        args = parser.parse_args()

        app.icon = args.get('icon')
        app.icon_background = args.get('icon_background')
        app.updated_at = datetime.utcnow()
        db.session.commit()

        return app


class AppSiteStatus(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields)
    def post(self, app_id):
        parser = reqparse.RequestParser()
        parser.add_argument('enable_site', type=bool, required=True, location='json')
        args = parser.parse_args()
        app_id = str(app_id)
        app = db.session.query(App).filter(App.id == app_id, App.tenant_id == current_user.current_tenant_id).first()
        if not app:
            raise AppNotFoundError

        if args.get('enable_site') == app.enable_site:
            return app

        app.enable_site = args.get('enable_site')
        app.updated_at = datetime.utcnow()
        db.session.commit()
        return app


class AppApiStatus(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields)
    def post(self, app_id):
        parser = reqparse.RequestParser()
        parser.add_argument('enable_api', type=bool, required=True, location='json')
        args = parser.parse_args()

        app_id = str(app_id)
        app = _get_app(app_id, current_user.current_tenant_id)

        if args.get('enable_api') == app.enable_api:
            return app

        app.enable_api = args.get('enable_api')
        app.updated_at = datetime.utcnow()
        db.session.commit()
        return app


class AppCopy(Resource):
    @staticmethod
    def create_app_copy(app):
        copy_app = App(
            name=app.name + ' copy',
            icon=app.icon,
            icon_background=app.icon_background,
            tenant_id=app.tenant_id,
            mode=app.mode,
            app_model_config_id=app.app_model_config_id,
            enable_site=app.enable_site,
            enable_api=app.enable_api,
            api_rpm=app.api_rpm,
            api_rph=app.api_rph
        )
        return copy_app

    @staticmethod
    def create_app_model_config_copy(app_config, copy_app_id):
        copy_app_model_config = app_config.copy()
        copy_app_model_config.app_id = copy_app_id

        return copy_app_model_config

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields)
    def post(self, app_id):
        app_id = str(app_id)
        app = _get_app(app_id, current_user.current_tenant_id)

        copy_app = self.create_app_copy(app)
        db.session.add(copy_app)

        app_config = db.session.query(AppModelConfig). \
            filter(AppModelConfig.app_id == app_id). \
            one_or_none()

        if app_config:
            copy_app_model_config = self.create_app_model_config_copy(app_config, copy_app.id)
            db.session.add(copy_app_model_config)
            db.session.commit()
            copy_app.app_model_config_id = copy_app_model_config.id
        db.session.commit()

        return copy_app, 201


api.add_resource(AppListApi, '/apps')
api.add_resource(AppTemplateApi, '/app-templates')
api.add_resource(AppApi, '/apps/<uuid:app_id>')
api.add_resource(AppCopy, '/apps/<uuid:app_id>/copy')
api.add_resource(AppNameApi, '/apps/<uuid:app_id>/name')
api.add_resource(AppIconApi, '/apps/<uuid:app_id>/icon')
api.add_resource(AppSiteStatus, '/apps/<uuid:app_id>/site-enable')
api.add_resource(AppApiStatus, '/apps/<uuid:app_id>/api-enable')
