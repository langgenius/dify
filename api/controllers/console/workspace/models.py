import logging

from flask_login import current_user
from flask_restful import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.login import login_required
from services.model_load_balancing_service import ModelLoadBalancingService
from services.model_provider_service import ModelProviderService


class DefaultModelApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument(
            "model_type",
            type=str,
            required=True,
            nullable=False,
            choices=[mt.value for mt in ModelType],
            location="args",
        )
        args = parser.parse_args()

        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        default_model_entity = model_provider_service.get_default_model_of_model_type(
            tenant_id=tenant_id, model_type=args["model_type"]
        )

        return jsonable_encoder({"data": default_model_entity})

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("model_settings", type=list, required=True, nullable=False, location="json")
        args = parser.parse_args()

        tenant_id = current_user.current_tenant_id

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
            except Exception:
                logging.warning(f"{model_setting['model_type']} save error")

        return {"result": "success"}


class ModelProviderModelApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_provider(tenant_id=tenant_id, provider=provider)

        return jsonable_encoder({"data": models})

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("model", type=str, required=True, nullable=False, location="json")
        parser.add_argument(
            "model_type",
            type=str,
            required=True,
            nullable=False,
            choices=[mt.value for mt in ModelType],
            location="json",
        )
        parser.add_argument("credentials", type=dict, required=False, nullable=True, location="json")
        parser.add_argument("load_balancing", type=dict, required=False, nullable=True, location="json")
        parser.add_argument("config_from", type=str, required=False, nullable=True, location="json")
        args = parser.parse_args()

        model_load_balancing_service = ModelLoadBalancingService()

        if (
            "load_balancing" in args
            and args["load_balancing"]
            and "enabled" in args["load_balancing"]
            and args["load_balancing"]["enabled"]
        ):
            if "configs" not in args["load_balancing"]:
                raise ValueError("invalid load balancing configs")

            # save load balancing configs
            model_load_balancing_service.update_load_balancing_configs(
                tenant_id=tenant_id,
                provider=provider,
                model=args["model"],
                model_type=args["model_type"],
                configs=args["load_balancing"]["configs"],
            )

            # enable load balancing
            model_load_balancing_service.enable_model_load_balancing(
                tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
            )
        else:
            # disable load balancing
            model_load_balancing_service.disable_model_load_balancing(
                tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
            )

            if args.get("config_from", "") != "predefined-model":
                model_provider_service = ModelProviderService()

                try:
                    model_provider_service.save_model_credentials(
                        tenant_id=tenant_id,
                        provider=provider,
                        model=args["model"],
                        model_type=args["model_type"],
                        credentials=args["credentials"],
                    )
                except CredentialsValidateFailedError as ex:
                    logging.exception(f"save model credentials error: {ex}")
                    raise ValueError(str(ex))

        return {"result": "success"}, 200

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider: str):
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("model", type=str, required=True, nullable=False, location="json")
        parser.add_argument(
            "model_type",
            type=str,
            required=True,
            nullable=False,
            choices=[mt.value for mt in ModelType],
            location="json",
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.remove_model_credentials(
            tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
        )

        return {"result": "success"}, 204


class ModelProviderModelCredentialApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("model", type=str, required=True, nullable=False, location="args")
        parser.add_argument(
            "model_type",
            type=str,
            required=True,
            nullable=False,
            choices=[mt.value for mt in ModelType],
            location="args",
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        credentials = model_provider_service.get_model_credentials(
            tenant_id=tenant_id, provider=provider, model_type=args["model_type"], model=args["model"]
        )

        model_load_balancing_service = ModelLoadBalancingService()
        is_load_balancing_enabled, load_balancing_configs = model_load_balancing_service.get_load_balancing_configs(
            tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
        )

        return {
            "credentials": credentials,
            "load_balancing": {"enabled": is_load_balancing_enabled, "configs": load_balancing_configs},
        }


class ModelProviderModelEnableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, provider: str):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("model", type=str, required=True, nullable=False, location="json")
        parser.add_argument(
            "model_type",
            type=str,
            required=True,
            nullable=False,
            choices=[mt.value for mt in ModelType],
            location="json",
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.enable_model(
            tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
        )

        return {"result": "success"}


class ModelProviderModelDisableApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, provider: str):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("model", type=str, required=True, nullable=False, location="json")
        parser.add_argument(
            "model_type",
            type=str,
            required=True,
            nullable=False,
            choices=[mt.value for mt in ModelType],
            location="json",
        )
        args = parser.parse_args()

        model_provider_service = ModelProviderService()
        model_provider_service.disable_model(
            tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
        )

        return {"result": "success"}


class ModelProviderModelValidateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        tenant_id = current_user.current_tenant_id

        parser = reqparse.RequestParser()
        parser.add_argument("model", type=str, required=True, nullable=False, location="json")
        parser.add_argument(
            "model_type",
            type=str,
            required=True,
            nullable=False,
            choices=[mt.value for mt in ModelType],
            location="json",
        )
        parser.add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        args = parser.parse_args()

        model_provider_service = ModelProviderService()

        result = True
        error = None

        try:
            model_provider_service.model_credentials_validate(
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
            response["error"] = error

        return response


class ModelProviderModelParameterRuleApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        parser = reqparse.RequestParser()
        parser.add_argument("model", type=str, required=True, nullable=False, location="args")
        args = parser.parse_args()

        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        parameter_rules = model_provider_service.get_model_parameter_rules(
            tenant_id=tenant_id, provider=provider, model=args["model"]
        )

        return jsonable_encoder({"data": parameter_rules})


class ModelProviderAvailableModelApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, model_type):
        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_model_type(tenant_id=tenant_id, model_type=model_type)

        return jsonable_encoder({"data": models})


api.add_resource(ModelProviderModelApi, "/workspaces/current/model-providers/<string:provider>/models")
api.add_resource(
    ModelProviderModelEnableApi,
    "/workspaces/current/model-providers/<string:provider>/models/enable",
    endpoint="model-provider-model-enable",
)
api.add_resource(
    ModelProviderModelDisableApi,
    "/workspaces/current/model-providers/<string:provider>/models/disable",
    endpoint="model-provider-model-disable",
)
api.add_resource(
    ModelProviderModelCredentialApi, "/workspaces/current/model-providers/<string:provider>/models/credentials"
)
api.add_resource(
    ModelProviderModelValidateApi, "/workspaces/current/model-providers/<string:provider>/models/credentials/validate"
)

api.add_resource(
    ModelProviderModelParameterRuleApi, "/workspaces/current/model-providers/<string:provider>/models/parameter-rules"
)
api.add_resource(ModelProviderAvailableModelApi, "/workspaces/current/models/model-types/<string:model_type>")
api.add_resource(DefaultModelApi, "/workspaces/current/default-model")
