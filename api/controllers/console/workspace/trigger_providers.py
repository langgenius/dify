import logging
from typing import Any

from flask import make_response, redirect, request
from flask_restx import Resource
from pydantic import BaseModel, RootModel, model_validator
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import BadRequest, Forbidden

from configs import dify_config
from controllers.common.errors import NotFoundError
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.trigger.entities.api_entities import (
    SubscriptionBuilderApiEntity,
    TriggerProviderApiEntity,
    TriggerProviderSubscriptionApiEntity,
)
from core.trigger.entities.entities import RequestLog, SubscriptionBuilderUpdater
from core.trigger.trigger_manager import TriggerManager
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from models.account import Account
from models.provider_ids import TriggerProviderID
from services.plugin.oauth_service import OAuthProxyService
from services.trigger.trigger_provider_service import TriggerProviderService
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService
from services.trigger.trigger_subscription_operator_service import TriggerSubscriptionOperatorService

from .. import console_ns
from ..wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    is_admin_or_owner_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)

logger = logging.getLogger(__name__)


class TriggerSubscriptionBuilderCreatePayload(BaseModel):
    credential_type: str = CredentialType.UNAUTHORIZED


class TriggerSubscriptionBuilderVerifyPayload(BaseModel):
    credentials: dict[str, Any]


class TriggerSubscriptionBuilderUpdatePayload(BaseModel):
    name: str | None = None
    parameters: dict[str, Any] | None = None
    properties: dict[str, Any] | None = None
    credentials: dict[str, Any] | None = None

    @model_validator(mode="after")
    def check_at_least_one_field(self):
        if all(v is None for v in self.model_dump().values()):
            raise ValueError("At least one of name, credentials, parameters, or properties must be provided")
        return self


class TriggerOAuthClientPayload(BaseModel):
    client_params: dict[str, Any] | None = None
    enabled: bool | None = None


class TriggerProviderListResponse(RootModel[list[TriggerProviderApiEntity]]):
    pass


class TriggerProviderSubscriptionListResponse(RootModel[list[TriggerProviderSubscriptionApiEntity]]):
    pass


class TriggerSubscriptionBuilderCreateResponse(ResponseModel):
    subscription_builder: SubscriptionBuilderApiEntity


class TriggerVerificationResponse(ResponseModel):
    verified: bool


class TriggerSubscriptionBuilderLogsResponse(ResponseModel):
    logs: list[RequestLog]


class TriggerOAuthAuthorizeResponse(ResponseModel):
    authorization_url: str
    subscription_builder_id: str
    subscription_builder: SubscriptionBuilderApiEntity


class TriggerOAuthClientResponse(ResponseModel):
    configured: bool
    system_configured: bool
    custom_configured: bool
    oauth_client_schema: list[ProviderConfig]
    custom_enabled: bool
    redirect_uri: str
    params: dict[str, Any]


class TriggerProviderErrorResponse(ResponseModel):
    error: str


register_schema_models(
    console_ns,
    TriggerSubscriptionBuilderCreatePayload,
    TriggerSubscriptionBuilderVerifyPayload,
    TriggerSubscriptionBuilderUpdatePayload,
    TriggerOAuthClientPayload,
)
register_response_schema_models(
    console_ns,
    SimpleResultResponse,
    TriggerOAuthAuthorizeResponse,
    TriggerOAuthClientResponse,
    TriggerProviderApiEntity,
    TriggerProviderErrorResponse,
    TriggerProviderListResponse,
    TriggerProviderSubscriptionListResponse,
    TriggerSubscriptionBuilderCreateResponse,
    TriggerSubscriptionBuilderLogsResponse,
    SubscriptionBuilderApiEntity,
    TriggerVerificationResponse,
)


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/icon")
class TriggerProviderIconApi(Resource):
    # response-contract:ignore binary trigger provider icon
    @console_ns.response(200, "Trigger provider icon")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, provider: str):
        return TriggerManager.get_trigger_plugin_icon(tenant_id=tenant_id, provider_id=provider)


@console_ns.route("/workspaces/current/triggers")
class TriggerProviderListApi(Resource):
    @console_ns.response(
        200,
        "Trigger providers retrieved successfully",
        console_ns.models[TriggerProviderListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        """List all trigger providers for the current tenant"""
        return dump_response(TriggerProviderListResponse, TriggerProviderService.list_trigger_providers(tenant_id))


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/info")
class TriggerProviderInfoApi(Resource):
    @console_ns.response(
        200,
        "Trigger provider retrieved successfully",
        console_ns.models[TriggerProviderApiEntity.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, provider: str):
        """Get info for a trigger provider"""
        provider_entity = TriggerProviderService.get_trigger_provider(tenant_id, TriggerProviderID(provider))
        return provider_entity.model_dump(mode="json")


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/subscriptions/list")
class TriggerSubscriptionListApi(Resource):
    @console_ns.response(
        200,
        "Trigger subscriptions retrieved successfully",
        console_ns.models[TriggerProviderSubscriptionListResponse.__name__],
    )
    @console_ns.response(404, "Trigger provider not found", console_ns.models[TriggerProviderErrorResponse.__name__])
    @setup_required
    @login_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account, provider: str):
        """List all trigger subscriptions for the current tenant's provider"""

        try:
            return dump_response(
                TriggerProviderSubscriptionListResponse,
                TriggerProviderService.list_trigger_provider_subscriptions(
                    tenant_id=tenant_id,
                    provider_id=TriggerProviderID(provider),
                    user=user,
                ),
            )
        except ValueError as e:
            return TriggerProviderErrorResponse(error=str(e)).model_dump(mode="json"), 404
        except Exception as e:
            logger.exception("Error listing trigger providers", exc_info=e)
            raise


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/create",
)
class TriggerSubscriptionBuilderCreateApi(Resource):
    @console_ns.expect(console_ns.models[TriggerSubscriptionBuilderCreatePayload.__name__])
    @console_ns.response(
        200,
        "Trigger subscription builder created successfully",
        console_ns.models[TriggerSubscriptionBuilderCreateResponse.__name__],
    )
    @setup_required
    @login_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account, provider: str):
        """Add a new subscription instance for a trigger provider"""

        payload = TriggerSubscriptionBuilderCreatePayload.model_validate(console_ns.payload or {})

        try:
            credential_type = CredentialType.of(payload.credential_type)
            subscription_builder = TriggerSubscriptionBuilderService.create_trigger_subscription_builder(
                tenant_id=tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                credential_type=credential_type,
            )
            return TriggerSubscriptionBuilderCreateResponse(subscription_builder=subscription_builder).model_dump(
                mode="json"
            )
        except Exception as e:
            logger.exception("Error adding provider credential", exc_info=e)
            raise


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/<path:subscription_builder_id>",
)
class TriggerSubscriptionBuilderGetApi(Resource):
    @console_ns.response(
        200,
        "Trigger subscription builder retrieved successfully",
        console_ns.models[SubscriptionBuilderApiEntity.__name__],
    )
    @setup_required
    @login_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    def get(self, provider: str, subscription_builder_id: str):
        """Get a subscription instance for a trigger provider"""
        subscription_builder = TriggerSubscriptionBuilderService.get_subscription_builder_by_id(subscription_builder_id)
        return subscription_builder.model_dump(mode="json")


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/verify-and-update/<path:subscription_builder_id>",
)
class TriggerSubscriptionBuilderVerifyApi(Resource):
    @console_ns.expect(console_ns.models[TriggerSubscriptionBuilderVerifyPayload.__name__])
    @console_ns.response(
        200,
        "Trigger subscription builder verified successfully",
        console_ns.models[TriggerVerificationResponse.__name__],
    )
    @setup_required
    @login_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account, provider: str, subscription_builder_id: str):
        """Verify and update a subscription instance for a trigger provider"""

        payload = TriggerSubscriptionBuilderVerifyPayload.model_validate(console_ns.payload or {})

        try:
            # Use atomic update_and_verify to prevent race conditions
            result = TriggerSubscriptionBuilderService.update_and_verify_builder(
                tenant_id=tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
                subscription_builder_updater=SubscriptionBuilderUpdater(
                    credentials=payload.credentials,
                ),
            )
            return dump_response(TriggerVerificationResponse, result)
        except Exception as e:
            logger.exception("Error verifying provider credential", exc_info=e)
            raise ValueError(str(e)) from e


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/update/<path:subscription_builder_id>",
)
class TriggerSubscriptionBuilderUpdateApi(Resource):
    @console_ns.expect(console_ns.models[TriggerSubscriptionBuilderUpdatePayload.__name__])
    @console_ns.response(
        200,
        "Trigger subscription builder updated successfully",
        console_ns.models[SubscriptionBuilderApiEntity.__name__],
    )
    @setup_required
    @login_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.CREDENTIAL_MANAGE, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, provider: str, subscription_builder_id: str):
        """Update a subscription instance for a trigger provider"""

        payload = TriggerSubscriptionBuilderUpdatePayload.model_validate(console_ns.payload or {})
        try:
            return TriggerSubscriptionBuilderService.update_trigger_subscription_builder(
                tenant_id=tenant_id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
                subscription_builder_updater=SubscriptionBuilderUpdater(
                    name=payload.name,
                    parameters=payload.parameters,
                    properties=payload.properties,
                    credentials=payload.credentials,
                ),
            ).model_dump(mode="json")
        except Exception as e:
            logger.exception("Error updating provider credential", exc_info=e)
            raise


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/logs/<path:subscription_builder_id>",
)
class TriggerSubscriptionBuilderLogsApi(Resource):
    @console_ns.response(
        200,
        "Trigger subscription builder logs retrieved successfully",
        console_ns.models[TriggerSubscriptionBuilderLogsResponse.__name__],
    )
    @setup_required
    @login_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    def get(self, provider: str, subscription_builder_id: str):
        """Get the request logs for a subscription instance for a trigger provider"""

        try:
            logs = TriggerSubscriptionBuilderService.list_logs(subscription_builder_id)
            return dump_response(TriggerSubscriptionBuilderLogsResponse, {"logs": logs})
        except Exception as e:
            logger.exception("Error getting request logs for subscription builder", exc_info=e)
            raise


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/build/<path:subscription_builder_id>",
)
class TriggerSubscriptionBuilderBuildApi(Resource):
    @console_ns.expect(console_ns.models[TriggerSubscriptionBuilderUpdatePayload.__name__])
    @console_ns.response(
        200, "Trigger subscription builder built successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @setup_required
    @login_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account, provider: str, subscription_builder_id: str):
        """Build a subscription instance for a trigger provider"""
        payload = TriggerSubscriptionBuilderUpdatePayload.model_validate(console_ns.payload or {})
        try:
            # Use atomic update_and_build to prevent race conditions
            TriggerSubscriptionBuilderService.update_and_build_builder(
                tenant_id=tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
                subscription_builder_updater=SubscriptionBuilderUpdater(
                    name=payload.name,
                    parameters=payload.parameters,
                    properties=payload.properties,
                ),
            )
            return SimpleResultResponse(result="success").model_dump(mode="json")
        except Exception as e:
            logger.exception("Error building provider credential", exc_info=e)
            raise ValueError(str(e)) from e


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:subscription_id>/subscriptions/update",
)
class TriggerSubscriptionUpdateApi(Resource):
    @console_ns.expect(console_ns.models[TriggerSubscriptionBuilderUpdatePayload.__name__])
    @console_ns.response(
        200, "Trigger subscription updated successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @setup_required
    @login_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, subscription_id: str):
        """Update a subscription instance"""

        request = TriggerSubscriptionBuilderUpdatePayload.model_validate(console_ns.payload or {})

        subscription = TriggerProviderService.get_subscription_by_id(
            tenant_id=tenant_id,
            subscription_id=subscription_id,
        )
        if not subscription:
            raise NotFoundError(f"Subscription {subscription_id} not found")

        provider_id = TriggerProviderID(subscription.provider_id)

        try:
            # For rename only, just update the name
            rename = request.name is not None and not any((request.credentials, request.parameters, request.properties))
            # When credential type is UNAUTHORIZED, it indicates the subscription was manually created
            # For Manually created subscription, they dont have credentials, parameters
            # They only have name and properties(which is input by user)
            manually_created = subscription.credential_type == CredentialType.UNAUTHORIZED
            if rename or manually_created:
                TriggerProviderService.update_trigger_subscription(
                    tenant_id=tenant_id,
                    subscription_id=subscription_id,
                    name=request.name,
                    properties=request.properties,
                )
                return SimpleResultResponse(result="success").model_dump(mode="json")

            # For the rest cases(API_KEY, OAUTH2)
            # we need to call third party provider(e.g. GitHub) to rebuild the subscription
            TriggerProviderService.rebuild_trigger_subscription(
                tenant_id=tenant_id,
                name=request.name,
                provider_id=provider_id,
                subscription_id=subscription_id,
                credentials=request.credentials or subscription.credentials,
                parameters=request.parameters or subscription.parameters,
            )
            return SimpleResultResponse(result="success").model_dump(mode="json")
        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error updating subscription", exc_info=e)
            raise


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:subscription_id>/subscriptions/delete",
)
class TriggerSubscriptionDeleteApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, subscription_id: str):
        """Delete a subscription instance"""

        try:
            with sessionmaker(db.engine).begin() as session:
                # Delete trigger provider subscription
                TriggerProviderService.delete_trigger_provider(
                    session=session,
                    tenant_id=tenant_id,
                    subscription_id=subscription_id,
                )
                # Delete plugin triggers
                TriggerSubscriptionOperatorService.delete_plugin_trigger_by_subscription(
                    session=session,
                    tenant_id=tenant_id,
                    subscription_id=subscription_id,
                )
            return SimpleResultResponse(result="success").model_dump(mode="json")
        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error deleting provider credential", exc_info=e)
            raise


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/subscriptions/oauth/authorize")
class TriggerOAuthAuthorizeApi(Resource):
    # response-contract:ignore cookie-bearing Flask response
    @console_ns.response(
        200,
        "Trigger OAuth authorization URL generated successfully",
        console_ns.models[TriggerOAuthAuthorizeResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account, provider: str):
        """Initiate OAuth authorization flow for a trigger provider"""

        try:
            provider_id = TriggerProviderID(provider)
            plugin_id = provider_id.plugin_id
            provider_name = provider_id.provider_name
            tenant_id = tenant_id

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

            response = make_response(
                TriggerOAuthAuthorizeResponse(
                    authorization_url=authorization_url_response.authorization_url,
                    subscription_builder_id=subscription_builder.id,
                    subscription_builder=subscription_builder,
                ).model_dump(mode="json")
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
    # response-contract:ignore redirect response
    @console_ns.response(302, "Redirect to OAuth callback page")
    @setup_required
    def get(self, provider: str):
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
        user_id: str = context["user_id"]
        tenant_id: str = context["tenant_id"]
        subscription_builder_id: str = context["subscription_builder_id"]

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


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/oauth/client")
class TriggerOAuthClientManageApi(Resource):
    @console_ns.response(
        200,
        "Trigger OAuth client retrieved successfully",
        console_ns.models[TriggerOAuthClientResponse.__name__],
    )
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, provider: str):
        """Get OAuth client configuration for a provider"""

        try:
            provider_id = TriggerProviderID(provider)

            # Get custom OAuth client params if exists
            custom_params = TriggerProviderService.get_custom_oauth_client_params(
                tenant_id=tenant_id,
                provider_id=provider_id,
            )

            # Check if custom client is enabled
            is_custom_enabled = TriggerProviderService.is_oauth_custom_client_enabled(
                tenant_id=tenant_id,
                provider_id=provider_id,
            )
            system_client_exists = TriggerProviderService.is_oauth_system_client_exists(
                tenant_id=tenant_id,
                provider_id=provider_id,
            )
            provider_controller = TriggerManager.get_trigger_provider(tenant_id, provider_id)
            redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider}/trigger/callback"
            return TriggerOAuthClientResponse(
                configured=bool(custom_params or system_client_exists),
                system_configured=system_client_exists,
                custom_configured=bool(custom_params),
                oauth_client_schema=provider_controller.get_oauth_client_schema(),
                custom_enabled=is_custom_enabled,
                redirect_uri=redirect_uri,
                params=dict(custom_params or {}),
            ).model_dump(mode="json")

        except Exception as e:
            logger.exception("Error getting OAuth client", exc_info=e)
            raise

    @console_ns.expect(console_ns.models[TriggerOAuthClientPayload.__name__])
    @console_ns.response(
        200, "Trigger OAuth client saved successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, provider: str):
        """Configure custom OAuth client for a provider"""

        payload = TriggerOAuthClientPayload.model_validate(console_ns.payload or {})

        try:
            provider_id = TriggerProviderID(provider)
            result = TriggerProviderService.save_custom_oauth_client_params(
                tenant_id=tenant_id,
                provider_id=provider_id,
                client_params=payload.client_params,
                enabled=payload.enabled,
            )
            return dump_response(SimpleResultResponse, result)

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error configuring OAuth client", exc_info=e)
            raise

    @console_ns.response(
        200, "Trigger OAuth client deleted successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_tenant_id
    def delete(self, tenant_id: str, provider: str):
        """Remove custom OAuth client configuration"""

        try:
            provider_id = TriggerProviderID(provider)

            result = TriggerProviderService.delete_custom_oauth_client_params(
                tenant_id=tenant_id,
                provider_id=provider_id,
            )
            return dump_response(SimpleResultResponse, result)
        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error removing OAuth client", exc_info=e)
            raise


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/verify/<path:subscription_id>",
)
class TriggerSubscriptionVerifyApi(Resource):
    @console_ns.expect(console_ns.models[TriggerSubscriptionBuilderVerifyPayload.__name__])
    @console_ns.response(
        200,
        "Trigger subscription verified successfully",
        console_ns.models[TriggerVerificationResponse.__name__],
    )
    @setup_required
    @login_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.PLUGIN_PREFERENCES, resource_required=False)
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def post(self, tenant_id: str, user: Account, provider: str, subscription_id: str):
        """Verify credentials for an existing subscription (edit mode only)"""

        verify_request = TriggerSubscriptionBuilderVerifyPayload.model_validate(console_ns.payload or {})

        try:
            result = TriggerProviderService.verify_subscription_credentials(
                tenant_id=tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_id=subscription_id,
                credentials=verify_request.credentials,
            )
            return dump_response(TriggerVerificationResponse, result)
        except ValueError as e:
            logger.warning("Credential verification failed", exc_info=e)
            raise BadRequest(str(e)) from e
        except Exception as e:
            logger.exception("Error verifying subscription credentials", exc_info=e)
            raise BadRequest(str(e)) from e
