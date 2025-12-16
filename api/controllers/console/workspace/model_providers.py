import io
from typing import Any, Literal

from flask import request, send_file
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, is_admin_or_owner_required, setup_required
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.helper import uuid_value
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService
from services.model_provider_service import ModelProviderService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class ParserModelList(BaseModel):
    model_type: ModelType | None = None


class ParserCredentialId(BaseModel):
    credential_id: str | None = None

    @field_validator("credential_id")
    @classmethod
    def validate_optional_credential_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


class ParserCredentialCreate(BaseModel):
    credentials: dict[str, Any]
    name: str | None = Field(default=None, max_length=30)


class ParserCredentialUpdate(BaseModel):
    credential_id: str
    credentials: dict[str, Any]
    name: str | None = Field(default=None, max_length=30)

    @field_validator("credential_id")
    @classmethod
    def validate_update_credential_id(cls, value: str) -> str:
        return uuid_value(value)


class ParserCredentialDelete(BaseModel):
    credential_id: str

    @field_validator("credential_id")
    @classmethod
    def validate_delete_credential_id(cls, value: str) -> str:
        return uuid_value(value)


class ParserCredentialSwitch(BaseModel):
    credential_id: str

    @field_validator("credential_id")
    @classmethod
    def validate_switch_credential_id(cls, value: str) -> str:
        return uuid_value(value)


class ParserCredentialValidate(BaseModel):
    credentials: dict[str, Any]


class ParserPreferredProviderType(BaseModel):
    preferred_provider_type: Literal["system", "custom"]


def reg(cls: type[BaseModel]):
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


reg(ParserModelList)
reg(ParserCredentialId)
reg(ParserCredentialCreate)
reg(ParserCredentialUpdate)
reg(ParserCredentialDelete)
reg(ParserCredentialSwitch)
reg(ParserCredentialValidate)
reg(ParserPreferredProviderType)


@console_ns.route("/workspaces/current/model-providers")
class ModelProviderListApi(Resource):
    @console_ns.expect(console_ns.models[ParserModelList.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        tenant_id = current_tenant_id

        payload = request.args.to_dict(flat=True)  # type: ignore
        args = ParserModelList.model_validate(payload)

        model_provider_service = ModelProviderService()
        provider_list = model_provider_service.get_provider_list(tenant_id=tenant_id, model_type=args.model_type)

        return jsonable_encoder({"data": provider_list})


@console_ns.route("/workspaces/current/model-providers/<path:provider>/credentials")
class ModelProviderCredentialApi(Resource):
    @console_ns.expect(console_ns.models[ParserCredentialId.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        tenant_id = current_tenant_id
        # if credential_id is not provided, return current used credential
        payload = request.args.to_dict(flat=True)  # type: ignore
        args = ParserCredentialId.model_validate(payload)

        model_provider_service = ModelProviderService()
        credentials = model_provider_service.get_provider_credential(
            tenant_id=tenant_id, provider=provider, credential_id=args.credential_id
        )

        return {"credentials": credentials}

    @console_ns.expect(console_ns.models[ParserCredentialCreate.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = ParserCredentialCreate.model_validate(payload)

        model_provider_service = ModelProviderService()

        try:
            model_provider_service.create_provider_credential(
                tenant_id=current_tenant_id,
                provider=provider,
                credentials=args.credentials,
                credential_name=args.name,
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {"result": "success"}, 201

    @console_ns.expect(console_ns.models[ParserCredentialUpdate.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def put(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()

        payload = console_ns.payload or {}
        args = ParserCredentialUpdate.model_validate(payload)

        model_provider_service = ModelProviderService()

        try:
            model_provider_service.update_provider_credential(
                tenant_id=current_tenant_id,
                provider=provider,
                credentials=args.credentials,
                credential_id=args.credential_id,
                credential_name=args.name,
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {"result": "success"}

    @console_ns.expect(console_ns.models[ParserCredentialDelete.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def delete(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = ParserCredentialDelete.model_validate(payload)

        model_provider_service = ModelProviderService()
        model_provider_service.remove_provider_credential(
            tenant_id=current_tenant_id, provider=provider, credential_id=args.credential_id
        )

        return {"result": "success"}, 204


@console_ns.route("/workspaces/current/model-providers/<path:provider>/credentials/switch")
class ModelProviderCredentialSwitchApi(Resource):
    @console_ns.expect(console_ns.models[ParserCredentialSwitch.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = ParserCredentialSwitch.model_validate(payload)

        service = ModelProviderService()
        service.switch_active_provider_credential(
            tenant_id=current_tenant_id,
            provider=provider,
            credential_id=args.credential_id,
        )
        return {"result": "success"}


@console_ns.route("/workspaces/current/model-providers/<path:provider>/credentials/validate")
class ModelProviderValidateApi(Resource):
    @console_ns.expect(console_ns.models[ParserCredentialValidate.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        payload = console_ns.payload or {}
        args = ParserCredentialValidate.model_validate(payload)

        tenant_id = current_tenant_id

        model_provider_service = ModelProviderService()

        result = True
        error = ""

        try:
            model_provider_service.validate_provider_credentials(
                tenant_id=tenant_id, provider=provider, credentials=args.credentials
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
    @console_ns.expect(console_ns.models[ParserPreferredProviderType.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()

        tenant_id = current_tenant_id

        payload = console_ns.payload or {}
        args = ParserPreferredProviderType.model_validate(payload)

        model_provider_service = ModelProviderService()
        model_provider_service.switch_preferred_provider(
            tenant_id=tenant_id, provider=provider, preferred_provider_type=args.preferred_provider_type
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
