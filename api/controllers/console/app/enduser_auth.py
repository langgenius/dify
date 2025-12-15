"""
End-user authentication API controllers.

Provides API endpoints for managing end-user credentials for tool authentication.
"""

from flask import request
from flask_restx import Resource
from werkzeug.exceptions import BadRequest

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.login import current_account_with_tenant, login_required
from models import AppMode
from services.tools.app_auth_requirement_service import AppAuthRequirementService
from services.tools.enduser_auth_service import EndUserAuthService
from services.tools.enduser_oauth_service import EndUserOAuthService


@console_ns.route("/apps/<uuid:app_id>/auth/providers")
class AppAuthProvidersApi(Resource):
    """
    Get list of authentication providers required for an app.

    Returns providers that require end-user authentication based on app configuration.
    """

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.COMPLETION, AppMode.WORKFLOW])
    def get(self, app_model):
        """Get authentication providers required for the app."""
        _, tenant_id = current_account_with_tenant()

        providers = AppAuthRequirementService.get_required_providers(
            tenant_id=tenant_id,
            app_id=str(app_model.id),
        )

        return jsonable_encoder(providers)


@console_ns.route("/apps/<uuid:app_id>/auth/providers/<path:provider_id>/credentials")
class AppAuthProviderCredentialsApi(Resource):
    """
    Manage end-user credentials for a specific provider.

    Allows listing, creating, and deleting end-user credentials.
    """

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.COMPLETION, AppMode.WORKFLOW])
    def get(self, app_model, provider_id: str):
        """List end-user's credentials for this provider."""
        user, tenant_id = current_account_with_tenant()

        # For console API, use the current account user as end_user_id
        # In production, this would be the actual end-user ID from the chat/completion request
        end_user_id = str(user.id)

        credentials = EndUserAuthService.list_credentials(
            tenant_id=tenant_id,
            end_user_id=end_user_id,
            provider_id=provider_id,
        )

        return jsonable_encoder(credentials)

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.COMPLETION, AppMode.WORKFLOW])
    def post(self, app_model, provider_id: str):
        """Create a new credential (API key only)."""
        user, tenant_id = current_account_with_tenant()
        end_user_id = str(user.id)

        payload = request.get_json()
        if not payload:
            raise BadRequest("Request body is required")

        credential_type = payload.get("credential_type")
        credentials = payload.get("credentials")

        if not credential_type or not credentials:
            raise BadRequest("credential_type and credentials are required")

        if credential_type != "api-key":
            raise BadRequest(
                "Only 'api-key' credential type can be created via this endpoint. "
                "Use OAuth flow for OAuth credentials."
            )

        credential = EndUserAuthService.create_api_key_credential(
            tenant_id=tenant_id,
            end_user_id=end_user_id,
            provider_id=provider_id,
            credentials=credentials,
        )

        return jsonable_encoder(credential)


@console_ns.route("/apps/<uuid:app_id>/auth/providers/<path:provider_id>/credentials/<string:credential_id>")
class AppAuthProviderCredentialApi(Resource):
    """
    Manage a specific end-user credential.

    Allows getting, updating, or deleting a credential.
    """

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.COMPLETION, AppMode.WORKFLOW])
    def delete(self, app_model, provider_id: str, credential_id: str):
        """Delete a credential."""
        user, tenant_id = current_account_with_tenant()
        end_user_id = str(user.id)

        EndUserAuthService.delete_credential(
            tenant_id=tenant_id,
            end_user_id=end_user_id,
            provider_id=provider_id,
            credential_id=credential_id,
        )

        return {"result": "success"}


@console_ns.route("/apps/<uuid:app_id>/auth/oauth/<path:provider_id>/authorization-url")
class AppAuthOAuthAuthorizationUrlApi(Resource):
    """
    Get OAuth authorization URL for end-user authentication.

    Returns the URL where the user should be redirected to authenticate with the provider.
    """

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.COMPLETION, AppMode.WORKFLOW])
    def get(self, app_model, provider_id: str):
        """Get OAuth authorization URL."""
        user, tenant_id = current_account_with_tenant()
        end_user_id = str(user.id)

        result = EndUserOAuthService.get_authorization_url(
            end_user_id=end_user_id,
            tenant_id=tenant_id,
            app_id=str(app_model.id),
            provider=provider_id,
        )

        # Set OAuth context cookie for callback
        response = jsonable_encoder({
            "authorization_url": result["authorization_url"],
        })

        # Store context_id in response for frontend to set as cookie
        response["context_id"] = result["context_id"]

        return response


@console_ns.route("/apps/<uuid:app_id>/auth/oauth/<path:provider_id>/callback")
class AppAuthOAuthCallbackApi(Resource):
    """
    Handle OAuth callback for end-user authentication.

    This endpoint is called by the OAuth provider after user authorization.
    """

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.COMPLETION, AppMode.WORKFLOW])
    def get(self, app_model, provider_id: str):
        """Handle OAuth callback and store credentials."""
        # Get OAuth context ID from cookie
        context_id = request.cookies.get("oauth_context_id")

        if not context_id:
            raise BadRequest("Missing OAuth context")

        # Get OAuth error if any
        error = request.args.get("error")
        error_description = request.args.get("error_description")

        if error:
            raise BadRequest(f"OAuth error: {error} - {error_description}")

        # Handle callback and create credential
        result = EndUserOAuthService.handle_oauth_callback(
            context_id=context_id,
            request=request,
        )

        return jsonable_encoder(result)


@console_ns.route("/apps/<uuid:app_id>/auth/providers/<path:provider_id>/credentials/<string:credential_id>/refresh")
class AppAuthProviderRefreshApi(Resource):
    """
    Manually refresh OAuth token for a credential.

    This endpoint allows refreshing an expired OAuth token.
    """

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.COMPLETION, AppMode.WORKFLOW])
    def post(self, app_model, provider_id: str, credential_id: str):
        """Refresh OAuth token."""
        user, tenant_id = current_account_with_tenant()
        end_user_id = str(user.id)

        result = EndUserOAuthService.refresh_oauth_token(
            credential_id=credential_id,
            end_user_id=end_user_id,
            tenant_id=tenant_id,
        )

        return jsonable_encoder(result)
