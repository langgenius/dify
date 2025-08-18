from flask import make_response
from flask_login import current_user
from flask_restful import Resource, fields, reqparse
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console import api
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import login_required
from services.workspace_api_key_service import WorkspaceApiKeyService

# Response field definitions
workspace_api_key_fields = {
    "id": fields.String,
    "name": fields.String,
    "type": fields.String,
    "scopes": fields.List(fields.String),
    "created_at": fields.DateTime(dt_format="iso8601"),
    "last_used_at": fields.DateTime(dt_format="iso8601"),
    "expires_at": fields.String,
    "is_expired": fields.Boolean,
    "created_by": fields.String,
}

workspace_api_key_list_fields = {"data": fields.List(fields.Nested(workspace_api_key_fields))}

workspace_api_key_create_fields = {
    "id": fields.String,
    "name": fields.String,
    "token": fields.String,
    "type": fields.String,
    "scopes": fields.List(fields.String),
    "created_at": fields.DateTime(dt_format="iso8601"),
    "expires_at": fields.DateTime(dt_format="iso8601"),
}


class WorkspaceApiKeysApi(Resource):
    def _add_security_headers(self, response):
        """Add security headers to response"""
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @setup_required
    @login_required(["workspace:admin"])
    @account_initialization_required
    def get(self):
        """Get list of workspace management API keys"""
        tenant_id = current_user.current_tenant_id
        api_keys = WorkspaceApiKeyService.get_workspace_api_keys(tenant_id)

        response = make_response({"data": api_keys})
        return self._add_security_headers(response)

    @setup_required
    @login_required(["workspace:admin"])
    @account_initialization_required
    def post(self):
        """Create workspace management API key"""
        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, location="json", help="API key name is required")
        from constants.workspace_scopes import DEFAULT_API_KEY_SCOPES

        parser.add_argument("scopes", type=list, default=DEFAULT_API_KEY_SCOPES, location="json")
        parser.add_argument("expires_in_days", type=int, default=30, location="json")

        try:
            args = parser.parse_args()
        except Exception as e:
            raise BadRequest(f"Invalid request data: {str(e)}")

        # Check for duplicate name
        existing_keys = WorkspaceApiKeyService.get_workspace_api_keys(current_user.current_tenant_id)
        if any(key["name"] == args["name"] for key in existing_keys):
            raise BadRequest("API key name already exists")

        # Validate scopes
        from constants.workspace_scopes import get_valid_scopes, validate_scopes

        is_valid, invalid_scopes = validate_scopes(args["scopes"])
        if not is_valid:
            valid_scopes = get_valid_scopes()
            raise BadRequest(f"Invalid scopes: {invalid_scopes}. Valid scopes: {valid_scopes}")

        # Create API key
        api_key = WorkspaceApiKeyService.create_workspace_api_key(
            tenant_id=current_user.current_tenant_id,
            account_id=current_user.id,
            name=args["name"],
            scopes=args["scopes"],
            expires_in_days=args["expires_in_days"],
        )

        # Create response with security headers
        response = make_response(api_key, 201)
        return self._add_security_headers(response)


class WorkspaceApiKeyApi(Resource):
    def _add_security_headers(self, response):
        """Add security headers to response"""
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @setup_required
    @login_required(["workspace:admin"])
    @account_initialization_required
    def post(self, api_key_id):
        """Update workspace management API key"""
        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, location="json")
        parser.add_argument("scopes", type=list, location="json")
        parser.add_argument("expires_in_days", type=int, location="json")

        try:
            args = parser.parse_args()
        except Exception as e:
            raise BadRequest(f"Invalid request data: {str(e)}")

        tenant_id = current_user.current_tenant_id

        # Validate scopes if provided
        if args["scopes"]:
            from constants.workspace_scopes import get_valid_scopes, validate_scopes

            is_valid, invalid_scopes = validate_scopes(args["scopes"])
            if not is_valid:
                valid_scopes = get_valid_scopes()
                raise BadRequest(f"Invalid scopes: {invalid_scopes}. Valid scopes: {valid_scopes}")

        # Update API key
        api_key = WorkspaceApiKeyService.update_workspace_api_key(
            tenant_id=tenant_id,
            api_key_id=api_key_id,
            name=args["name"],
            scopes=args["scopes"],
            expires_in_days=args["expires_in_days"],
        )

        if not api_key:
            raise NotFound("API key not found")

        # Create response with security headers
        response = make_response(api_key, 200)
        return self._add_security_headers(response)

    @setup_required
    @login_required(["workspace:admin"])
    @account_initialization_required
    def delete(self, api_key_id):
        """Delete workspace management API key"""
        tenant_id = current_user.current_tenant_id

        success = WorkspaceApiKeyService.delete_workspace_api_key(tenant_id, api_key_id)
        if not success:
            raise NotFound("API key not found")

        response = make_response({"message": "API key deleted successfully"}, 200)
        return self._add_security_headers(response)


class WorkspaceApiKeyRegenerateApi(Resource):
    def _add_security_headers(self, response):
        """Add security headers to response"""
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @setup_required
    @login_required(["workspace:admin"])
    @account_initialization_required
    def post(self, api_key_id):
        """Regenerate workspace management API key"""

        tenant_id = current_user.current_tenant_id
        account_id = current_user.id

        # Get the existing API key to preserve its name and scopes
        existing_keys = WorkspaceApiKeyService.get_workspace_api_keys(tenant_id)
        existing_key = next((key for key in existing_keys if key["id"] == api_key_id), None)

        if not existing_key:
            raise NotFound("API key not found")

        # Delete the old key
        WorkspaceApiKeyService.delete_workspace_api_key(tenant_id, api_key_id)

        # Create a new key with the same name and scopes
        api_key = WorkspaceApiKeyService.create_workspace_api_key(
            tenant_id=tenant_id,
            account_id=account_id,
            name=existing_key["name"],
            scopes=existing_key["scopes"],
            expires_in_days=30,  # Default to 30 days
        )

        # Create response with security headers
        response = make_response(api_key, 201)
        return self._add_security_headers(response)


class WorkspaceApiKeyScopesApi(Resource):
    @setup_required
    @login_required(["workspace:admin"])
    @account_initialization_required
    def get(self):
        """Get available scopes for workspace API keys"""
        from constants.workspace_scopes import SCOPE_CATEGORIES, WORKSPACE_API_SCOPES

        response_data = {"categories": SCOPE_CATEGORIES, "scopes": WORKSPACE_API_SCOPES}
        return response_data


# Register endpoints
api.add_resource(WorkspaceApiKeysApi, "/workspaces/current/api-keys")
api.add_resource(WorkspaceApiKeyApi, "/workspaces/current/api-keys/<string:api_key_id>")
api.add_resource(WorkspaceApiKeyRegenerateApi, "/workspaces/current/api-keys/<string:api_key_id>/regenerate")
api.add_resource(WorkspaceApiKeyScopesApi, "/workspaces/current/api-keys/scopes")
