import logging
from typing import Any, cast

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, is_admin_or_owner_required, setup_required
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.helper import uuid_value
from libs.login import current_account_with_tenant, login_required
from services.model_load_balancing_service import ModelLoadBalancingService
from services.model_provider_service import ModelProviderService

logger = logging.getLogger(__name__)
DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class ParserGetDefault(BaseModel):
    model_type: ModelType


class ParserPostDefault(BaseModel):
    class Inner(BaseModel):
        model_type: ModelType
        model: str | None = None
        provider: str | None = None

    model_settings: list[Inner]


class ParserDeleteModels(BaseModel):
    model: str
    model_type: ModelType


class LoadBalancingPayload(BaseModel):
    configs: list[dict[str, Any]] | None = None
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


def reg(cls: type[BaseModel]):
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


reg(ParserGetDefault)
reg(ParserPostDefault)
reg(ParserDeleteModels)
reg(ParserPostModels)
reg(ParserGetCredentials)
reg(ParserCreateCredential)
reg(ParserUpdateCredential)
reg(ParserDeleteCredential)
reg(ParserParameter)


@console_ns.route("/workspaces/current/default-model")
class DefaultModelApi(Resource):
    @console_ns.expect(console_ns.models[ParserGetDefault.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, tenant_id = current_account_with_tenant()

        args = ParserGetDefault.model_validate(request.args.to_dict(flat=True))  # type: ignore

        model_provider_service = ModelProviderService()
        default_model_entity = model_provider_service.get_default_model_of_model_type(
            tenant_id=tenant_id, model_type=args.model_type
        )

        return jsonable_encoder({"data": default_model_entity})

    @console_ns.expect(console_ns.models[ParserPostDefault.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self):
        _, tenant_id = current_account_with_tenant()

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
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        _, tenant_id = current_account_with_tenant()

        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_provider(tenant_id=tenant_id, provider=provider)

        return jsonable_encoder({"data": models})

    @console_ns.expect(console_ns.models[ParserPostModels.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider: str):
        # To save the model's load balance configs
        _, tenant_id = current_account_with_tenant()
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

    @console_ns.expect(console_ns.models[ParserDeleteModels.__name__], validate=True)
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def delete(self, provider: str):
        _, tenant_id = current_account_with_tenant()

        args = ParserDeleteModels.model_validate(console_ns.payload)

        model_provider_service = ModelProviderService()
        model_provider_service.remove_model(
            tenant_id=tenant_id, provider=provider, model=args.model, model_type=args.model_type
        )

        return {"result": "success"}, 204


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models/credentials")
class ModelProviderModelCredentialApi(Resource):
    @console_ns.expect(console_ns.models[ParserGetCredentials.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        _, tenant_id = current_account_with_tenant()

        args = ParserGetCredentials.model_validate(request.args.to_dict(flat=True))  # type: ignore

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
            available_credentials = model_provider_service.provider_manager.get_provider_available_credentials(
                tenant_id=tenant_id, provider_name=provider
            )
        else:
            model_type = args.model_type
            available_credentials = model_provider_service.provider_manager.get_provider_model_available_credentials(
                tenant_id=tenant_id, provider_name=provider, model_type=model_type, model_name=args.model
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
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider: str):
        _, tenant_id = current_account_with_tenant()

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
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def put(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
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
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def delete(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
        args = ParserDeleteCredential.model_validate(console_ns.payload)

        model_provider_service = ModelProviderService()
        model_provider_service.remove_model_credential(
            tenant_id=current_tenant_id,
            provider=provider,
            model_type=args.model_type,
            model=args.model,
            credential_id=args.credential_id,
        )

        return {"result": "success"}, 204


class ParserSwitch(BaseModel):
    model: str
    model_type: ModelType
    credential_id: str


console_ns.schema_model(
    ParserSwitch.__name__, ParserSwitch.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
)


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models/credentials/switch")
class ModelProviderModelCredentialSwitchApi(Resource):
    @console_ns.expect(console_ns.models[ParserSwitch.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider: str):
        _, current_tenant_id = current_account_with_tenant()
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
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, provider: str):
        _, tenant_id = current_account_with_tenant()

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
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, provider: str):
        _, tenant_id = current_account_with_tenant()

        args = ParserDeleteModels.model_validate(console_ns.payload)

        model_provider_service = ModelProviderService()
        model_provider_service.disable_model(
            tenant_id=tenant_id, provider=provider, model=args.model, model_type=args.model_type
        )

        return {"result": "success"}


class ParserValidate(BaseModel):
    model: str
    model_type: ModelType
    credentials: dict


console_ns.schema_model(
    ParserValidate.__name__, ParserValidate.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
)


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models/credentials/validate")
class ModelProviderModelValidateApi(Resource):
    @console_ns.expect(console_ns.models[ParserValidate.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        _, tenant_id = current_account_with_tenant()
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
    @console_ns.expect(console_ns.models[ParserParameter.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        args = ParserParameter.model_validate(request.args.to_dict(flat=True))  # type: ignore
        _, tenant_id = current_account_with_tenant()

        model_provider_service = ModelProviderService()
        parameter_rules = model_provider_service.get_model_parameter_rules(
            tenant_id=tenant_id, provider=provider, model=args.model
        )

        return jsonable_encoder({"data": parameter_rules})


@console_ns.route("/workspaces/current/models/model-types/<string:model_type>")
class ModelProviderAvailableModelApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, model_type):
        _, tenant_id = current_account_with_tenant()
        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_model_type(tenant_id=tenant_id, model_type=model_type)

        return jsonable_encoder({"data": models})
