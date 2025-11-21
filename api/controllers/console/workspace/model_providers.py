import io

from flask import send_file
from flask_restx import Resource, reqparse

from controllers.console import api, console_ns
from controllers.console.wraps import account_initialization_required, is_admin_or_owner_required, setup_required
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.helper import StrLen, uuid_value
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService
from services.model_provider_service import ModelProviderService

parser_model = reqparse.RequestParser().add_argument(
    "model_type",
    type=str,
    required=False,
    nullable=True,
    choices=[mt.value for mt in ModelType],
    location="args",
)


@console_ns.route("/workspaces/current/model-providers")
class ModelProviderListApi(Resource):
    @api.expect(parser_model)
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        tenant_id = current_tenant_id

        args = parser_model.parse_args()

        model_provider_service = ModelProviderService()
        provider_list = model_provider_service.get_provider_list(tenant_id=tenant_id, model_type=args.get("model_type"))

        return jsonable_encoder({"data": provider_list})


parser_cred = reqparse.RequestParser().add_argument(
    "credential_id", type=uuid_value, required=False, nullable=True, location="args"
)
parser_post_cred = (
    reqparse.RequestParser()
    .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
    .add_argument("name", type=StrLen(30), required=False, nullable=True, location="json")
)

parser_put_cred = (
    reqparse.RequestParser()
    .add_argument("credential_id", type=uuid_value, required=True, nullable=False, location="json")
    .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
    .add_argument("name", type=StrLen(30), required=False, nullable=True, location="json")
)

parser_delete_cred = reqparse.RequestParser().add_argument(
    "credential_id", type=uuid_value, required=True, nullable=False, location="json"
)


@console_ns.route("/workspaces/current/model-providers/<path:provider>/credentials")
class ModelProviderCredentialApi(Resource):
    @api.expect(parser_cred)
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        tenant_id = current_tenant_id
        # if credential_id is not provided, return current used credential
        args = parser_cred.parse_args()

        model_provider_service = ModelProviderService()
        credentials = model_provider_service.get_provider_credential(
            tenant_id=tenant_id, provider=provider, credential_id=args.get("credential_id")
        )

        return {"credentials": credentials}

    @api.expect(parser_post_cred)
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        args = parser_post_cred.parse_args()

        model_provider_service = ModelProviderService()

        try:
            model_provider_service.create_provider_credential(
                tenant_id=current_tenant_id,
                provider=provider,
                credentials=args["credentials"],
                credential_name=args["name"],
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {"result": "success"}, 201

    @api.expect(parser_put_cred)
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def put(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()

        args = parser_put_cred.parse_args()

        model_provider_service = ModelProviderService()

        try:
            model_provider_service.update_provider_credential(
                tenant_id=current_tenant_id,
                provider=provider,
                credentials=args["credentials"],
                credential_id=args["credential_id"],
                credential_name=args["name"],
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {"result": "success"}

    @api.expect(parser_delete_cred)
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def delete(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        args = parser_delete_cred.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.remove_provider_credential(
            tenant_id=current_tenant_id, provider=provider, credential_id=args["credential_id"]
        )

        return {"result": "success"}, 204


parser_switch = reqparse.RequestParser().add_argument(
    "credential_id", type=str, required=True, nullable=False, location="json"
)


@console_ns.route("/workspaces/current/model-providers/<path:provider>/credentials/switch")
class ModelProviderCredentialSwitchApi(Resource):
    @api.expect(parser_switch)
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        args = parser_switch.parse_args()

        service = ModelProviderService()
        service.switch_active_provider_credential(
            tenant_id=current_tenant_id,
            provider=provider,
            credential_id=args["credential_id"],
        )
        return {"result": "success"}


parser_validate = reqparse.RequestParser().add_argument(
    "credentials", type=dict, required=True, nullable=False, location="json"
)


@console_ns.route("/workspaces/current/model-providers/<path:provider>/credentials/validate")
class ModelProviderValidateApi(Resource):
    @api.expect(parser_validate)
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        args = parser_validate.parse_args()

        tenant_id = current_tenant_id

        model_provider_service = ModelProviderService()

        result = True
        error = ""

        try:
            model_provider_service.validate_provider_credentials(
                tenant_id=tenant_id, provider=provider, credentials=args["credentials"]
            )
        except CredentialsValidateFailedError as ex:
            result = False
            error = str(ex)

        response = {"result": "success" if result else "error"}

        if not result:
            response["error"] = error or "Unknown error"

        return response


@console_ns.route("/workspaces/<string:tenant_id>/model-providers/<path:provider>/<string:icon_type>/<string:lang>")
class ModelProviderIconApi(Resource):
    """
    Get model provider icon
    """

    def get(self, tenant_id: str, provider: str, icon_type: str, lang: str):
        model_provider_service = ModelProviderService()
        icon, mimetype = model_provider_service.get_model_provider_icon(
            tenant_id=tenant_id,
            provider=provider,
            icon_type=icon_type,
            lang=lang,
        )
        if icon is None:
            raise ValueError(f"icon not found for provider {provider}, icon_type {icon_type}, lang {lang}")
        return send_file(io.BytesIO(icon), mimetype=mimetype)


parser_preferred = reqparse.RequestParser().add_argument(
    "preferred_provider_type",
    type=str,
    required=True,
    nullable=False,
    choices=["system", "custom"],
    location="json",
)


@console_ns.route("/workspaces/current/model-providers/<path:provider>/preferred-provider-type")
class PreferredProviderTypeUpdateApi(Resource):
    @api.expect(parser_preferred)
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()

        tenant_id = current_tenant_id

        args = parser_preferred.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.switch_preferred_provider(
            tenant_id=tenant_id, provider=provider, preferred_provider_type=args["preferred_provider_type"]
        )

        return {"result": "success"}


@console_ns.route("/workspaces/current/model-providers/<path:provider>/checkout-url")
class ModelProviderPaymentCheckoutUrlApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        if provider != "anthropic":
            raise ValueError(f"provider name {provider} is invalid")
        current_user, current_tenant_id = current_account_with_tenant()
        BillingService.is_tenant_owner_or_admin(current_user)
        data = BillingService.get_model_provider_payment_link(
            provider_name=provider,
            tenant_id=current_tenant_id,
            account_id=current_user.id,
            prefilled_email=current_user.email,
        )
        return data
