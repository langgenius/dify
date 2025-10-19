import logging

from flask_restx import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.helper import StrLen, uuid_value
from libs.login import current_account_with_tenant, login_required
from services.model_load_balancing_service import ModelLoadBalancingService
from services.model_provider_service import ModelProviderService

logger = logging.getLogger(__name__)


@console_ns.route("/workspaces/current/default-model")
class DefaultModelApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, tenant_id = current_account_with_tenant()

        parser = reqparse.RequestParser().add_argument(
            "model_type",
            type=str,
            required=True,
            nullable=False,
            choices=[mt.value for mt in ModelType],
            location="args",
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        default_model_entity = model_provider_service.get_default_model_of_model_type(
            tenant_id=tenant_id, model_type=args["model_type"]
        )

        return jsonable_encoder({"data": default_model_entity})

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, tenant_id = current_account_with_tenant()

        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser().add_argument(
            "model_settings", type=list, required=True, nullable=False, location="json"
        )
        args = parser.parse_args()
        model_provider_service = ModelProviderService()
        model_settings = args["model_settings"]
        for model_setting in model_settings:
            if "model_type" not in model_setting or model_setting["model_type"] not in [mt.value for mt in ModelType]:
                raise ValueError("invalid model type")

            if "provider" not in model_setting:
                continue

            if "model" not in model_setting:
                raise ValueError("invalid model")

            try:
                model_provider_service.update_default_model_of_model_type(
                    tenant_id=tenant_id,
                    model_type=model_setting["model_type"],
                    provider=model_setting["provider"],
                    model=model_setting["model"],
                )
            except Exception as ex:
                logger.exception(
                    "Failed to update default model, model type: %s, model: %s",
                    model_setting["model_type"],
                    model_setting.get("model"),
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

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        # To save the model's load balance configs
        current_user, tenant_id = current_account_with_tenant()

        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("model", type=str, required=True, nullable=False, location="json")
            .add_argument(
                "model_type",
                type=str,
                required=True,
                nullable=False,
                choices=[mt.value for mt in ModelType],
                location="json",
            )
            .add_argument("load_balancing", type=dict, required=False, nullable=True, location="json")
            .add_argument("config_from", type=str, required=False, nullable=True, location="json")
            .add_argument("credential_id", type=uuid_value, required=False, nullable=True, location="json")
        )
        args = parser.parse_args()

        if args.get("config_from", "") == "custom-model":
            if not args.get("credential_id"):
                raise ValueError("credential_id is required when configuring a custom-model")
            service = ModelProviderService()
            service.switch_active_custom_model_credential(
                tenant_id=tenant_id,
                provider=provider,
                model_type=args["model_type"],
                model=args["model"],
                credential_id=args["credential_id"],
            )

        model_load_balancing_service = ModelLoadBalancingService()

        if "load_balancing" in args and args["load_balancing"] and "configs" in args["load_balancing"]:
            # save load balancing configs
            model_load_balancing_service.update_load_balancing_configs(
                tenant_id=tenant_id,
                provider=provider,
                model=args["model"],
                model_type=args["model_type"],
                configs=args["load_balancing"]["configs"],
                config_from=args.get("config_from", ""),
            )

            if args.get("load_balancing", {}).get("enabled"):
                model_load_balancing_service.enable_model_load_balancing(
                    tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
                )
            else:
                model_load_balancing_service.disable_model_load_balancing(
                    tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
                )

        return {"result": "success"}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider: str):
        current_user, tenant_id = current_account_with_tenant()

        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("model", type=str, required=True, nullable=False, location="json")
            .add_argument(
                "model_type",
                type=str,
                required=True,
                nullable=False,
                choices=[mt.value for mt in ModelType],
                location="json",
            )
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.remove_model(
            tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
        )

        return {"result": "success"}, 204


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models/credentials")
class ModelProviderModelCredentialApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        _, tenant_id = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("model", type=str, required=True, nullable=False, location="args")
            .add_argument(
                "model_type",
                type=str,
                required=True,
                nullable=False,
                choices=[mt.value for mt in ModelType],
                location="args",
            )
            .add_argument("config_from", type=str, required=False, nullable=True, location="args")
            .add_argument("credential_id", type=uuid_value, required=False, nullable=True, location="args")
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        current_credential = model_provider_service.get_model_credential(
            tenant_id=tenant_id,
            provider=provider,
            model_type=args["model_type"],
            model=args["model"],
            credential_id=args.get("credential_id"),
        )

        model_load_balancing_service = ModelLoadBalancingService()
        is_load_balancing_enabled, load_balancing_configs = model_load_balancing_service.get_load_balancing_configs(
            tenant_id=tenant_id,
            provider=provider,
            model=args["model"],
            model_type=args["model_type"],
            config_from=args.get("config_from", ""),
        )

        if args.get("config_from", "") == "predefined-model":
            available_credentials = model_provider_service.provider_manager.get_provider_available_credentials(
                tenant_id=tenant_id, provider_name=provider
            )
        else:
            model_type = ModelType.value_of(args["model_type"]).to_origin_model_type()
            available_credentials = model_provider_service.provider_manager.get_provider_model_available_credentials(
                tenant_id=tenant_id, provider_name=provider, model_type=model_type, model_name=args["model"]
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

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        current_user, tenant_id = current_account_with_tenant()

        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("model", type=str, required=True, nullable=False, location="json")
            .add_argument(
                "model_type",
                type=str,
                required=True,
                nullable=False,
                choices=[mt.value for mt in ModelType],
                location="json",
            )
            .add_argument("name", type=StrLen(30), required=False, nullable=True, location="json")
            .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()

        try:
            model_provider_service.create_model_credential(
                tenant_id=tenant_id,
                provider=provider,
                model=args["model"],
                model_type=args["model_type"],
                credentials=args["credentials"],
                credential_name=args["name"],
            )
        except CredentialsValidateFailedError as ex:
            logger.exception(
                "Failed to save model credentials, tenant_id: %s, model: %s, model_type: %s",
                tenant_id,
                args.get("model"),
                args.get("model_type"),
            )
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
            .add_argument("model", type=str, required=True, nullable=False, location="json")
            .add_argument(
                "model_type",
                type=str,
                required=True,
                nullable=False,
                choices=[mt.value for mt in ModelType],
                location="json",
            )
            .add_argument("credential_id", type=uuid_value, required=True, nullable=False, location="json")
            .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
            .add_argument("name", type=StrLen(30), required=False, nullable=True, location="json")
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()

        try:
            model_provider_service.update_model_credential(
                tenant_id=current_tenant_id,
                provider=provider,
                model_type=args["model_type"],
                model=args["model"],
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
        parser = (
            reqparse.RequestParser()
            .add_argument("model", type=str, required=True, nullable=False, location="json")
            .add_argument(
                "model_type",
                type=str,
                required=True,
                nullable=False,
                choices=[mt.value for mt in ModelType],
                location="json",
            )
            .add_argument("credential_id", type=uuid_value, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.remove_model_credential(
            tenant_id=current_tenant_id,
            provider=provider,
            model_type=args["model_type"],
            model=args["model"],
            credential_id=args["credential_id"],
        )

        return {"result": "success"}, 204


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models/credentials/switch")
class ModelProviderModelCredentialSwitchApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        current_user, current_tenant_id = current_account_with_tenant()

        if not current_user.is_admin_or_owner:
            raise Forbidden()
        parser = (
            reqparse.RequestParser()
            .add_argument("model", type=str, required=True, nullable=False, location="json")
            .add_argument(
                "model_type",
                type=str,
                required=True,
                nullable=False,
                choices=[mt.value for mt in ModelType],
                location="json",
            )
            .add_argument("credential_id", type=str, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()

        service = ModelProviderService()
        service.add_model_credential_to_model_list(
            tenant_id=current_tenant_id,
            provider=provider,
            model_type=args["model_type"],
            model=args["model"],
            credential_id=args["credential_id"],
        )
        return {"result": "success"}


@console_ns.route(
    "/workspaces/current/model-providers/<path:provider>/models/enable", endpoint="model-provider-model-enable"
)
class ModelProviderModelEnableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, provider: str):
        _, tenant_id = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("model", type=str, required=True, nullable=False, location="json")
            .add_argument(
                "model_type",
                type=str,
                required=True,
                nullable=False,
                choices=[mt.value for mt in ModelType],
                location="json",
            )
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.enable_model(
            tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
        )

        return {"result": "success"}


@console_ns.route(
    "/workspaces/current/model-providers/<path:provider>/models/disable", endpoint="model-provider-model-disable"
)
class ModelProviderModelDisableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, provider: str):
        _, tenant_id = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("model", type=str, required=True, nullable=False, location="json")
            .add_argument(
                "model_type",
                type=str,
                required=True,
                nullable=False,
                choices=[mt.value for mt in ModelType],
                location="json",
            )
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.disable_model(
            tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
        )

        return {"result": "success"}


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models/credentials/validate")
class ModelProviderModelValidateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        _, tenant_id = current_account_with_tenant()

        parser = (
            reqparse.RequestParser()
            .add_argument("model", type=str, required=True, nullable=False, location="json")
            .add_argument(
                "model_type",
                type=str,
                required=True,
                nullable=False,
                choices=[mt.value for mt in ModelType],
                location="json",
            )
            .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()

        result = True
        error = ""

        try:
            model_provider_service.validate_model_credentials(
                tenant_id=tenant_id,
                provider=provider,
                model=args["model"],
                model_type=args["model_type"],
                credentials=args["credentials"],
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
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        parser = reqparse.RequestParser().add_argument(
            "model", type=str, required=True, nullable=False, location="args"
        )
        args = parser.parse_args()
        _, tenant_id = current_account_with_tenant()

        model_provider_service = ModelProviderService()
        parameter_rules = model_provider_service.get_model_parameter_rules(
            tenant_id=tenant_id, provider=provider, model=args["model"]
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
