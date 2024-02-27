import json
import logging
from datetime import datetime
from typing import cast

import yaml
from flask_login import current_user
from flask_restful import Resource, abort, inputs, marshal_with, reqparse
from werkzeug.exceptions import Forbidden

from constants.languages import languages
from constants.model_template import default_app_templates
from controllers.console import api
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.app.wraps import get_app_model
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType, ModelPropertyKey
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
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
from models.model import App, AppModelConfig, Site, AppMode
from services.app_model_config_service import AppModelConfigService
from services.workflow_service import WorkflowService
from core.tools.utils.configuration import ToolParameterConfigurationManager
from core.tools.tool_manager import ToolManager
from core.entities.application_entities import AgentToolEntity


ALLOW_CREATE_APP_MODES = ['chat', 'agent-chat', 'advanced-chat', 'workflow']


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
        parser.add_argument('mode', type=str, choices=['chat', 'workflow', 'agent', 'channel', 'all'], default='all', location='args', required=False)
        parser.add_argument('name', type=str, location='args', required=False)
        args = parser.parse_args()

        filters = [
            App.tenant_id == current_user.current_tenant_id,
            App.is_universal == False
        ]

        if args['mode'] == 'workflow':
            filters.append(App.mode.in_([AppMode.WORKFLOW.value, AppMode.COMPLETION.value]))
        elif args['mode'] == 'chat':
            filters.append(App.mode.in_([AppMode.CHAT.value, AppMode.ADVANCED_CHAT.value]))
        elif args['mode'] == 'agent':
            filters.append(App.mode == AppMode.AGENT_CHAT.value)
        elif args['mode'] == 'channel':
            filters.append(App.mode == AppMode.CHANNEL.value)
        else:
            pass

        if 'name' in args and args['name']:
            name = args['name'][:30]
            filters.append(App.name.ilike(f'%{name}%'))

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
        parser.add_argument('mode', type=str, choices=ALLOW_CREATE_APP_MODES, location='json')
        parser.add_argument('icon', type=str, location='json')
        parser.add_argument('icon_background', type=str, location='json')
        args = parser.parse_args()

        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        # TODO: MOVE TO IMPORT API
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

            app_mode = AppMode.value_of(args['mode'])

            app_template = default_app_templates[app_mode]

            # get model config
            default_model_config = app_template['model_config']
            if 'model' in default_model_config:
                # get model provider
                model_manager = ModelManager()

                # get default model instance
                try:
                    model_instance = model_manager.get_default_model_instance(
                        tenant_id=current_user.current_tenant_id,
                        model_type=ModelType.LLM
                    )
                except ProviderTokenNotInitError:
                    model_instance = None

                if model_instance:
                    if model_instance.model == default_model_config['model']['name']:
                        default_model_dict = default_model_config['model']
                    else:
                        llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
                        model_schema = llm_model.get_model_schema(model_instance.model, model_instance.credentials)

                        default_model_dict = {
                            'provider': model_instance.provider,
                            'name': model_instance.model,
                            'mode': model_schema.model_properties.get(ModelPropertyKey.MODE),
                            'completion_params': {}
                        }
                else:
                    default_model_dict = default_model_config['model']

                default_model_config['model'] = json.dumps(default_model_dict)

            app = App(**app_template['app'])
            app_model_config = AppModelConfig(**default_model_config)

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


class AppImportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields)
    @cloud_edition_billing_resource_check('apps')
    def post(self):
        """Import app"""
        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument('data', type=str, required=True, nullable=False, location='json')
        parser.add_argument('name', type=str, location='json')
        parser.add_argument('icon', type=str, location='json')
        parser.add_argument('icon_background', type=str, location='json')
        args = parser.parse_args()

        try:
            import_data = yaml.safe_load(args['data'])
        except yaml.YAMLError as e:
            raise ValueError("Invalid YAML format in data argument.")

        app_data = import_data.get('app')
        model_config_data = import_data.get('model_config')
        workflow_graph = import_data.get('workflow_graph')

        if not app_data or not model_config_data:
            raise ValueError("Missing app or model_config in data argument")

        app_mode = AppMode.value_of(app_data.get('mode'))
        if app_mode in [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW]:
            if not workflow_graph:
                raise ValueError("Missing workflow_graph in data argument "
                                 "when mode is advanced-chat or workflow")

        app = App(
            enable_site=True,
            enable_api=True,
            is_demo=False,
            api_rpm=0,
            api_rph=0,
            status='normal'
        )

        app.tenant_id = current_user.current_tenant_id
        app.mode = app_data.get('mode')
        app.name = args.get("name") if args.get("name") else app_data.get('name')
        app.icon = args.get("icon") if args.get("icon") else app_data.get('icon')
        app.icon_background = args.get("icon_background") if args.get("icon_background") \
            else app_data.get('icon_background')

        db.session.add(app)
        db.session.commit()

        if workflow_graph:
            workflow_service = WorkflowService()
            draft_workflow = workflow_service.sync_draft_workflow(app, workflow_graph, current_user)
            published_workflow = workflow_service.publish_draft_workflow(app, current_user, draft_workflow)
            model_config_data['workflow_id'] = published_workflow.id

        app_model_config = AppModelConfig()
        app_model_config = app_model_config.from_model_config_dict(model_config_data)
        app_model_config.app_id = app.id

        db.session.add(app_model_config)
        db.session.commit()

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


class AppApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields_with_site)
    def get(self, app_model):
        """Get app detail"""
        # get original app model config
        model_config: AppModelConfig = app_model.app_model_config
        agent_mode = model_config.agent_mode_dict
        # decrypt agent tool parameters if it's secret-input
        for tool in agent_mode.get('tools') or []:
            agent_tool_entity = AgentToolEntity(**tool)
            # get tool
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

        # override agent mode
        model_config.agent_mode = json.dumps(agent_mode)

        return app_model

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def delete(self, app_model):
        """Delete app"""
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        db.session.delete(app_model)
        db.session.commit()

        # todo delete related data??
        # model_config, site, api_token, conversation, message, message_feedback, message_annotation

        app_was_deleted.send(app_model)

        return {'result': 'success'}, 204


class AppExportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model):
        """Export app"""
        app_model_config = app_model.app_model_config

        export_data = {
            "app": {
                "name": app_model.name,
                "mode": app_model.mode,
                "icon": app_model.icon,
                "icon_background": app_model.icon_background
            },
            "model_config": app_model_config.to_dict(),
        }

        if app_model_config.workflow_id:
            export_data['workflow_graph'] = json.loads(app_model_config.workflow.graph)
        else:
            # get draft workflow
            workflow_service = WorkflowService()
            workflow = workflow_service.get_draft_workflow(app_model)
            export_data['workflow_graph'] = json.loads(workflow.graph)

        return {
            "data": yaml.dump(export_data)
        }


class AppNameApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    def post(self, app_model):
        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=True, location='json')
        args = parser.parse_args()

        app_model.name = args.get('name')
        app_model.updated_at = datetime.utcnow()
        db.session.commit()
        return app_model


class AppIconApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    def post(self, app_model):
        parser = reqparse.RequestParser()
        parser.add_argument('icon', type=str, location='json')
        parser.add_argument('icon_background', type=str, location='json')
        args = parser.parse_args()

        app_model.icon = args.get('icon')
        app_model.icon_background = args.get('icon_background')
        app_model.updated_at = datetime.utcnow()
        db.session.commit()

        return app_model


class AppSiteStatus(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    def post(self, app_model):
        parser = reqparse.RequestParser()
        parser.add_argument('enable_site', type=bool, required=True, location='json')
        args = parser.parse_args()

        if args.get('enable_site') == app_model.enable_site:
            return app_model

        app_model.enable_site = args.get('enable_site')
        app_model.updated_at = datetime.utcnow()
        db.session.commit()
        return app_model


class AppApiStatus(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields)
    def post(self, app_model):
        parser = reqparse.RequestParser()
        parser.add_argument('enable_api', type=bool, required=True, location='json')
        args = parser.parse_args()

        if args.get('enable_api') == app_model.enable_api:
            return app_model

        app_model.enable_api = args.get('enable_api')
        app_model.updated_at = datetime.utcnow()
        db.session.commit()
        return app_model


api.add_resource(AppListApi, '/apps')
api.add_resource(AppImportApi, '/apps/import')
api.add_resource(AppApi, '/apps/<uuid:app_id>')
api.add_resource(AppExportApi, '/apps/<uuid:app_id>/export')
api.add_resource(AppNameApi, '/apps/<uuid:app_id>/name')
api.add_resource(AppIconApi, '/apps/<uuid:app_id>/icon')
api.add_resource(AppSiteStatus, '/apps/<uuid:app_id>/site-enable')
api.add_resource(AppApiStatus, '/apps/<uuid:app_id>/api-enable')
