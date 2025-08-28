import logging

from flask_restx import Resource, reqparse
from werkzeug.exceptions import BadRequest, Forbidden

from controllers.console import api
from controllers.console.wraps import account_initialization_required, setup_required
from core.plugin.entities.plugin import TriggerProviderID
from core.plugin.entities.plugin_daemon import CredentialType
from libs.login import current_user, login_required
from models.account import Account
from services.trigger.trigger_provider_service import TriggerProviderService

logger = logging.getLogger(__name__)


class TriggerProviderListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        """List all trigger providers for the current tenant"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        try:
            return TriggerProviderService.list_trigger_providers(
                tenant_id=user.current_tenant_id, provider_id=TriggerProviderID(provider)
            )
        except Exception as e:
            logger.exception("Error listing trigger providers", exc_info=e)
            raise


class TriggerProviderCredentialsAddApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        """Add a new credential instance for a trigger provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("credential_type", type=str, required=True, nullable=False, location="json")
        parser.add_argument("credentials", type=dict, required=True, nullable=False, location="json")
        parser.add_argument("name", type=str, required=False, nullable=True, location="json")
        parser.add_argument("expires_at", type=int, required=False, nullable=True, location="json", default=-1)
        args = parser.parse_args()

        try:
            # Parse credential type
            try:
                credential_type = CredentialType(args["credential_type"])
            except ValueError:
                raise BadRequest(f"Invalid credential_type. Must be one of: {[t.value for t in CredentialType]}")

            result = TriggerProviderService.add_trigger_provider(
                tenant_id=user.current_tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                credential_type=credential_type,
                credentials=args["credentials"],
                name=args.get("name"),
                expires_at=args.get("expires_at", -1),
            )

            return result

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error adding provider credential", exc_info=e)
            raise


class TriggerProviderCredentialsUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, credential_id):
        """Update an existing credential instance"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("credentials", type=dict, required=False, nullable=True, location="json")
        parser.add_argument("name", type=str, required=False, nullable=True, location="json")
        args = parser.parse_args()

        try:
            result = TriggerProviderService.update_trigger_provider(
                tenant_id=user.current_tenant_id,
                credential_id=credential_id,
                credentials=args.get("credentials"),
                name=args.get("name"),
            )

            return result

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error updating provider credential", exc_info=e)
            raise


class TriggerProviderCredentialsDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, credential_id):
        """Delete a credential instance"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        try:
            result = TriggerProviderService.delete_trigger_provider(
                tenant_id=user.current_tenant_id,
                credential_id=credential_id,
            )
            return result

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error deleting provider credential", exc_info=e)
            raise


class TriggerProviderOAuthAuthorizeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        """Initiate OAuth authorization flow for a provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        try:
            context_id = TriggerProviderService.create_oauth_proxy_context(
                tenant_id=user.current_tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
            )

            # TODO: Build OAuth authorization URL
            # This will be implemented when we have provider-specific OAuth configs

            return {
                "context_id": context_id,
                "authorization_url": f"/oauth/authorize?context={context_id}",
            }

        except Exception as e:
            logger.exception("Error initiating OAuth flow", exc_info=e)
            raise


class TriggerProviderOAuthRefreshTokenApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, credential_id):
        """Refresh OAuth token for a trigger provider credential"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        try:
            result = TriggerProviderService.refresh_oauth_token(
                tenant_id=user.current_tenant_id,
                credential_id=credential_id,
            )
            return result

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error refreshing OAuth token", exc_info=e)
            raise


class TriggerProviderOAuthClientManageApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        """Get OAuth client configuration for a provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        try:
            provider_id = TriggerProviderID(provider)

            # Get custom OAuth client params if exists
            custom_params = TriggerProviderService.get_custom_oauth_client_params(
                tenant_id=user.current_tenant_id,
                provider_id=provider_id,
            )

            # Check if custom client is enabled
            is_custom_enabled = TriggerProviderService.is_oauth_custom_client_enabled(
                tenant_id=user.current_tenant_id,
                provider_id=provider_id,
            )

            # Check if there's a system OAuth client
            system_client = TriggerProviderService.get_oauth_client(
                tenant_id=user.current_tenant_id,
                provider_id=provider_id,
            )

            return {
                "configured": bool(custom_params or system_client),
                "custom_configured": bool(custom_params),
                "custom_enabled": is_custom_enabled,
                "params": custom_params if custom_params else {},
            }

        except Exception as e:
            logger.exception("Error getting OAuth client", exc_info=e)
            raise

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        """Configure custom OAuth client for a provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("client_params", type=dict, required=False, nullable=True, location="json")
        parser.add_argument("enabled", type=bool, required=False, nullable=True, location="json")
        args = parser.parse_args()

        try:
            provider_id = TriggerProviderID(provider)

            result = TriggerProviderService.save_custom_oauth_client_params(
                tenant_id=user.current_tenant_id,
                provider_id=provider_id,
                client_params=args.get("client_params"),
                enabled=args.get("enabled"),
            )

            return result

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error configuring OAuth client", exc_info=e)
            raise

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, provider):
        """Remove custom OAuth client configuration"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        try:
            provider_id = TriggerProviderID(provider)

            result = TriggerProviderService.delete_custom_oauth_client_params(
                tenant_id=user.current_tenant_id,
                provider_id=provider_id,
            )

            return result

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error removing OAuth client", exc_info=e)
            raise


# Trigger provider endpoints
api.add_resource(TriggerProviderListApi, "/workspaces/current/trigger-provider/<path:provider>/list")
api.add_resource(TriggerProviderCredentialsAddApi, "/workspaces/current/trigger-provider/<path:provider>/add")
api.add_resource(
    TriggerProviderCredentialsUpdateApi, "/workspaces/current/trigger-provider/credentials/<path:credential_id>/update"
)
api.add_resource(
    TriggerProviderCredentialsDeleteApi, "/workspaces/current/trigger-provider/credentials/<path:credential_id>/delete"
)

api.add_resource(
    TriggerProviderOAuthAuthorizeApi, "/workspaces/current/trigger-provider/<path:provider>/oauth/authorize"
)
api.add_resource(
    TriggerProviderOAuthRefreshTokenApi,
    "/workspaces/current/trigger-provider/credentials/<path:credential_id>/oauth/refresh",
)
api.add_resource(
    TriggerProviderOAuthClientManageApi, "/workspaces/current/trigger-provider/<path:provider>/oauth/client"
)
