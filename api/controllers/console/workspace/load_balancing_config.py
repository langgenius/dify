from flask_restx import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from libs.login import current_account_with_tenant, login_required
from models import TenantAccountRole
from services.model_load_balancing_service import ModelLoadBalancingService


@console_ns.route(
    "/workspaces/current/model-providers/<path:provider>/models/load-balancing-configs/credentials-validate"
)
class LoadBalancingCredentialsValidateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        current_user, current_tenant_id = current_account_with_tenant()
        if not TenantAccountRole.is_privileged_role(current_user.current_role):
            raise Forbidden()

        tenant_id = current_tenant_id

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

        # validate model load balancing credentials
        model_load_balancing_service = ModelLoadBalancingService()

        result = True
        error = ""

        try:
            model_load_balancing_service.validate_load_balancing_credentials(
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


@console_ns.route(
    "/workspaces/current/model-providers/<path:provider>/models/load-balancing-configs/<string:config_id>/credentials-validate"
)
class LoadBalancingConfigCredentialsValidateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str, config_id: str):
        current_user, current_tenant_id = current_account_with_tenant()
        if not TenantAccountRole.is_privileged_role(current_user.current_role):
            raise Forbidden()

        tenant_id = current_tenant_id

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

        # validate model load balancing config credentials
        model_load_balancing_service = ModelLoadBalancingService()

        result = True
        error = ""

        try:
            model_load_balancing_service.validate_load_balancing_credentials(
                tenant_id=tenant_id,
                provider=provider,
                model=args["model"],
                model_type=args["model_type"],
                credentials=args["credentials"],
                config_id=config_id,
            )
        except CredentialsValidateFailedError as ex:
            result = False
            error = str(ex)

        response = {"result": "success" if result else "error"}

        if not result:
            response["error"] = error

        return response
