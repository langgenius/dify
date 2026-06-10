from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import register_response_schema_models, register_schema_models
from fields.base import ResponseModel
from libs.login import login_required
from services.auth.api_key_auth_service import ApiKeyAuthService

from .. import console_ns
from ..auth.error import ApiKeyAuthFailedError
from ..wraps import account_initialization_required, is_admin_or_owner_required, setup_required, with_current_tenant_id


class ApiKeyAuthBindingPayload(BaseModel):
    category: str = Field(...)
    provider: str = Field(...)
    credentials: dict = Field(...)


class ApiKeyAuthDataSourceItem(ResponseModel):
    id: str
    category: str
    provider: str
    disabled: bool
    created_at: int
    updated_at: int


class ApiKeyAuthDataSourceListResponse(ResponseModel):
    sources: list[ApiKeyAuthDataSourceItem]


register_schema_models(console_ns, ApiKeyAuthBindingPayload)
register_response_schema_models(console_ns, ApiKeyAuthDataSourceItem, ApiKeyAuthDataSourceListResponse)


@console_ns.route("/api-key-auth/data-source")
class ApiKeyAuthDataSource(Resource):
    @console_ns.response(200, "Success", console_ns.models[ApiKeyAuthDataSourceListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
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
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        # The role of the current user in the table must be admin or owner
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
    @console_ns.response(204, "Binding deleted successfully")
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, binding_id: UUID):
        # The role of the current user in the table must be admin or owner
        ApiKeyAuthService.delete_provider_auth(current_tenant_id, str(binding_id))

        return "", 204
