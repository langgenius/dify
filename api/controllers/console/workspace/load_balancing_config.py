from flask_restful import Resource, marshal_with, reqparse
from werkzeug.exceptions import Forbidden, NotFound

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from fields.load_balancing_config import load_balancing_config_list_fields
from libs.login import current_user, login_required
from models.account import TenantAccountRole
from services.model_load_balancing_service import ModelLoadBalancingService


class ModelLoadBalancingEnableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, provider: str):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='json')
        args = parser.parse_args()

        # enable model load balancing
        model_load_balancing_service = ModelLoadBalancingService()
        model_load_balancing_service.enable_model_load_balancing(
            tenant_id=tenant_id,
            provider=provider,
            model=args['model'],
            model_type=args['model_type']
        )

        return {'result': 'success'}


class ModelLoadBalancingDisableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, provider: str):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='json')
        args = parser.parse_args()

        # disable model load balancing
        model_load_balancing_service = ModelLoadBalancingService()
        model_load_balancing_service.disable_model_load_balancing(
            tenant_id=tenant_id,
            provider=provider,
            model=args['model'],
            model_type=args['model_type']
        )

        return {'result': 'success'}


class LoadBalancingConfigListApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(load_balancing_config_list_fields)
    def get(self, provider: str):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='args')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='args')
        args = parser.parse_args()

        model_load_balancing_service = ModelLoadBalancingService()
        load_balancing_configs = model_load_balancing_service.get_load_balancing_configs(
            tenant_id=tenant_id,
            provider=provider,
            model=args['model'],
            model_type=args['model_type']
        )

        return {
            'data': load_balancing_configs
        }

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        if not TenantAccountRole.is_privileged_role(current_user.current_tenant.current_role):
            raise Forbidden()

        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='json')
        parser.add_argument('name', type=str, required=True, nullable=False, location='json')
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        # create model load balancing config
        model_load_balancing_service = ModelLoadBalancingService()

        try:
            model_load_balancing_service.create_load_balancing_config(
                tenant_id=tenant_id,
                provider=provider,
                model=args['model'],
                model_type=args['model_type'],
                name=args['name'],
                credentials=args['credentials']
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {'result': 'success'}, 201


class LoadBalancingConfigApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str, config_id: str):
        if not TenantAccountRole.is_privileged_role(current_user.current_tenant.current_role):
            raise Forbidden()

        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='args')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='args')
        args = parser.parse_args()

        # get model load balancing config detail
        model_load_balancing_service = ModelLoadBalancingService()
        result = model_load_balancing_service.get_load_balancing_config(
            tenant_id=tenant_id,
            provider=provider,
            model=args['model'],
            model_type=args['model_type'],
            config_id=config_id
        )

        if not result:
            raise NotFound()

        return result

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str, config_id: str):
        if not TenantAccountRole.is_privileged_role(current_user.current_tenant.current_role):
            raise Forbidden()

        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='json')
        parser.add_argument('name', type=str, required=True, nullable=False, location='json')
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        # create model load balancing config
        model_load_balancing_service = ModelLoadBalancingService()

        try:
            model_load_balancing_service.update_load_balancing_config(
                tenant_id=tenant_id,
                provider=provider,
                model=args['model'],
                model_type=args['model_type'],
                config_id=config_id,
                name=args['name'],
                credentials=args['credentials']
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {'result': 'success'}

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider: str, config_id: str):
        if not TenantAccountRole.is_privileged_role(current_user.current_tenant.current_role):
            raise Forbidden()

        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='args')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='args')
        args = parser.parse_args()

        # delete model load balancing config
        model_load_balancing_service = ModelLoadBalancingService()
        model_load_balancing_service.delete_load_balancing_config(
            tenant_id=tenant_id,
            provider=provider,
            model=args['model'],
            model_type=args['model_type'],
            config_id=config_id
        )

        return {'result': 'success'}, 204


class LoadBalancingConfigEnableApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, provider: str, config_id: str):
        if not TenantAccountRole.is_privileged_role(current_user.current_tenant.current_role):
            raise Forbidden()

        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='json')
        args = parser.parse_args()

        # TODO

        return {}


class LoadBalancingConfigDisableApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, provider: str, config_id: str):
        if not TenantAccountRole.is_privileged_role(current_user.current_tenant.current_role):
            raise Forbidden()

        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='json')
        args = parser.parse_args()

        # TODO

        return {}


# Model Load Balancing Feature
api.add_resource(ModelLoadBalancingEnableApi,
                 '/workspaces/current/model-providers/<string:provider>/models/load-balancing-configs/enable')
api.add_resource(ModelLoadBalancingDisableApi,
                 '/workspaces/current/model-providers/<string:provider>/models/load-balancing-configs/disable')

# Load Balancing Config
api.add_resource(LoadBalancingConfigListApi,
                 '/workspaces/current/model-providers/<string:provider>/models/load-balancing-configs')
api.add_resource(LoadBalancingConfigApi,
                 '/workspaces/current/model-providers/<string:provider>/models/load-balancing-configs/<string:config_id>')
api.add_resource(LoadBalancingConfigEnableApi,
                 '/workspaces/current/model-providers/<string:provider>/models/load-balancing-configs/<string:config_id>/enable')
api.add_resource(LoadBalancingConfigDisableApi,
                 '/workspaces/current/model-providers/<string:provider>/models/load-balancing-configs/<string:config_id>/disable')
