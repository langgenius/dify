import logging

from flask import make_response, redirect, request
from flask_restx import Resource, reqparse
from werkzeug.exceptions import BadRequest, Forbidden

from configs import dify_config
from controllers.console import api
from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.entities.plugin import TriggerProviderID
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from libs.login import current_user, login_required
from models.account import Account
from services.plugin.oauth_service import OAuthProxyService
from services.trigger.trigger_provider_service import TriggerProviderService
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService

logger = logging.getLogger(__name__)


class TriggerProviderListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        """List all trigger providers for the current tenant"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        return jsonable_encoder(TriggerProviderService.list_trigger_providers(user.current_tenant_id))


class TriggerProviderSubscriptionListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        """List all trigger subscriptions for the current tenant's provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        try:
            return jsonable_encoder(
                TriggerProviderService.list_trigger_provider_subscriptions(
                    tenant_id=user.current_tenant_id, provider_id=TriggerProviderID(provider)
                )
            )
        except Exception as e:
            logger.exception("Error listing trigger providers", exc_info=e)
            raise


class TriggerSubscriptionBuilderCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        """Add a new subscription instance for a trigger provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=False, nullable=True, location="json")
        parser.add_argument("credentials", type=dict, required=False, nullable=False, location="json")
        args = parser.parse_args()

        try:
            credentials = args.get("credentials", {})
            credential_type = CredentialType.API_KEY if credentials else CredentialType.UNAUTHORIZED
            subscription_builder = TriggerSubscriptionBuilderService.create_trigger_subscription_builder(
                tenant_id=user.current_tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                credentials=credentials,
                credential_type=credential_type,
                credential_expires_at=-1,
                expires_at=-1,
            )
            return jsonable_encoder({"subscription_builder": subscription_builder})
        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error adding provider credential", exc_info=e)
            raise


class TriggerSubscriptionBuilderVerifyApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider, subscription_builder_id):
        """Verify a subscription instance for a trigger provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        try:
            TriggerSubscriptionBuilderService.verify_trigger_subscription_builder(
                tenant_id=user.current_tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
            )
            return 200
        except Exception as e:
            logger.exception("Error verifying provider credential", exc_info=e)
            raise


class TriggerSubscriptionBuilderBuildApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider, subscription_builder_id):
        """Build a subscription instance for a trigger provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        try:
            TriggerSubscriptionBuilderService.build_trigger_subscription_builder(
                tenant_id=user.current_tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
            )
            return 200
        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error building provider credential", exc_info=e)
            raise


class TriggerSubscriptionsDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, subscription_id):
        """Delete a subscription instance"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        try:
            result = TriggerProviderService.delete_trigger_provider(
                tenant_id=user.current_tenant_id,
                subscription_id=subscription_id,
            )
            return result

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error deleting provider credential", exc_info=e)
            raise


class TriggerOAuthAuthorizeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        """Initiate OAuth authorization flow for a trigger provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None

        try:
            provider_id = TriggerProviderID(provider)
            plugin_id = provider_id.plugin_id
            provider_name = provider_id.provider_name
            tenant_id = user.current_tenant_id

            # Get OAuth client configuration
            oauth_client_params = TriggerProviderService.get_oauth_client(
                tenant_id=tenant_id,
                provider_id=provider_id,
            )

            if oauth_client_params is None:
                raise Forbidden("No OAuth client configuration found for this trigger provider")

            # Create OAuth handler and proxy context
            oauth_handler = OAuthHandler()
            context_id = OAuthProxyService.create_proxy_context(
                user_id=user.id,
                tenant_id=tenant_id,
                plugin_id=plugin_id,
                provider=provider_name,
            )

            # Build redirect URI for callback
            redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider}/trigger/callback"

            # Get authorization URL
            authorization_url_response = oauth_handler.get_authorization_url(
                tenant_id=tenant_id,
                user_id=user.id,
                plugin_id=plugin_id,
                provider=provider_name,
                redirect_uri=redirect_uri,
                system_credentials=oauth_client_params,
            )

            # Create response with cookie
            response = make_response(jsonable_encoder(authorization_url_response))
            response.set_cookie(
                "context_id",
                context_id,
                httponly=True,
                samesite="Lax",
                max_age=OAuthProxyService.__MAX_AGE__,
            )

            return response

        except Exception as e:
            logger.exception("Error initiating OAuth flow", exc_info=e)
            raise


class TriggerOAuthCallbackApi(Resource):
    @setup_required
    def get(self, provider):
        """Handle OAuth callback for trigger provider"""
        context_id = request.cookies.get("context_id")
        if not context_id:
            raise Forbidden("context_id not found")

        # Use and validate proxy context
        context = OAuthProxyService.use_proxy_context(context_id)
        if context is None:
            raise Forbidden("Invalid context_id")

        # Parse provider ID
        provider_id = TriggerProviderID(provider)
        plugin_id = provider_id.plugin_id
        provider_name = provider_id.provider_name
        user_id = context.get("user_id")
        tenant_id = context.get("tenant_id")

        # Get OAuth client configuration
        oauth_client_params = TriggerProviderService.get_oauth_client(
            tenant_id=tenant_id,
            provider_id=provider_id,
        )

        if oauth_client_params is None:
            raise Forbidden("No OAuth client configuration found for this trigger provider")

        # Get OAuth credentials from callback
        oauth_handler = OAuthHandler()
        redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider}/trigger/callback"

        credentials_response = oauth_handler.get_credentials(
            tenant_id=tenant_id,
            user_id=user_id,
            plugin_id=plugin_id,
            provider=provider_name,
            redirect_uri=redirect_uri,
            system_credentials=oauth_client_params,
            request=request,
        )

        credentials = credentials_response.credentials
        expires_at = credentials_response.expires_at

        if not credentials:
            raise Exception("Failed to get OAuth credentials")

        # Save OAuth credentials to database
        subscription_builder = TriggerSubscriptionBuilderService.create_trigger_subscription_builder(
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=provider_id,
            credentials=credentials,
            credential_type=CredentialType.OAUTH2,
            credential_expires_at=expires_at,
            expires_at=expires_at,
        )
        # Redirect to OAuth callback page
        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback?subscription_id={subscription_builder.id}")


class TriggerOAuthRefreshTokenApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, subscription_id):
        """Refresh OAuth token for a trigger provider subscription"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        if not user.is_admin_or_owner:
            raise Forbidden()

        try:
            result = TriggerProviderService.refresh_oauth_token(
                tenant_id=user.current_tenant_id,
                subscription_id=subscription_id,
            )
            return result

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error refreshing OAuth token", exc_info=e)
            raise


class TriggerOAuthClientManageApi(Resource):
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
            return TriggerProviderService.save_custom_oauth_client_params(
                tenant_id=user.current_tenant_id,
                provider_id=provider_id,
                client_params=args.get("client_params"),
                enabled=args.get("enabled"),
            )

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

            return TriggerProviderService.delete_custom_oauth_client_params(
                tenant_id=user.current_tenant_id,
                provider_id=provider_id,
            )
        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error removing OAuth client", exc_info=e)
            raise


# Trigger provider endpoints
api.add_resource(TriggerProviderListApi, "/workspaces/current/trigger-providers")
api.add_resource(TriggerProviderSubscriptionListApi, "/workspaces/current/trigger-provider/<path:provider>/list")
api.add_resource(
    TriggerSubscriptionBuilderCreateApi,
    "/workspaces/current/trigger-provider/subscriptions/<path:provider>/create-builder",
)
api.add_resource(
    TriggerSubscriptionBuilderVerifyApi,
    "/workspaces/current/trigger-provider/subscriptions/<path:provider>/verify/<path:subscription_builder_id>",
)
api.add_resource(
    TriggerSubscriptionBuilderBuildApi,
    "/workspaces/current/trigger-provider/subscriptions/<path:provider>/build/<path:subscription_builder_id>",
)
api.add_resource(
    TriggerSubscriptionsDeleteApi,
    "/workspaces/current/trigger-provider/subscriptions/<path:subscription_id>/delete",
)

# OAuth
api.add_resource(
    TriggerOAuthAuthorizeApi, "/workspaces/current/trigger-provider/subscriptions/<path:provider>/oauth/authorize"
)
api.add_resource(TriggerOAuthCallbackApi, "/oauth/plugin/<path:provider>/trigger/callback")
api.add_resource(
    TriggerOAuthRefreshTokenApi,
    "/workspaces/current/trigger-provider/subscriptions/<path:subscription_id>/oauth/refresh",
)
api.add_resource(TriggerOAuthClientManageApi, "/workspaces/current/trigger-provider/<path:provider>/oauth/client")
