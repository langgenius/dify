from flask_restx import Resource
from pydantic import BaseModel
from werkzeug.exceptions import Forbidden

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from fields.base import ResponseModel
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError
from libs.login import login_required
from models import Account, TenantAccountRole
from services.model_load_balancing_service import ModelLoadBalancingService


class LoadBalancingCredentialPayload(BaseModel):
    model: str
    model_type: ModelType
    credentials: dict[str, object]


class LoadBalancingCredentialValidateResponse(ResponseModel):
    result: str
    error: str | None = None


register_schema_models(console_ns, LoadBalancingCredentialPayload)
register_response_schema_models(console_ns, LoadBalancingCredentialValidateResponse)


@console_ns.route(
    "/workspaces/current/model-providers/<path:provider>/models/load-balancing-configs/credentials-validate"
)
class LoadBalancingCredentialsValidateApi(Resource):
    @console_ns.expect(console_ns.models[LoadBalancingCredentialPayload.__name__])
    @console_ns.response(
        200,
        "Credential validation result",
        console_ns.models[LoadBalancingCredentialValidateResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account, provider: str):
        if not TenantAccountRole.is_privileged_role(current_user.current_role):
            raise Forbidden()

        payload = LoadBalancingCredentialPayload.model_validate(console_ns.payload or {})

        # validate model load balancing credentials
        model_load_balancing_service = ModelLoadBalancingService()

        result = True
        error = ""

        try:
            model_load_balancing_service.validate_load_balancing_credentials(
                tenant_id=current_tenant_id,
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
    @console_ns.response(
        200,
        "Credential validation result",
        console_ns.models[LoadBalancingCredentialValidateResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account, provider: str, config_id: str):
        if not TenantAccountRole.is_privileged_role(current_user.current_role):
            raise Forbidden()

        payload = LoadBalancingCredentialPayload.model_validate(console_ns.payload or {})

        # validate model load balancing config credentials
        model_load_balancing_service = ModelLoadBalancingService()

        result = True
        error = ""

        try:
            model_load_balancing_service.validate_load_balancing_credentials(
                tenant_id=current_tenant_id,
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
