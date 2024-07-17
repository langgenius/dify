import io

from flask import current_app, send_file
from flask_login import current_user
from flask_restful import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.helper import alphanumeric, uuid_value
from libs.login import login_required
from services.tools.api_tools_manage_service import ApiToolManageService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.tools.tool_labels_service import ToolLabelsService
from services.tools.tools_manage_service import ToolCommonService
from services.tools.workflow_tools_manage_service import WorkflowToolManageService


class ToolProviderListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        req = reqparse.RequestParser()
        req.add_argument('type', type=str, choices=['builtin', 'model', 'api', 'workflow'], required=False, nullable=True, location='args')
        args = req.parse_args()

        return ToolCommonService.list_tool_providers(user_id, tenant_id, args.get('type', None))

class ToolBuiltinProviderListToolsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        return jsonable_encoder(BuiltinToolManageService.list_builtin_tool_provider_tools(
            user_id,
            tenant_id,
            provider,
        ))

class ToolBuiltinProviderDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        return BuiltinToolManageService.delete_builtin_tool_provider(
            user_id,
            tenant_id,
            provider,
        )
    
class ToolBuiltinProviderUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')

        args = parser.parse_args()

        return BuiltinToolManageService.update_builtin_tool_provider(
            user_id,
            tenant_id,
            provider,
            args['credentials'],
        )
    
class ToolBuiltinProviderGetCredentialsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        return BuiltinToolManageService.get_builtin_tool_provider_credentials(
            user_id,
            tenant_id,
            provider,
        )

class ToolBuiltinProviderIconApi(Resource):
    @setup_required
    def get(self, provider):
        icon_bytes, mimetype = BuiltinToolManageService.get_builtin_tool_provider_icon(provider)
        icon_cache_max_age = current_app.config.get('TOOL_ICON_CACHE_MAX_AGE')
        return send_file(io.BytesIO(icon_bytes), mimetype=mimetype, max_age=icon_cache_max_age)

class ToolApiProviderAddApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        parser.add_argument('schema_type', type=str, required=True, nullable=False, location='json')
        parser.add_argument('schema', type=str, required=True, nullable=False, location='json')
        parser.add_argument('provider', type=str, required=True, nullable=False, location='json')
        parser.add_argument('icon', type=dict, required=True, nullable=False, location='json')
        parser.add_argument('privacy_policy', type=str, required=False, nullable=True, location='json')
        parser.add_argument('labels', type=list[str], required=False, nullable=True, location='json', default=[])
        parser.add_argument('custom_disclaimer', type=str, required=False, nullable=True, location='json')

        args = parser.parse_args()

        return ApiToolManageService.create_api_tool_provider(
            user_id,
            tenant_id,
            args['provider'],
            args['icon'],
            args['credentials'],
            args['schema_type'],
            args['schema'],
            args.get('privacy_policy', ''),
            args.get('custom_disclaimer', ''),
            args.get('labels', []),
        )

class ToolApiProviderGetRemoteSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = reqparse.RequestParser()

        parser.add_argument('url', type=str, required=True, nullable=False, location='args')

        args = parser.parse_args()

        return ApiToolManageService.get_api_tool_provider_remote_schema(
            current_user.id,
            current_user.current_tenant_id,
            args['url'],
        )
    
class ToolApiProviderListToolsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()

        parser.add_argument('provider', type=str, required=True, nullable=False, location='args')

        args = parser.parse_args()

        return jsonable_encoder(ApiToolManageService.list_api_tool_provider_tools(
            user_id,
            tenant_id,
            args['provider'],
        ))

class ToolApiProviderUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        parser.add_argument('schema_type', type=str, required=True, nullable=False, location='json')
        parser.add_argument('schema', type=str, required=True, nullable=False, location='json')
        parser.add_argument('provider', type=str, required=True, nullable=False, location='json')
        parser.add_argument('original_provider', type=str, required=True, nullable=False, location='json')
        parser.add_argument('icon', type=dict, required=True, nullable=False, location='json')
        parser.add_argument('privacy_policy', type=str, required=True, nullable=True, location='json')
        parser.add_argument('labels', type=list[str], required=False, nullable=True, location='json')
        parser.add_argument('custom_disclaimer', type=str, required=True, nullable=True, location='json')

        args = parser.parse_args()

        return ApiToolManageService.update_api_tool_provider(
            user_id,
            tenant_id,
            args['provider'],
            args['original_provider'],
            args['icon'],
            args['credentials'],
            args['schema_type'],
            args['schema'],
            args['privacy_policy'],
            args['custom_disclaimer'],
            args.get('labels', []),
        )

class ToolApiProviderDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()

        parser.add_argument('provider', type=str, required=True, nullable=False, location='json')

        args = parser.parse_args()

        return ApiToolManageService.delete_api_tool_provider(
            user_id,
            tenant_id,
            args['provider'],
        )

class ToolApiProviderGetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()

        parser.add_argument('provider', type=str, required=True, nullable=False, location='args')

        args = parser.parse_args()

        return ApiToolManageService.get_api_tool_provider(
            user_id,
            tenant_id,
            args['provider'],
        )

class ToolBuiltinProviderCredentialsSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        return BuiltinToolManageService.list_builtin_provider_credentials_schema(provider)

class ToolApiProviderSchemaApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()

        parser.add_argument('schema', type=str, required=True, nullable=False, location='json')

        args = parser.parse_args()

        return ApiToolManageService.parser_api_schema(
            schema=args['schema'],
        )

class ToolApiProviderPreviousTestApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()

        parser.add_argument('tool_name', type=str, required=True, nullable=False, location='json')
        parser.add_argument('provider_name', type=str, required=False, nullable=False, location='json')
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        parser.add_argument('parameters', type=dict, required=True, nullable=False, location='json')
        parser.add_argument('schema_type', type=str, required=True, nullable=False, location='json')
        parser.add_argument('schema', type=str, required=True, nullable=False, location='json')

        args = parser.parse_args()

        return ApiToolManageService.test_api_tool_preview(
            current_user.current_tenant_id,
            args['provider_name'] if args['provider_name'] else '',
            args['tool_name'],
            args['credentials'],
            args['parameters'],
            args['schema_type'],
            args['schema'],
        )

class ToolWorkflowProviderCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        reqparser = reqparse.RequestParser()
        reqparser.add_argument('workflow_app_id', type=uuid_value, required=True, nullable=False, location='json')
        reqparser.add_argument('name', type=alphanumeric, required=True, nullable=False, location='json')
        reqparser.add_argument('label', type=str, required=True, nullable=False, location='json')
        reqparser.add_argument('description', type=str, required=True, nullable=False, location='json')
        reqparser.add_argument('icon', type=dict, required=True, nullable=False, location='json')
        reqparser.add_argument('parameters', type=list[dict], required=True, nullable=False, location='json')
        reqparser.add_argument('privacy_policy', type=str, required=False, nullable=True, location='json', default='')
        reqparser.add_argument('labels', type=list[str], required=False, nullable=True, location='json')

        args = reqparser.parse_args()

        return WorkflowToolManageService.create_workflow_tool(
            user_id,
            tenant_id,
            args['workflow_app_id'],
            args['name'],
            args['label'],
            args['icon'],
            args['description'],
            args['parameters'],
            args['privacy_policy'],
            args.get('labels', []),
        )

class ToolWorkflowProviderUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        reqparser = reqparse.RequestParser()
        reqparser.add_argument('workflow_tool_id', type=uuid_value, required=True, nullable=False, location='json')
        reqparser.add_argument('name', type=alphanumeric, required=True, nullable=False, location='json')
        reqparser.add_argument('label', type=str, required=True, nullable=False, location='json')
        reqparser.add_argument('description', type=str, required=True, nullable=False, location='json')
        reqparser.add_argument('icon', type=dict, required=True, nullable=False, location='json')
        reqparser.add_argument('parameters', type=list[dict], required=True, nullable=False, location='json')
        reqparser.add_argument('privacy_policy', type=str, required=False, nullable=True, location='json', default='')
        reqparser.add_argument('labels', type=list[str], required=False, nullable=True, location='json')
        
        args = reqparser.parse_args()

        if not args['workflow_tool_id']:
            raise ValueError('incorrect workflow_tool_id')
        
        return WorkflowToolManageService.update_workflow_tool(
            user_id,
            tenant_id,
            args['workflow_tool_id'],
            args['name'],
            args['label'],
            args['icon'],
            args['description'],
            args['parameters'],
            args['privacy_policy'],
            args.get('labels', []),
        )

class ToolWorkflowProviderDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        reqparser = reqparse.RequestParser()
        reqparser.add_argument('workflow_tool_id', type=uuid_value, required=True, nullable=False, location='json')

        args = reqparser.parse_args()

        return WorkflowToolManageService.delete_workflow_tool(
            user_id,
            tenant_id,
            args['workflow_tool_id'],
        )
        
class ToolWorkflowProviderGetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('workflow_tool_id', type=uuid_value, required=False, nullable=True, location='args')
        parser.add_argument('workflow_app_id', type=uuid_value, required=False, nullable=True, location='args')

        args = parser.parse_args()

        if args.get('workflow_tool_id'):
            tool = WorkflowToolManageService.get_workflow_tool_by_tool_id(
                user_id,
                tenant_id,
                args['workflow_tool_id'],
            )
        elif args.get('workflow_app_id'):
            tool = WorkflowToolManageService.get_workflow_tool_by_app_id(
                user_id,
                tenant_id,
                args['workflow_app_id'],
            )
        else:
            raise ValueError('incorrect workflow_tool_id or workflow_app_id')

        return jsonable_encoder(tool)
    
class ToolWorkflowProviderListToolApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('workflow_tool_id', type=uuid_value, required=True, nullable=False, location='args')

        args = parser.parse_args()

        return jsonable_encoder(WorkflowToolManageService.list_single_workflow_tools(
            user_id,
            tenant_id,
            args['workflow_tool_id'],
        ))

class ToolBuiltinListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        return jsonable_encoder([provider.to_dict() for provider in BuiltinToolManageService.list_builtin_tools(
            user_id,
            tenant_id,
        )])
    
class ToolApiListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        return jsonable_encoder([provider.to_dict() for provider in ApiToolManageService.list_api_tools(
            user_id,
            tenant_id,
        )])
    
class ToolWorkflowListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        user_id = current_user.id
        tenant_id = current_user.current_tenant_id

        return jsonable_encoder([provider.to_dict() for provider in WorkflowToolManageService.list_tenant_workflow_tools(
            user_id,
            tenant_id,
        )])
    
class ToolLabelsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        return jsonable_encoder(ToolLabelsService.list_tool_labels())

# tool provider
api.add_resource(ToolProviderListApi, '/workspaces/current/tool-providers')

# builtin tool provider
api.add_resource(ToolBuiltinProviderListToolsApi, '/workspaces/current/tool-provider/builtin/<provider>/tools')
api.add_resource(ToolBuiltinProviderDeleteApi, '/workspaces/current/tool-provider/builtin/<provider>/delete')
api.add_resource(ToolBuiltinProviderUpdateApi, '/workspaces/current/tool-provider/builtin/<provider>/update')
api.add_resource(ToolBuiltinProviderGetCredentialsApi, '/workspaces/current/tool-provider/builtin/<provider>/credentials')
api.add_resource(ToolBuiltinProviderCredentialsSchemaApi, '/workspaces/current/tool-provider/builtin/<provider>/credentials_schema')
api.add_resource(ToolBuiltinProviderIconApi, '/workspaces/current/tool-provider/builtin/<provider>/icon')

# api tool provider
api.add_resource(ToolApiProviderAddApi, '/workspaces/current/tool-provider/api/add')
api.add_resource(ToolApiProviderGetRemoteSchemaApi, '/workspaces/current/tool-provider/api/remote')
api.add_resource(ToolApiProviderListToolsApi, '/workspaces/current/tool-provider/api/tools')
api.add_resource(ToolApiProviderUpdateApi, '/workspaces/current/tool-provider/api/update')
api.add_resource(ToolApiProviderDeleteApi, '/workspaces/current/tool-provider/api/delete')
api.add_resource(ToolApiProviderGetApi, '/workspaces/current/tool-provider/api/get')
api.add_resource(ToolApiProviderSchemaApi, '/workspaces/current/tool-provider/api/schema')
api.add_resource(ToolApiProviderPreviousTestApi, '/workspaces/current/tool-provider/api/test/pre')

# workflow tool provider
api.add_resource(ToolWorkflowProviderCreateApi, '/workspaces/current/tool-provider/workflow/create')
api.add_resource(ToolWorkflowProviderUpdateApi, '/workspaces/current/tool-provider/workflow/update')
api.add_resource(ToolWorkflowProviderDeleteApi, '/workspaces/current/tool-provider/workflow/delete')
api.add_resource(ToolWorkflowProviderGetApi, '/workspaces/current/tool-provider/workflow/get')
api.add_resource(ToolWorkflowProviderListToolApi, '/workspaces/current/tool-provider/workflow/tools')

api.add_resource(ToolBuiltinListApi, '/workspaces/current/tools/builtin')
api.add_resource(ToolApiListApi, '/workspaces/current/tools/api')
api.add_resource(ToolWorkflowListApi, '/workspaces/current/tools/workflow')

api.add_resource(ToolLabelsApi, '/workspaces/current/tool-labels')