import io

from flask import send_file
from flask_restx import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.helper import StrLen, uuid_value
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService
from services.model_provider_service import ModelProviderService


@console_ns.route("/workspaces/current/model-providers")
class ModelProviderListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        tenant_id = current_tenant_id

        parser = reqparse.RequestParser().add_argument(
            "model_type",
            type=str,
            required=False,
            nullable=True,
            choices=[mt.value for mt in ModelType],
            location="args",
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        provider_list = model_provider_service.get_provider_list(tenant_id=tenant_id, model_type=args.get("model_type"))

        return jsonable_encoder({"data": provider_list})


@console_ns.route("/workspaces/current/model-providers/<path:provider>/credentials")
class ModelProviderCredentialApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        tenant_id = current_tenant_id
        # if credential_id is not provided, return current used credential
        parser = reqparse.RequestParser().add_argument(
            "credential_id", type=uuid_value, required=False, nullable=True, location="args"
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        credentials = model_provider_service.get_provider_credential(
            tenant_id=tenant_id, provider=provider, credential_id=args.get("credential_id")
        )

        return {"credentials": credentials}

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        current_user, current_tenant_id = current_account_with_tenant()
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
            .add_argument("name", type=StrLen(30), required=False, nullable=True, location="json")
        )
        args = parser.parse_args()

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

    @setup_required
    @login_required
    @account_initialization_required
    def put(self, provider: str):
        current_user, current_tenant_id = current_account_with_tenant()
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("credential_id", type=uuid_value, required=True, nullable=False, location="json")
            .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
            .add_argument("name", type=StrLen(30), required=False, nullable=True, location="json")
        )
        args = parser.parse_args()

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

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider: str):
        current_user, current_tenant_id = current_account_with_tenant()
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        parser = reqparse.RequestParser().add_argument(
            "credential_id", type=uuid_value, required=True, nullable=False, location="json"
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.remove_provider_credential(
            tenant_id=current_tenant_id, provider=provider, credential_id=args["credential_id"]
        )

        return {"result": "success"}, 204


@console_ns.route("/workspaces/current/model-providers/<path:provider>/credentials/switch")
class ModelProviderCredentialSwitchApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        current_user, current_tenant_id = current_account_with_tenant()
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        parser = reqparse.RequestParser().add_argument(
            "credential_id", type=str, required=True, nullable=False, location="json"
        )
        args = parser.parse_args()

        service = ModelProviderService()
        service.switch_active_provider_credential(
            tenant_id=current_tenant_id,
            provider=provider,
            credential_id=args["credential_id"],
        )
        return {"result": "success"}


@console_ns.route("/workspaces/current/model-providers/<path:provider>/credentials/validate")
class ModelProviderValidateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        parser = reqparse.RequestParser().add_argument(
            "credentials", type=dict, required=True, nullable=False, location="json"
        )
        args = parser.parse_args()

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


@console_ns.route("/workspaces/current/model-providers/<path:provider>/preferred-provider-type")
class PreferredProviderTypeUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        current_user, current_tenant_id = current_account_with_tenant()
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = current_tenant_id

        parser = reqparse.RequestParser().add_argument(
            "preferred_provider_type",
            type=str,
            required=True,
            nullable=False,
            choices=["system", "custom"],
            location="json",
        )
        args = parser.parse_args()

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
