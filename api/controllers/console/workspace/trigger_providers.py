import logging

from flask import make_response, redirect, request
from flask_restx import Resource, reqparse
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden

from configs import dify_config
from controllers.web.error import NotFoundError
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.trigger.entities.entities import SubscriptionBuilderUpdater
from core.trigger.trigger_manager import TriggerManager
from extensions.ext_database import db
from libs.login import current_user, login_required
from models.account import Account
from models.provider_ids import TriggerProviderID
from services.plugin.oauth_service import OAuthProxyService
from services.trigger.trigger_provider_service import TriggerProviderService
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService
from services.trigger.trigger_subscription_operator_service import TriggerSubscriptionOperatorService

from .. import console_ns
from ..wraps import (
    account_initialization_required,
    edit_permission_required,
    is_admin_or_owner_required,
    setup_required,
)

logger = logging.getLogger(__name__)


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/icon")
class TriggerProviderIconApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None

        return TriggerManager.get_trigger_plugin_icon(tenant_id=user.current_tenant_id, provider_id=provider)


@console_ns.route("/workspaces/current/triggers")
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


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/info")
class TriggerProviderInfoApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        """Get info for a trigger provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None
        return jsonable_encoder(
            TriggerProviderService.get_trigger_provider(user.current_tenant_id, TriggerProviderID(provider))
        )


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/subscriptions/list")
class TriggerSubscriptionListApi(Resource):
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    def get(self, provider):
        """List all trigger subscriptions for the current tenant's provider"""
        user = current_user
        assert user.current_tenant_id is not None

        try:
            return jsonable_encoder(
                TriggerProviderService.list_trigger_provider_subscriptions(
                    tenant_id=user.current_tenant_id, provider_id=TriggerProviderID(provider)
                )
            )
        except ValueError as e:
            return jsonable_encoder({"error": str(e)}), 404
        except Exception as e:
            logger.exception("Error listing trigger providers", exc_info=e)
            raise


parser = reqparse.RequestParser().add_argument(
    "credential_type", type=str, required=False, nullable=True, location="json"
)


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/create",
)
class TriggerSubscriptionBuilderCreateApi(Resource):
    @console_ns.expect(parser)
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    def post(self, provider):
        """Add a new subscription instance for a trigger provider"""
        user = current_user
        assert user.current_tenant_id is not None

        args = parser.parse_args()

        try:
            credential_type = CredentialType.of(args.get("credential_type") or CredentialType.UNAUTHORIZED.value)
            subscription_builder = TriggerSubscriptionBuilderService.create_trigger_subscription_builder(
                tenant_id=user.current_tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                credential_type=credential_type,
            )
            return jsonable_encoder({"subscription_builder": subscription_builder})
        except Exception as e:
            logger.exception("Error adding provider credential", exc_info=e)
            raise


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/<path:subscription_builder_id>",
)
class TriggerSubscriptionBuilderGetApi(Resource):
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    def get(self, provider, subscription_builder_id):
        """Get a subscription instance for a trigger provider"""
        return jsonable_encoder(
            TriggerSubscriptionBuilderService.get_subscription_builder_by_id(subscription_builder_id)
        )


parser_api = (
    reqparse.RequestParser()
    # The credentials of the subscription builder
    .add_argument("credentials", type=dict, required=False, nullable=True, location="json")
)


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/verify/<path:subscription_builder_id>",
)
class TriggerSubscriptionBuilderVerifyApi(Resource):
    @console_ns.expect(parser_api)
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    def post(self, provider, subscription_builder_id):
        """Verify a subscription instance for a trigger provider"""
        user = current_user
        assert user.current_tenant_id is not None

        args = parser_api.parse_args()

        try:
            # Use atomic update_and_verify to prevent race conditions
            return TriggerSubscriptionBuilderService.update_and_verify_builder(
                tenant_id=user.current_tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
                subscription_builder_updater=SubscriptionBuilderUpdater(
                    credentials=args.get("credentials", None),
                ),
            )
        except Exception as e:
            logger.exception("Error verifying provider credential", exc_info=e)
            raise ValueError(str(e)) from e


parser_update_api = (
    reqparse.RequestParser()
    # The name of the subscription builder
    .add_argument("name", type=str, required=False, nullable=True, location="json")
    # The parameters of the subscription builder
    .add_argument("parameters", type=dict, required=False, nullable=True, location="json")
    # The properties of the subscription builder
    .add_argument("properties", type=dict, required=False, nullable=True, location="json")
    # The credentials of the subscription builder
    .add_argument("credentials", type=dict, required=False, nullable=True, location="json")
)


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/update/<path:subscription_builder_id>",
)
class TriggerSubscriptionBuilderUpdateApi(Resource):
    @console_ns.expect(parser_update_api)
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    def post(self, provider, subscription_builder_id):
        """Update a subscription instance for a trigger provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None

        args = parser_update_api.parse_args()
        try:
            return jsonable_encoder(
                TriggerSubscriptionBuilderService.update_trigger_subscription_builder(
                    tenant_id=user.current_tenant_id,
                    provider_id=TriggerProviderID(provider),
                    subscription_builder_id=subscription_builder_id,
                    subscription_builder_updater=SubscriptionBuilderUpdater(
                        name=args.get("name", None),
                        parameters=args.get("parameters", None),
                        properties=args.get("properties", None),
                        credentials=args.get("credentials", None),
                    ),
                )
            )
        except Exception as e:
            logger.exception("Error updating provider credential", exc_info=e)
            raise


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/logs/<path:subscription_builder_id>",
)
class TriggerSubscriptionBuilderLogsApi(Resource):
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    def get(self, provider, subscription_builder_id):
        """Get the request logs for a subscription instance for a trigger provider"""
        user = current_user
        assert isinstance(user, Account)
        assert user.current_tenant_id is not None

        try:
            logs = TriggerSubscriptionBuilderService.list_logs(subscription_builder_id)
            return jsonable_encoder({"logs": [log.model_dump(mode="json") for log in logs]})
        except Exception as e:
            logger.exception("Error getting request logs for subscription builder", exc_info=e)
            raise


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/build/<path:subscription_builder_id>",
)
class TriggerSubscriptionBuilderBuildApi(Resource):
    @console_ns.expect(parser_update_api)
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    def post(self, provider, subscription_builder_id):
        """Build a subscription instance for a trigger provider"""
        user = current_user
        assert user.current_tenant_id is not None
        args = parser_update_api.parse_args()
        try:
            # Use atomic update_and_build to prevent race conditions
            TriggerSubscriptionBuilderService.update_and_build_builder(
                tenant_id=user.current_tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
                subscription_builder_updater=SubscriptionBuilderUpdater(
                    name=args.get("name", None),
                    parameters=args.get("parameters", None),
                    properties=args.get("properties", None),
                ),
            )
            return 200
        except Exception as e:
            logger.exception("Error building provider credential", exc_info=e)
            raise ValueError(str(e)) from e


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:subscription_id>/subscriptions/delete",
)
class TriggerSubscriptionDeleteApi(Resource):
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, subscription_id: str):
        """Delete a subscription instance"""
        user = current_user
        assert user.current_tenant_id is not None

        try:
            with Session(db.engine) as session:
                # Delete trigger provider subscription
                TriggerProviderService.delete_trigger_provider(
                    session=session,
                    tenant_id=user.current_tenant_id,
                    subscription_id=subscription_id,
                )
                # Delete plugin triggers
                TriggerSubscriptionOperatorService.delete_plugin_trigger_by_subscription(
                    session=session,
                    tenant_id=user.current_tenant_id,
                    subscription_id=subscription_id,
                )
                session.commit()
            return {"result": "success"}
        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error deleting provider credential", exc_info=e)
            raise


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/subscriptions/oauth/authorize")
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
                raise NotFoundError("No OAuth client configuration found for this trigger provider")

            # Create subscription builder
            subscription_builder = TriggerSubscriptionBuilderService.create_trigger_subscription_builder(
                tenant_id=tenant_id,
                user_id=user.id,
                provider_id=provider_id,
                credential_type=CredentialType.OAUTH2,
            )

            # Create OAuth handler and proxy context
            oauth_handler = OAuthHandler()
            context_id = OAuthProxyService.create_proxy_context(
                user_id=user.id,
                tenant_id=tenant_id,
                plugin_id=plugin_id,
                provider=provider_name,
                extra_data={
                    "subscription_builder_id": subscription_builder.id,
                },
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
            response = make_response(
                jsonable_encoder(
                    {
                        "authorization_url": authorization_url_response.authorization_url,
                        "subscription_builder_id": subscription_builder.id,
                        "subscription_builder": subscription_builder,
                    }
                )
            )
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


@console_ns.route("/oauth/plugin/<path:provider>/trigger/callback")
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
        subscription_builder_id = context.get("subscription_builder_id")

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
            raise ValueError("Failed to get OAuth credentials from the provider.")

        # Update subscription builder
        TriggerSubscriptionBuilderService.update_trigger_subscription_builder(
            tenant_id=tenant_id,
            provider_id=provider_id,
            subscription_builder_id=subscription_builder_id,
            subscription_builder_updater=SubscriptionBuilderUpdater(
                credentials=credentials,
                credential_expires_at=expires_at,
            ),
        )
        # Redirect to OAuth callback page
        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback")


parser_oauth_client = (
    reqparse.RequestParser()
    .add_argument("client_params", type=dict, required=False, nullable=True, location="json")
    .add_argument("enabled", type=bool, required=False, nullable=True, location="json")
)


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/oauth/client")
class TriggerOAuthClientManageApi(Resource):
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def get(self, provider):
        """Get OAuth client configuration for a provider"""
        user = current_user
        assert user.current_tenant_id is not None

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
            system_client_exists = TriggerProviderService.is_oauth_system_client_exists(
                tenant_id=user.current_tenant_id,
                provider_id=provider_id,
            )
            provider_controller = TriggerManager.get_trigger_provider(user.current_tenant_id, provider_id)
            redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider}/trigger/callback"
            return jsonable_encoder(
                {
                    "configured": bool(custom_params or system_client_exists),
                    "system_configured": system_client_exists,
                    "custom_configured": bool(custom_params),
                    "oauth_client_schema": provider_controller.get_oauth_client_schema(),
                    "custom_enabled": is_custom_enabled,
                    "redirect_uri": redirect_uri,
                    "params": custom_params or {},
                }
            )

        except Exception as e:
            logger.exception("Error getting OAuth client", exc_info=e)
            raise

    @console_ns.expect(parser_oauth_client)
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    def post(self, provider):
        """Configure custom OAuth client for a provider"""
        user = current_user
        assert user.current_tenant_id is not None

        args = parser_oauth_client.parse_args()

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
    @is_admin_or_owner_required
    @account_initialization_required
    def delete(self, provider):
        """Remove custom OAuth client configuration"""
        user = current_user
        assert user.current_tenant_id is not None

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
