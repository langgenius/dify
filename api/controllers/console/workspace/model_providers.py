from flask_login import current_user
from libs.login import login_required
from flask_restful import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.model_providers.error import LLMBadRequestError
from core.model_providers.providers.base import CredentialsValidateFailedError
from services.provider_checkout_service import ProviderCheckoutService
from services.provider_service import ProviderService


class ModelProviderListApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        tenant_id = current_user.current_tenant_id

        provider_service = ProviderService()
        provider_list = provider_service.get_provider_list(tenant_id)

        return provider_list


class ModelProviderValidateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider_name: str):

        parser = reqparse.RequestParser()
        parser.add_argument('config', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        provider_service = ProviderService()

        result = True
        error = None

        try:
            provider_service.custom_provider_config_validate(
                provider_name=provider_name,
                config=args['config']
            )
        except CredentialsValidateFailedError as ex:
            result = False
            error = str(ex)

        response = {'result': 'success' if result else 'error'}

        if not result:
            response['error'] = error

        return response


class ModelProviderUpdateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider_name: str):
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument('config', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        provider_service = ProviderService()

        try:
            provider_service.save_custom_provider_config(
                tenant_id=current_user.current_tenant_id,
                provider_name=provider_name,
                config=args['config']
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {'result': 'success'}, 201

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider_name: str):
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        provider_service = ProviderService()
        provider_service.delete_custom_provider(
            tenant_id=current_user.current_tenant_id,
            provider_name=provider_name
        )

        return {'result': 'success'}, 204


class ModelProviderModelValidateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider_name: str):
        parser = reqparse.RequestParser()
        parser.add_argument('model_name', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=['text-generation', 'embeddings', 'speech2text'], location='json')
        parser.add_argument('config', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        provider_service = ProviderService()

        result = True
        error = None

        try:
            provider_service.custom_provider_model_config_validate(
                provider_name=provider_name,
                model_name=args['model_name'],
                model_type=args['model_type'],
                config=args['config']
            )
        except CredentialsValidateFailedError as ex:
            result = False
            error = str(ex)

        response = {'result': 'success' if result else 'error'}

        if not result:
            response['error'] = error

        return response


class ModelProviderModelUpdateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider_name: str):
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument('model_name', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=['text-generation', 'embeddings', 'speech2text'], location='json')
        parser.add_argument('config', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        provider_service = ProviderService()

        try:
            provider_service.add_or_save_custom_provider_model_config(
                tenant_id=current_user.current_tenant_id,
                provider_name=provider_name,
                model_name=args['model_name'],
                model_type=args['model_type'],
                config=args['config']
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {'result': 'success'}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider_name: str):
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument('model_name', type=str, required=True, nullable=False, location='args')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=['text-generation', 'embeddings', 'speech2text'], location='args')
        args = parser.parse_args()

        provider_service = ProviderService()
        provider_service.delete_custom_provider_model(
            tenant_id=current_user.current_tenant_id,
            provider_name=provider_name,
            model_name=args['model_name'],
            model_type=args['model_type']
        )

        return {'result': 'success'}, 204


class PreferredProviderTypeUpdateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider_name: str):
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument('preferred_provider_type', type=str, required=True, nullable=False,
                            choices=['system', 'custom'], location='json')
        args = parser.parse_args()

        provider_service = ProviderService()
        provider_service.switch_preferred_provider(
            tenant_id=current_user.current_tenant_id,
            provider_name=provider_name,
            preferred_provider_type=args['preferred_provider_type']
        )

        return {'result': 'success'}


class ModelProviderModelParameterRuleApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_name: str):
        parser = reqparse.RequestParser()
        parser.add_argument('model_name', type=str, required=True, nullable=False, location='args')
        args = parser.parse_args()

        provider_service = ProviderService()

        try:
            parameter_rules = provider_service.get_model_parameter_rules(
                tenant_id=current_user.current_tenant_id,
                model_provider_name=provider_name,
                model_name=args['model_name'],
                model_type='text-generation'
            )
        except LLMBadRequestError:
            raise ProviderNotInitializeError(
                f"Current Text Generation Model is invalid. Please switch to the available model.")

        rules = {
            k: {
                'enabled': v.enabled,
                'min': v.min,
                'max': v.max,
                'default': v.default,
                'precision': v.precision
            }
            for k, v in vars(parameter_rules).items()
        }

        return rules


class ModelProviderPaymentCheckoutUrlApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_name: str):
        provider_service = ProviderCheckoutService()
        provider_checkout = provider_service.create_checkout(
            tenant_id=current_user.current_tenant_id,
            provider_name=provider_name,
            account=current_user
        )

        return {
            'url': provider_checkout.get_checkout_url()
        }


class ModelProviderFreeQuotaSubmitApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider_name: str):
        provider_service = ProviderService()
        result = provider_service.free_quota_submit(
            tenant_id=current_user.current_tenant_id,
            provider_name=provider_name
        )

        return result


class ModelProviderFreeQuotaQualificationVerifyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider_name: str):
        parser = reqparse.RequestParser()
        parser.add_argument('token', type=str, required=False, nullable=True, location='args')
        args = parser.parse_args()

        provider_service = ProviderService()
        result = provider_service.free_quota_qualification_verify(
            tenant_id=current_user.current_tenant_id,
            provider_name=provider_name,
            token=args['token']
        )

        return result


api.add_resource(ModelProviderListApi, '/workspaces/current/model-providers')
api.add_resource(ModelProviderValidateApi, '/workspaces/current/model-providers/<string:provider_name>/validate')
api.add_resource(ModelProviderUpdateApi, '/workspaces/current/model-providers/<string:provider_name>')
api.add_resource(ModelProviderModelValidateApi,
                 '/workspaces/current/model-providers/<string:provider_name>/models/validate')
api.add_resource(ModelProviderModelUpdateApi,
                 '/workspaces/current/model-providers/<string:provider_name>/models')
api.add_resource(PreferredProviderTypeUpdateApi,
                 '/workspaces/current/model-providers/<string:provider_name>/preferred-provider-type')
api.add_resource(ModelProviderModelParameterRuleApi,
                 '/workspaces/current/model-providers/<string:provider_name>/models/parameter-rules')
api.add_resource(ModelProviderPaymentCheckoutUrlApi,
                 '/workspaces/current/model-providers/<string:provider_name>/checkout-url')
api.add_resource(ModelProviderFreeQuotaSubmitApi,
                 '/workspaces/current/model-providers/<string:provider_name>/free-quota-submit')
api.add_resource(ModelProviderFreeQuotaQualificationVerifyApi,
                 '/workspaces/current/model-providers/<string:provider_name>/free-quota-qualification-verify')
