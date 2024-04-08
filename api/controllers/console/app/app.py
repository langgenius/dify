import json

from flask_login import current_user
from flask_restful import Resource, inputs, marshal_with, reqparse
from werkzeug.exceptions import Forbidden, BadRequest

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from core.agent.entities import AgentToolEntity
from extensions.ext_database import db
from fields.app_fields import (
    app_detail_fields,
    app_detail_fields_with_site,
    app_pagination_fields,
)
from libs.login import login_required
from services.app_service import AppService
from models.model import App, AppModelConfig, AppMode
from core.tools.utils.configuration import ToolParameterConfigurationManager
from core.tools.tool_manager import ToolManager


ALLOW_CREATE_APP_MODES = ['chat', 'agent-chat', 'advanced-chat', 'workflow', 'completion']


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
        parser.add_argument('mode', type=str, choices=['chat', 'workflow', 'agent-chat', 'channel', 'all'], default='all', location='args', required=False)
        parser.add_argument('name', type=str, location='args', required=False)
        args = parser.parse_args()

        # get app list
        app_service = AppService()
        app_pagination = app_service.get_paginate_apps(current_user.current_tenant_id, args)

        return app_pagination

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields)
    @cloud_edition_billing_resource_check('apps')
    def post(self):
        """Create app"""
        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=True, location='json')
        parser.add_argument('description', type=str, location='json')
        parser.add_argument('mode', type=str, choices=ALLOW_CREATE_APP_MODES, location='json')
        parser.add_argument('icon', type=str, location='json')
        parser.add_argument('icon_background', type=str, location='json')
        args = parser.parse_args()

        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        if 'mode' not in args or args['mode'] is None:
            raise BadRequest("mode is required")

        app_service = AppService()
        app = app_service.create_app(current_user.current_tenant_id, args, current_user)

        return app, 201


class AppImportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_detail_fields_with_site)
    @cloud_edition_billing_resource_check('apps')
    def post(self):
        """Import app"""
        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument('data', type=str, required=True, nullable=False, location='json')
        parser.add_argument('name', type=str, location='json')
        parser.add_argument('description', type=str, location='json')
        parser.add_argument('icon', type=str, location='json')
        parser.add_argument('icon_background', type=str, location='json')
        args = parser.parse_args()

        app_service = AppService()
        app = app_service.import_app(current_user.current_tenant_id, args['data'], args, current_user)

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
        if app_model.mode == AppMode.AGENT_CHAT.value or app_model.is_agent:
            model_config: AppModelConfig = app_model.app_model_config
            agent_mode = model_config.agent_mode_dict
            # decrypt agent tool parameters if it's secret-input
            for tool in agent_mode.get('tools') or []:
                if not isinstance(tool, dict) or len(tool.keys()) <= 3:
                    continue
                agent_tool_entity = AgentToolEntity(**tool)
                # get tool
                try:
                    tool_runtime = ToolManager.get_agent_tool_runtime(
                        tenant_id=current_user.current_tenant_id,
                        agent_tool=agent_tool_entity,
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
            db.session.commit()

        return app_model

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields_with_site)
    def put(self, app_model):
        """Update app"""
        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=True, nullable=False, location='json')
        parser.add_argument('description', type=str, location='json')
        parser.add_argument('icon', type=str, location='json')
        parser.add_argument('icon_background', type=str, location='json')
        args = parser.parse_args()

        app_service = AppService()
        app_model = app_service.update_app(app_model, args)

        return app_model

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def delete(self, app_model):
        """Delete app"""
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        app_service = AppService()
        app_service.delete_app(app_model)

        return {'result': 'success'}, 204


class AppCopyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_detail_fields_with_site)
    def post(self, app_model):
        """Copy app"""
        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, location='json')
        parser.add_argument('description', type=str, location='json')
        parser.add_argument('icon', type=str, location='json')
        parser.add_argument('icon_background', type=str, location='json')
        args = parser.parse_args()

        app_service = AppService()
        data = app_service.export_app(app_model)
        app = app_service.import_app(current_user.current_tenant_id, data, args, current_user)

        return app, 201


class AppExportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def get(self, app_model):
        """Export app"""
        app_service = AppService()

        return {
            "data": app_service.export_app(app_model)
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

        app_service = AppService()
        app_model = app_service.update_app_name(app_model, args.get('name'))

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

        app_service = AppService()
        app_model = app_service.update_app_icon(app_model, args.get('icon'), args.get('icon_background'))

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

        app_service = AppService()
        app_model = app_service.update_app_site_status(app_model, args.get('enable_site'))

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

        app_service = AppService()
        app_model = app_service.update_app_api_status(app_model, args.get('enable_api'))

        return app_model


api.add_resource(AppListApi, '/apps')
api.add_resource(AppImportApi, '/apps/import')
api.add_resource(AppApi, '/apps/<uuid:app_id>')
api.add_resource(AppCopyApi, '/apps/<uuid:app_id>/copy')
api.add_resource(AppExportApi, '/apps/<uuid:app_id>/export')
api.add_resource(AppNameApi, '/apps/<uuid:app_id>/name')
api.add_resource(AppIconApi, '/apps/<uuid:app_id>/icon')
api.add_resource(AppSiteStatus, '/apps/<uuid:app_id>/site-enable')
api.add_resource(AppApiStatus, '/apps/<uuid:app_id>/api-enable')
