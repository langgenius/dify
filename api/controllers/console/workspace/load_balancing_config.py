from flask_restx import Resource
from pydantic import BaseModel
from werkzeug.exceptions import Forbidden

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from libs.login import current_account_with_tenant, login_required
from models import TenantAccountRole
from services.model_load_balancing_service import ModelLoadBalancingService


class LoadBalancingCredentialPayload(BaseModel):
    model: str
    model_type: ModelType
    credentials: dict[str, object]


register_schema_models(console_ns, LoadBalancingCredentialPayload)


@console_ns.route(
    "/workspaces/current/model-providers/<path:provider>/models/load-balancing-configs/credentials-validate"
)
class LoadBalancingCredentialsValidateApi(Resource):
    @console_ns.expect(console_ns.models[LoadBalancingCredentialPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str):
        current_user, current_tenant_id = current_account_with_tenant()
        if not TenantAccountRole.is_privileged_role(current_user.current_role):
            raise Forbidden()

        tenant_id = current_tenant_id

        payload = LoadBalancingCredentialPayload.model_validate(console_ns.payload or {})

        # validate model load balancing credentials
        model_load_balancing_service = ModelLoadBalancingService()

        result = True
        error = ""

        try:
            model_load_balancing_service.validate_load_balancing_credentials(
                tenant_id=tenant_id,
                provider=provider,
                model=payload.model,
                model_type=payload.model_type,
                credentials=payload.credentials,
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
    @console_ns.expect(console_ns.models[LoadBalancingCredentialPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider: str, config_id: str):
        current_user, current_tenant_id = current_account_with_tenant()
        if not TenantAccountRole.is_privileged_role(current_user.current_role):
            raise Forbidden()

        tenant_id = current_tenant_id

        payload = LoadBalancingCredentialPayload.model_validate(console_ns.payload or {})

        # validate model load balancing config credentials
        model_load_balancing_service = ModelLoadBalancingService()

        result = True
        error = ""

        try:
            model_load_balancing_service.validate_load_balancing_credentials(
                tenant_id=tenant_id,
                provider=provider,
                model=payload.model,
                model_type=payload.model_type,
                credentials=payload.credentials,
                config_id=config_id,
            )
        except CredentialsValidateFailedError as ex:
            result = False
            error = str(ex)

        response = {"result": "success" if result else "error"}

        if not result:
            response["error"] = error

        return response
