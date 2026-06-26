import io
from typing import Any, Literal

from flask import request, send_file
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.common.fields import BinaryFileResponse, SimpleResultResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    is_admin_or_owner_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from fields.base import ResponseModel
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError
from graphon.model_runtime.utils.encoders import jsonable_encoder
from extensions.ext_database import db
from libs.helper import uuid_value
from libs.login import login_required
from models import Account
from services.billing_service import BillingService
from services.entities.model_provider_entities import ProviderResponse
from services.model_provider_service import ModelProviderService


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


class ModelProviderListResponse(ResponseModel):
    data: list[ProviderResponse]


class ProviderCredentialResponse(ResponseModel):
    credentials: dict[str, Any] | None = Field(default=None)


class ProviderCredentialValidateResponse(ResponseModel):
    result: Literal["success", "error"]
    error: str | None = None


class ModelProviderPaymentCheckoutUrlResponse(ResponseModel):
    payment_link: str


register_schema_models(
    console_ns,
    ParserModelList,
    ParserCredentialId,
    ParserCredentialCreate,
    ParserCredentialUpdate,
    ParserCredentialDelete,
    ParserCredentialSwitch,
    ParserCredentialValidate,
    ParserPreferredProviderType,
)
register_response_schema_models(
    console_ns,
    BinaryFileResponse,
    SimpleResultResponse,
    ModelProviderListResponse,
    ModelProviderPaymentCheckoutUrlResponse,
    ProviderCredentialResponse,
    ProviderCredentialValidateResponse,
)


@console_ns.route("/workspaces/current/model-providers")
class ModelProviderListApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserModelList))
    @console_ns.response(200, "Success", console_ns.models[ModelProviderListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        payload = request.args.to_dict(flat=True)
        args = ParserModelList.model_validate(payload)

        model_provider_service = ModelProviderService()
        provider_list = model_provider_service.get_provider_list(tenant_id=tenant_id, model_type=args.model_type)

        return jsonable_encoder({"data": provider_list})


@console_ns.route("/workspaces/current/model-providers/<path:provider>/credentials")
class ModelProviderCredentialApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserCredentialId))
    @console_ns.response(200, "Success", console_ns.models[ProviderCredentialResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, provider: str):
        # if credential_id is not provided, return current used credential
        payload = request.args.to_dict(flat=True)
        args = ParserCredentialId.model_validate(payload)

        model_provider_service = ModelProviderService()
        credentials = model_provider_service.get_provider_credential(
            tenant_id=tenant_id, provider=provider, credential_id=args.credential_id
        )

        return {"credentials": credentials}

    @console_ns.expect(console_ns.models[ParserCredentialCreate.__name__])
    @console_ns.response(201, "Credential created successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_CREATE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str, provider: str):
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
    @console_ns.response(200, "Credential updated successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def put(self, current_tenant_id: str, provider: str):
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
    @console_ns.response(204, "Credential deleted successfully")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, provider: str):
        payload = console_ns.payload or {}
        args = ParserCredentialDelete.model_validate(payload)

        model_provider_service = ModelProviderService()
        model_provider_service.remove_provider_credential(
            tenant_id=current_tenant_id, provider=provider, credential_id=args.credential_id
        )

        return "", 204


@console_ns.route("/workspaces/current/model-providers/<path:provider>/credentials/switch")
class ModelProviderCredentialSwitchApi(Resource):
    @console_ns.expect(console_ns.models[ParserCredentialSwitch.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_USE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str, provider: str):
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
    @console_ns.response(
        200,
        "Credential validation result",
        console_ns.models[ProviderCredentialValidateResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str, provider: str):
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

    @console_ns.response(200, "Success", console_ns.models[BinaryFileResponse.__name__])
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
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_USE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, provider: str):
        payload = console_ns.payload or {}
        args = ParserPreferredProviderType.model_validate(payload)

        model_provider_service = ModelProviderService()
        model_provider_service.switch_preferred_provider(
            tenant_id=tenant_id, provider=provider, preferred_provider_type=args.preferred_provider_type
        )

        return {"result": "success"}


@console_ns.route("/workspaces/current/model-providers/<path:provider>/checkout-url")
class ModelProviderPaymentCheckoutUrlApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[ModelProviderPaymentCheckoutUrlResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account, provider: str):
        if provider != "anthropic":
            raise ValueError(f"provider name {provider} is invalid")
        BillingService.is_tenant_owner_or_admin(db.session, current_user)
        data = BillingService.get_model_provider_payment_link(
            provider_name=provider,
            tenant_id=current_tenant_id,
            account_id=current_user.id,
            prefilled_email=current_user.email,
        )
        return data
