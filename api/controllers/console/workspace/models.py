import logging
from typing import Any, cast

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import (
    query_params_from_model,
    register_enum_models,
    register_response_schema_models,
    register_schema_models,
)
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
from core.entities.provider_entities import CredentialConfiguration
from fields.base import ResponseModel
from graphon.model_runtime.entities.model_entities import ModelType, ParameterRule
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError
from graphon.model_runtime.utils.encoders import jsonable_encoder
from libs.helper import uuid_value
from libs.login import login_required
from models import Account
from services.entities.model_provider_entities import (
    DefaultModelResponse,
    ModelWithProviderEntityResponse,
    ProviderWithModelsResponse,
)
from services.model_load_balancing_service import ModelLoadBalancingService
from services.model_provider_service import ModelProviderService

logger = logging.getLogger(__name__)


class ParserGetDefault(BaseModel):
    model_type: ModelType


class Inner(BaseModel):
    model_type: ModelType
    model: str | None = None
    provider: str | None = None


class ParserPostDefault(BaseModel):
    model_settings: list[Inner]


class ParserDeleteModels(BaseModel):
    model: str
    model_type: ModelType


class LoadBalancingPayload(BaseModel):
    configs: list[dict[str, Any]] | None = Field(default=None)
    enabled: bool | None = None


class ParserPostModels(BaseModel):
    model: str
    model_type: ModelType
    load_balancing: LoadBalancingPayload | None = None
    config_from: str | None = None
    credential_id: str | None = None

    @field_validator("credential_id")
    @classmethod
    def validate_credential_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


class ParserGetCredentials(BaseModel):
    model: str
    model_type: ModelType
    config_from: str | None = None
    credential_id: str | None = None

    @field_validator("credential_id")
    @classmethod
    def validate_get_credential_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


class ParserCredentialBase(BaseModel):
    model: str
    model_type: ModelType


class ParserCreateCredential(ParserCredentialBase):
    name: str | None = Field(default=None, max_length=30)
    credentials: dict[str, Any]


class ParserUpdateCredential(ParserCredentialBase):
    credential_id: str
    credentials: dict[str, Any]
    name: str | None = Field(default=None, max_length=30)

    @field_validator("credential_id")
    @classmethod
    def validate_update_credential_id(cls, value: str) -> str:
        return uuid_value(value)


class ParserDeleteCredential(ParserCredentialBase):
    credential_id: str

    @field_validator("credential_id")
    @classmethod
    def validate_delete_credential_id(cls, value: str) -> str:
        return uuid_value(value)


class ParserParameter(BaseModel):
    model: str


class ParserSwitch(BaseModel):
    model: str
    model_type: ModelType
    credential_id: str


class DefaultModelDataResponse(ResponseModel):
    data: DefaultModelResponse | None = None


class ModelWithProviderListResponse(ResponseModel):
    data: list[ModelWithProviderEntityResponse]


class ProviderWithModelsDataResponse(ResponseModel):
    data: list[ProviderWithModelsResponse]


class ModelCredentialLoadBalancingResponse(ResponseModel):
    enabled: bool
    configs: list[dict[str, Any]] = Field(default_factory=list)


class ModelCredentialResponse(ResponseModel):
    credentials: dict[str, Any] = Field(default_factory=dict)
    current_credential_id: str | None = None
    current_credential_name: str | None = None
    load_balancing: ModelCredentialLoadBalancingResponse
    available_credentials: list[CredentialConfiguration]


class ModelCredentialValidateResponse(ResponseModel):
    result: str
    error: str | None = None


class ModelParameterRulesResponse(ResponseModel):
    data: list[ParameterRule]


register_schema_models(
    console_ns,
    ParserGetDefault,
    ParserPostDefault,
    ParserDeleteModels,
    ParserPostModels,
    ParserGetCredentials,
    ParserCreateCredential,
    ParserUpdateCredential,
    ParserDeleteCredential,
    ParserParameter,
    Inner,
    ParserSwitch,
)
register_response_schema_models(
    console_ns,
    SimpleResultResponse,
    DefaultModelDataResponse,
    ModelWithProviderListResponse,
    ProviderWithModelsDataResponse,
    ModelCredentialResponse,
    ModelCredentialValidateResponse,
    ModelParameterRulesResponse,
)

register_enum_models(console_ns, ModelType)


@console_ns.route("/workspaces/current/default-model")
class DefaultModelApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserGetDefault))
    @console_ns.response(200, "Success", console_ns.models[DefaultModelDataResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        args = ParserGetDefault.model_validate(request.args.to_dict(flat=True))

        model_provider_service = ModelProviderService()
        default_model_entity = model_provider_service.get_default_model_of_model_type(
            tenant_id=tenant_id, model_type=args.model_type
        )

        return jsonable_encoder({"data": default_model_entity})

    @console_ns.expect(console_ns.models[ParserPostDefault.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str):
        args = ParserPostDefault.model_validate(console_ns.payload)
        model_provider_service = ModelProviderService()
        model_settings = args.model_settings
        for model_setting in model_settings:
            if model_setting.provider is None:
                continue

            try:
                model_provider_service.update_default_model_of_model_type(
                    tenant_id=tenant_id,
                    model_type=model_setting.model_type,
                    provider=model_setting.provider,
                    model=cast(str, model_setting.model),
                )
            except Exception as ex:
                logger.exception(
                    "Failed to update default model, model type: %s, model: %s",
                    model_setting.model_type,
                    model_setting.model,
                )
                raise ex

        return {"result": "success"}


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models")
class ModelProviderModelApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[ModelWithProviderListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, provider: str):
        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_provider(tenant_id=tenant_id, provider=provider)

        return jsonable_encoder({"data": models})

    @console_ns.expect(console_ns.models[ParserPostModels.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, provider: str):
        # To save the model's load balance configs
        args = ParserPostModels.model_validate(console_ns.payload)

        if args.config_from == "custom-model":
            if not args.credential_id:
                raise ValueError("credential_id is required when configuring a custom-model")
            service = ModelProviderService()
            service.switch_active_custom_model_credential(
                tenant_id=tenant_id,
                provider=provider,
                model_type=args.model_type,
                model=args.model,
                credential_id=args.credential_id,
            )

        model_load_balancing_service = ModelLoadBalancingService()

        if args.load_balancing and args.load_balancing.configs:
            # save load balancing configs
            model_load_balancing_service.update_load_balancing_configs(
                tenant_id=tenant_id,
                provider=provider,
                model=args.model,
                model_type=args.model_type,
                configs=args.load_balancing.configs,
                config_from=args.config_from or "",
            )

            if args.load_balancing.enabled:
                model_load_balancing_service.enable_model_load_balancing(
                    tenant_id=tenant_id, provider=provider, model=args.model, model_type=args.model_type
                )
            else:
                model_load_balancing_service.disable_model_load_balancing(
                    tenant_id=tenant_id, provider=provider, model=args.model, model_type=args.model_type
                )

        return {"result": "success"}, 200

    @console_ns.expect(console_ns.models[ParserDeleteModels.__name__])
    @console_ns.response(204, "Model deleted successfully")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def delete(self, tenant_id: str, provider: str):
        args = ParserDeleteModels.model_validate(console_ns.payload)

        model_provider_service = ModelProviderService()
        model_provider_service.remove_model(
            tenant_id=tenant_id, provider=provider, model=args.model, model_type=args.model_type
        )

        return "", 204


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models/credentials")
class ModelProviderModelCredentialApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserGetCredentials))
    @console_ns.response(200, "Success", console_ns.models[ModelCredentialResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account, provider: str):
        args = ParserGetCredentials.model_validate(request.args.to_dict(flat=True))

        model_provider_service = ModelProviderService()
        current_credential = model_provider_service.get_model_credential(
            tenant_id=tenant_id,
            provider=provider,
            model_type=args.model_type,
            model=args.model,
            credential_id=args.credential_id,
        )

        model_load_balancing_service = ModelLoadBalancingService()
        is_load_balancing_enabled, load_balancing_configs = model_load_balancing_service.get_load_balancing_configs(
            tenant_id=tenant_id,
            provider=provider,
            model=args.model,
            model_type=args.model_type,
            config_from=args.config_from or "",
        )

        if args.config_from == "predefined-model":
            # Only the predefined-model branch needs visibility filtering by user.
            # The account is injected once by the handler and only passed into the
            # service branch that needs user-scoped credential visibility.
            available_credentials = model_provider_service.get_provider_available_credentials(
                tenant_id=tenant_id,
                provider=provider,
                user=user,
            )
        else:
            available_credentials = model_provider_service.get_provider_model_available_credentials(
                tenant_id=tenant_id,
                provider=provider,
                model_type=args.model_type,
                model=args.model,
            )

        return jsonable_encoder(
            {
                "credentials": current_credential.get("credentials") if current_credential else {},
                "current_credential_id": current_credential.get("current_credential_id")
                if current_credential
                else None,
                "current_credential_name": current_credential.get("current_credential_name")
                if current_credential
                else None,
                "load_balancing": {"enabled": is_load_balancing_enabled, "configs": load_balancing_configs},
                "available_credentials": available_credentials,
            }
        )

    @console_ns.expect(console_ns.models[ParserCreateCredential.__name__])
    @console_ns.response(201, "Credential created successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_CREATE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, provider: str):
        args = ParserCreateCredential.model_validate(console_ns.payload)

        model_provider_service = ModelProviderService()

        try:
            model_provider_service.create_model_credential(
                tenant_id=tenant_id,
                provider=provider,
                model=args.model,
                model_type=args.model_type,
                credentials=args.credentials,
                credential_name=args.name,
            )
        except CredentialsValidateFailedError as ex:
            logger.exception(
                "Failed to save model credentials, tenant_id: %s, model: %s, model_type: %s",
                tenant_id,
                args.model,
                args.model_type,
            )
            raise ValueError(str(ex))

        return {"result": "success"}, 201

    @console_ns.expect(console_ns.models[ParserUpdateCredential.__name__])
    @console_ns.response(200, "Credential updated successfully", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def put(self, current_tenant_id: str, provider: str):
        args = ParserUpdateCredential.model_validate(console_ns.payload)

        model_provider_service = ModelProviderService()

        try:
            model_provider_service.update_model_credential(
                tenant_id=current_tenant_id,
                provider=provider,
                model_type=args.model_type,
                model=args.model,
                credentials=args.credentials,
                credential_id=args.credential_id,
                credential_name=args.name,
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {"result": "success"}

    @console_ns.expect(console_ns.models[ParserDeleteCredential.__name__])
    @console_ns.response(204, "Credential deleted successfully")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, provider: str):
        args = ParserDeleteCredential.model_validate(console_ns.payload)

        model_provider_service = ModelProviderService()
        model_provider_service.remove_model_credential(
            tenant_id=current_tenant_id,
            provider=provider,
            model_type=args.model_type,
            model=args.model,
            credential_id=args.credential_id,
        )

        return "", 204


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models/credentials/switch")
class ModelProviderModelCredentialSwitchApi(Resource):
    @console_ns.expect(console_ns.models[ParserSwitch.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_USE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str, provider: str):
        args = ParserSwitch.model_validate(console_ns.payload)

        service = ModelProviderService()
        service.add_model_credential_to_model_list(
            tenant_id=current_tenant_id,
            provider=provider,
            model_type=args.model_type,
            model=args.model,
            credential_id=args.credential_id,
        )
        return {"result": "success"}


@console_ns.route(
    "/workspaces/current/model-providers/<path:provider>/models/enable", endpoint="model-provider-model-enable"
)
class ModelProviderModelEnableApi(Resource):
    @console_ns.expect(console_ns.models[ParserDeleteModels.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    def patch(self, tenant_id: str, provider: str):
        args = ParserDeleteModels.model_validate(console_ns.payload)

        model_provider_service = ModelProviderService()
        model_provider_service.enable_model(
            tenant_id=tenant_id, provider=provider, model=args.model, model_type=args.model_type
        )

        return {"result": "success"}


@console_ns.route(
    "/workspaces/current/model-providers/<path:provider>/models/disable", endpoint="model-provider-model-disable"
)
class ModelProviderModelDisableApi(Resource):
    @console_ns.expect(console_ns.models[ParserDeleteModels.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    def patch(self, tenant_id: str, provider: str):
        args = ParserDeleteModels.model_validate(console_ns.payload)

        model_provider_service = ModelProviderService()
        model_provider_service.disable_model(
            tenant_id=tenant_id, provider=provider, model=args.model, model_type=args.model_type
        )

        return {"result": "success"}


class ParserValidate(BaseModel):
    model: str
    model_type: ModelType
    credentials: dict[str, Any]


register_schema_models(console_ns, ParserSwitch, ParserValidate)


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models/credentials/validate")
class ModelProviderModelValidateApi(Resource):
    @console_ns.expect(console_ns.models[ParserValidate.__name__])
    @console_ns.response(
        200,
        "Credential validation result",
        console_ns.models[ModelCredentialValidateResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, provider: str):
        args = ParserValidate.model_validate(console_ns.payload)

        model_provider_service = ModelProviderService()

        result = True
        error = ""

        try:
            model_provider_service.validate_model_credentials(
                tenant_id=tenant_id,
                provider=provider,
                model=args.model,
                model_type=args.model_type,
                credentials=args.credentials,
            )
        except CredentialsValidateFailedError as ex:
            result = False
            error = str(ex)

        response = {"result": "success" if result else "error"}

        if not result:
            response["error"] = error or ""

        return response


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models/parameter-rules")
class ModelProviderModelParameterRuleApi(Resource):
    @console_ns.doc(params=query_params_from_model(ParserParameter))
    @console_ns.response(200, "Success", console_ns.models[ModelParameterRulesResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, provider: str):
        args = ParserParameter.model_validate(request.args.to_dict(flat=True))

        model_provider_service = ModelProviderService()
        parameter_rules = model_provider_service.get_model_parameter_rules(
            tenant_id=tenant_id, provider=provider, model=args.model
        )

        return jsonable_encoder({"data": parameter_rules})


@console_ns.route("/workspaces/current/models/model-types/<string:model_type>")
class ModelProviderAvailableModelApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[ProviderWithModelsDataResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, model_type: str):
        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_model_type(tenant_id=tenant_id, model_type=model_type)

        return jsonable_encoder({"data": models})
