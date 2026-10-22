from flask_restx import Resource
from pydantic import BaseModel
from werkzeug.exceptions import Forbidden

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError
from libs.login import current_account_with_tenant
from machinery.context import RequestContext


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
    @console_account_admission()
    @model_validate(LoadBalancingCredentialPayload)
    def post(self, req_data: LoadBalancingCredentialPayload, request_context: RequestContext, provider: str):
        # Unlike allowed_roles in admission, this legacy gate also applies with RBAC enabled.
        if not TenantAccountRole.is_privileged_role(current_account_with_tenant().account.current_role):
            raise Forbidden()

        result = True
        error = ""

        try:
            application_services().model_load_balancing.validate_credentials(
                request_context,
                provider=provider,
                model=req_data.model,
                model_type=req_data.model_type,
                credentials=req_data.credentials,
                config_id=None,
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
    @console_account_admission()
    @model_validate(LoadBalancingCredentialPayload)
    def post(
        self,
        req_data: LoadBalancingCredentialPayload,
        request_context: RequestContext,
        provider: str,
        config_id: str,
    ):
        if not TenantAccountRole.is_privileged_role(current_account_with_tenant().account.current_role):
            raise Forbidden()

        result = True
        error = ""

        try:
            application_services().model_load_balancing.validate_credentials(
                request_context,
                provider=provider,
                model=req_data.model,
                model_type=req_data.model_type,
                credentials=req_data.credentials,
                config_id=config_id,
            )
        except CredentialsValidateFailedError as ex:
            result = False
            error = str(ex)

        response = {"result": "success" if result else "error"}

        if not result:
            response["error"] = error

        return response
