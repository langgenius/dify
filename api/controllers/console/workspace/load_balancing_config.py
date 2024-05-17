from flask_restful import Resource, reqparse
from werkzeug.exceptions import Forbidden, NotFound

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from libs.login import current_user, login_required
from models.account import TenantAccountRole
from services.model_load_balancing_service import ModelLoadBalancingService


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


class LoadBalancingCredentialsValidateApi(Resource):
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
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        # validate model load balancing credentials
        model_load_balancing_service = ModelLoadBalancingService()

        try:
            model_load_balancing_service.validate_load_balancing_credentials(
                tenant_id=tenant_id,
                provider=provider,
                model=args['model'],
                model_type=args['model_type'],
                credentials=args['credentials']
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {'result': 'success'}, 200


class LoadBalancingConfigCredentialsValidateApi(Resource):
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
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        # validate model load balancing config credentials
        model_load_balancing_service = ModelLoadBalancingService()

        try:
            model_load_balancing_service.validate_load_balancing_credentials(
                tenant_id=tenant_id,
                provider=provider,
                model=args['model'],
                model_type=args['model_type'],
                credentials=args['credentials'],
                config_id=config_id,
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {'result': 'success'}, 200


# Load Balancing Config
api.add_resource(LoadBalancingConfigApi,
                 '/workspaces/current/model-providers/<string:provider>/models/load-balancing-configs/<string:config_id>')

api.add_resource(LoadBalancingCredentialsValidateApi,
                 '/workspaces/current/model-providers/<string:provider>/models/load-balancing-configs/credentials-validate')

api.add_resource(LoadBalancingConfigCredentialsValidateApi,
                 '/workspaces/current/model-providers/<string:provider>/models/load-balancing-configs/<string:config_id>/credentials-validate')
