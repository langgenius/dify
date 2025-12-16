from flask_restx import Resource
from pydantic import BaseModel, Field

from libs.login import current_account_with_tenant, login_required
from services.auth.api_key_auth_service import ApiKeyAuthService

from .. import console_ns
from ..auth.error import ApiKeyAuthFailedError
from ..wraps import account_initialization_required, is_admin_or_owner_required, setup_required

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class ApiKeyAuthBindingPayload(BaseModel):
    category: str = Field(...)
    provider: str = Field(...)
    credentials: dict = Field(...)


console_ns.schema_model(
    ApiKeyAuthBindingPayload.__name__,
    ApiKeyAuthBindingPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@console_ns.route("/api-key-auth/data-source")
class ApiKeyAuthDataSource(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        data_source_api_key_bindings = ApiKeyAuthService.get_provider_auth_list(current_tenant_id)
        if data_source_api_key_bindings:
            return {
                "sources": [
                    {
                        "id": data_source_api_key_binding.id,
                        "category": data_source_api_key_binding.category,
                        "provider": data_source_api_key_binding.provider,
                        "disabled": data_source_api_key_binding.disabled,
                        "created_at": int(data_source_api_key_binding.created_at.timestamp()),
                        "updated_at": int(data_source_api_key_binding.updated_at.timestamp()),
                    }
                    for data_source_api_key_binding in data_source_api_key_bindings
                ]
            }
        return {"sources": []}


@console_ns.route("/api-key-auth/data-source/binding")
class ApiKeyAuthDataSourceBinding(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    @console_ns.expect(console_ns.models[ApiKeyAuthBindingPayload.__name__])
    def post(self):
        # The role of the current user in the table must be admin or owner
        _, current_tenant_id = current_account_with_tenant()
        payload = ApiKeyAuthBindingPayload.model_validate(console_ns.payload)
        data = payload.model_dump()
        ApiKeyAuthService.validate_api_key_auth_args(data)
        try:
            ApiKeyAuthService.create_provider_auth(current_tenant_id, data)
        except Exception as e:
            raise ApiKeyAuthFailedError(str(e))
        return {"result": "success"}, 200


@console_ns.route("/api-key-auth/data-source/<uuid:binding_id>")
class ApiKeyAuthDataSourceBindingDelete(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @is_admin_or_owner_required
    def delete(self, binding_id):
        # The role of the current user in the table must be admin or owner
        _, current_tenant_id = current_account_with_tenant()

        ApiKeyAuthService.delete_provider_auth(current_tenant_id, binding_id)

        return {"result": "success"}, 204
