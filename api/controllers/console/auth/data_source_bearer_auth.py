from flask_restx import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.auth.error import ApiKeyAuthFailedError
from libs.login import current_account_with_tenant, login_required
from services.auth.api_key_auth_service import ApiKeyAuthService

from ..wraps import account_initialization_required, setup_required


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
    def post(self):
        # The role of the current user in the table must be admin or owner
        current_user, current_tenant_id = current_account_with_tenant()

        if not current_user.is_admin_or_owner:
            raise Forbidden()
        parser = (
            reqparse.RequestParser()
            .add_argument("category", type=str, required=True, nullable=False, location="json")
            .add_argument("provider", type=str, required=True, nullable=False, location="json")
            .add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()
        ApiKeyAuthService.validate_api_key_auth_args(args)
        try:
            ApiKeyAuthService.create_provider_auth(current_tenant_id, args)
        except Exception as e:
            raise ApiKeyAuthFailedError(str(e))
        return {"result": "success"}, 200


@console_ns.route("/api-key-auth/data-source/<uuid:binding_id>")
class ApiKeyAuthDataSourceBindingDelete(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, binding_id):
        # The role of the current user in the table must be admin or owner
        current_user, current_tenant_id = current_account_with_tenant()

        if not current_user.is_admin_or_owner:
            raise Forbidden()

        ApiKeyAuthService.delete_provider_auth(current_tenant_id, binding_id)

        return {"result": "success"}, 204
