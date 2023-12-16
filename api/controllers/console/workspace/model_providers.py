from flask_login import current_user
from flask_restful import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from libs.login import login_required
from services.billing_service import BillingService
from services.model_provider_service import ModelProviderService


class ModelProviderListApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model_type', type=str, required=False, nullable=True,
                            choices=[mt.value for mt in ModelType], location='args')
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        provider_list = model_provider_service.get_provider_list(
            tenant_id=tenant_id,
            model_type=args.get('model_type')
        )

        return provider_list


class ModelProviderCredentialApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        credentials = model_provider_service.get_provider_credentials(
            tenant_id=tenant_id,
            provider=provider
        )

        return {
            "credentials": credentials
        }


class ModelProviderValidateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):

        parser = reqparse.RequestParser()
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()

        result = True
        error = None

        try:
            model_provider_service.provider_credentials_validate(
                tenant_id=tenant_id,
                provider=provider,
                credentials=args['credentials']
            )
        except CredentialsValidateFailedError as ex:
            result = False
            error = str(ex)

        response = {'result': 'success' if result else 'error'}

        if not result:
            response['error'] = error

        return response


class ModelProviderApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        model_provider_service = ModelProviderService()

        try:
            model_provider_service.save_provider_credentials(
                tenant_id=current_user.current_tenant_id,
                provider=provider,
                credentials=args['credentials']
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {'result': 'success'}, 201

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider: str):
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        model_provider_service = ModelProviderService()
        model_provider_service.remove_provider_credentials(
            tenant_id=current_user.current_tenant_id,
            provider=provider
        )

        return {'result': 'success'}, 204


class ModelProviderModelCredentialApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='args')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='args')
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        credentials = model_provider_service.get_model_credentials(
            tenant_id=tenant_id,
            provider=provider,
            model_type=args['model_type'],
            model=args['model']
        )

        return {
            "credentials": credentials
        }


class ModelProviderModelValidateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='json')
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        model_provider_service = ModelProviderService()

        result = True
        error = None

        try:
            model_provider_service.model_credentials_validate(
                tenant_id=tenant_id,
                provider=provider,
                model=args['model'],
                model_type=args['model_type'],
                credentials=args['credentials']
            )
        except CredentialsValidateFailedError as ex:
            result = False
            error = str(ex)

        response = {'result': 'success' if result else 'error'}

        if not result:
            response['error'] = error

        return response


class ModelProviderModelApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='json')
        parser.add_argument('credentials', type=dict, required=True, nullable=False, location='json')
        args = parser.parse_args()

        model_provider_service = ModelProviderService()

        try:
            model_provider_service.save_model_credentials(
                tenant_id=tenant_id,
                provider=provider,
                model=args['model'],
                model_type=args['model_type'],
                credentials=args['credentials']
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {'result': 'success'}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider: str):
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='json')
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.remove_model_credentials(
            tenant_id=tenant_id,
            provider=provider,
            model=args['model'],
            model_type=args['model_type']
        )

        return {'result': 'success'}, 204


class ModelProviderModelParameterRuleApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        parser = reqparse.RequestParser()
        parser.add_argument('model', type=str, required=True, nullable=False, location='args')
        args = parser.parse_args()

        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        parameter_rules = model_provider_service.get_model_parameter_rules(
            tenant_id=tenant_id,
            provider=provider,
            model=args['model']
        )

        return {
            "data": parameter_rules
        }


class PreferredProviderTypeUpdateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument('preferred_provider_type', type=str, required=True, nullable=False,
                            choices=['system', 'custom'], location='json')
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.switch_preferred_provider(
            tenant_id=tenant_id,
            provider=provider,
            preferred_provider_type=args['preferred_provider_type']
        )

        return {'result': 'success'}


class ModelProviderPaymentCheckoutUrlApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        if provider != 'anthropic':
            raise ValueError(f'provider name {provider} is invalid')

        data = BillingService.get_model_provider_payment_link(provider_name=provider,
                                                              tenant_id=current_user.current_tenant_id,
                                                              account_id=current_user.id)
        return data


class ModelProviderFreeQuotaSubmitApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        model_provider_service = ModelProviderService()
        result = model_provider_service.free_quota_submit(
            tenant_id=current_user.current_tenant_id,
            provider=provider
        )

        return result


class ModelProviderFreeQuotaQualificationVerifyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        parser = reqparse.RequestParser()
        parser.add_argument('token', type=str, required=False, nullable=True, location='args')
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        result = model_provider_service.free_quota_qualification_verify(
            tenant_id=current_user.current_tenant_id,
            provider=provider,
            token=args['token']
        )

        return result


api.add_resource(ModelProviderListApi, '/workspaces/current/model-providers')

api.add_resource(ModelProviderCredentialApi, '/workspaces/current/model-providers/<string:provider>/credentials')
api.add_resource(ModelProviderValidateApi, '/workspaces/current/model-providers/<string:provider>/credentials/validate')
api.add_resource(ModelProviderApi, '/workspaces/current/model-providers/<string:provider>')

api.add_resource(ModelProviderModelCredentialApi,
                 '/workspaces/current/model-providers/<string:provider>/models/credentials')
api.add_resource(ModelProviderModelValidateApi,
                 '/workspaces/current/model-providers/<string:provider>/models/credentials/validate')
api.add_resource(ModelProviderModelApi,
                 '/workspaces/current/model-providers/<string:provider>/models')

api.add_resource(ModelProviderModelParameterRuleApi,
                 '/workspaces/current/model-providers/<string:provider>/models/parameter-rules')
api.add_resource(PreferredProviderTypeUpdateApi,
                 '/workspaces/current/model-providers/<string:provider>/preferred-provider-type')
api.add_resource(ModelProviderPaymentCheckoutUrlApi,
                 '/workspaces/current/model-providers/<string:provider>/checkout-url')
api.add_resource(ModelProviderFreeQuotaSubmitApi,
                 '/workspaces/current/model-providers/<string:provider>/free-quota-submit')
api.add_resource(ModelProviderFreeQuotaQualificationVerifyApi,
                 '/workspaces/current/model-providers/<string:provider>/free-quota-qualification-verify')
