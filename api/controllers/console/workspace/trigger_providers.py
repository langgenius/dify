import logging
from http import HTTPStatus
from typing import Any

from flask import make_response, redirect, request
from flask_restx import Resource
from pydantic import BaseModel, RootModel, model_validator
from sqlalchemy.orm import sessionmaker
from werkzeug import Response
from werkzeug.exceptions import BadRequest

from configs import dify_config
from controllers.common.errors import ForbiddenError, NotFoundError
from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import RBACCheck, Workspace
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.workspace.error import (
    TriggerOAuthClientChangedError,
    TriggerOAuthClientConfigInvalidError,
    TriggerOAuthContextInvalidError,
    TriggerOAuthProviderRequestError,
)
from controllers.console.wraps import (
    RBACPermission,
    account_initialization_required,
    edit_permission_required,
    is_admin_or_owner_required,
    model_validate,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.api_entities import (
    SubscriptionBuilderApiEntity,
    TriggerProviderApiEntity,
    TriggerProviderSubscriptionApiEntity,
)
from core.trigger.entities.entities import RequestLog, SubscriptionBuilderUpdater
from core.trigger.trigger_manager import TriggerManager
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.login import login_required
from machinery.context import RequestContext
from models.account import Account
from models.provider_ids import TriggerProviderID
from services.trigger.oauth_client_service import TriggerOAuthClientChangedError as TriggerOAuthClientChanged
from services.trigger.oauth_client_service import TriggerOAuthClientConfigError
from services.trigger.oauth_service import (
    TriggerOAuthCallbackRequest,
    TriggerOAuthClientNotConfiguredError,
    TriggerOAuthContextError,
    TriggerOAuthProviderError,
)
from services.trigger.trigger_provider_service import TriggerProviderService
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService
from services.trigger.trigger_subscription_operator_service import TriggerSubscriptionOperatorService

logger = logging.getLogger(__name__)


class TriggerSubscriptionBuilderCreatePayload(BaseModel):
    credential_type: str = CredentialType.UNAUTHORIZED


class TriggerSubscriptionBuilderVerifyPayload(BaseModel):
    credentials: dict[str, Any] | None = None


class TriggerSubscriptionVerifyPayload(BaseModel):
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
    client_params: dict[str, object] | None = None
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
    params: dict[str, object]


class TriggerProviderErrorResponse(ResponseModel):
    error: str


register_schema_models(
    console_ns,
    TriggerSubscriptionBuilderCreatePayload,
    TriggerSubscriptionBuilderVerifyPayload,
    TriggerSubscriptionBuilderUpdatePayload,
    TriggerSubscriptionVerifyPayload,
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
    @rbac_permission_required(RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace()))
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
                    credential_query=application_services().credential_queries,
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
    @rbac_permission_required(RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace()))
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @model_validate(TriggerSubscriptionBuilderCreatePayload)
    def post(self, req_data: TriggerSubscriptionBuilderCreatePayload, tenant_id: str, user: Account, provider: str):
        """Add a new subscription instance for a trigger provider"""

        try:
            credential_type = CredentialType.of(req_data.credential_type)
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
    @rbac_permission_required(RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace()))
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account, provider: str, subscription_builder_id: str):
        """Get a subscription instance for a trigger provider"""
        subscription_builder = TriggerSubscriptionBuilderService.get_subscription_builder_by_id(
            tenant_id=tenant_id,
            user_id=user.id,
            provider_id=TriggerProviderID(provider),
            subscription_builder_id=subscription_builder_id,
        )
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
    @rbac_permission_required(RBACCheck(RBACPermission.CREDENTIAL_MANAGE, Workspace()))
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @model_validate(TriggerSubscriptionBuilderVerifyPayload)
    def post(
        self,
        req_data: TriggerSubscriptionBuilderVerifyPayload,
        tenant_id: str,
        user: Account,
        provider: str,
        subscription_builder_id: str,
    ):
        """Verify and update a subscription instance for a trigger provider"""

        try:
            # Use atomic update_and_verify to prevent race conditions
            result = TriggerSubscriptionBuilderService.update_and_verify_builder(
                tenant_id=tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
                subscription_builder_updater=SubscriptionBuilderUpdater(
                    credentials=req_data.credentials,
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
    @rbac_permission_required(RBACCheck(RBACPermission.CREDENTIAL_MANAGE, Workspace()))
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @model_validate(TriggerSubscriptionBuilderUpdatePayload)
    def post(
        self,
        req_data: TriggerSubscriptionBuilderUpdatePayload,
        tenant_id: str,
        user: Account,
        provider: str,
        subscription_builder_id: str,
    ):
        """Update a subscription instance for a trigger provider"""

        try:
            return TriggerSubscriptionBuilderService.update_trigger_subscription_builder(
                tenant_id=tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
                subscription_builder_updater=SubscriptionBuilderUpdater(
                    name=req_data.name,
                    parameters=req_data.parameters,
                    properties=req_data.properties,
                    credentials=req_data.credentials,
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
    @rbac_permission_required(RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace()))
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    def get(self, tenant_id: str, user: Account, provider: str, subscription_builder_id: str):
        """Get the request logs for a subscription instance for a trigger provider"""

        try:
            logs = TriggerSubscriptionBuilderService.list_logs(
                tenant_id=tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
            )
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
    @rbac_permission_required(RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace()))
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @model_validate(TriggerSubscriptionBuilderUpdatePayload)
    def post(
        self,
        req_data: TriggerSubscriptionBuilderUpdatePayload,
        tenant_id: str,
        user: Account,
        provider: str,
        subscription_builder_id: str,
    ):
        """Build a subscription instance for a trigger provider"""
        try:
            # Use atomic update_and_build to prevent race conditions
            TriggerSubscriptionBuilderService.update_and_build_builder(
                tenant_id=tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
                subscription_builder_updater=SubscriptionBuilderUpdater(
                    name=req_data.name,
                    parameters=req_data.parameters,
                    properties=req_data.properties,
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
    @rbac_permission_required(RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace()))
    @account_initialization_required
    @with_current_tenant_id
    @model_validate(TriggerSubscriptionBuilderUpdatePayload)
    def post(self, req_data: TriggerSubscriptionBuilderUpdatePayload, tenant_id: str, subscription_id: str):
        """Update a subscription instance"""

        subscription = TriggerProviderService.get_subscription_by_id(
            tenant_id=tenant_id,
            subscription_id=subscription_id,
        )
        if not subscription:
            raise NotFoundError(f"Subscription {subscription_id} not found")

        provider_id = TriggerProviderID(subscription.provider_id)

        try:
            # For rename only, just update the name
            rename = req_data.name is not None and not any(
                (req_data.credentials, req_data.parameters, req_data.properties)
            )
            # When credential type is UNAUTHORIZED, it indicates the subscription was manually created
            # For Manually created subscription, they dont have credentials, parameters
            # They only have name and properties(which is input by user)
            manually_created = subscription.credential_type == CredentialType.UNAUTHORIZED
            if rename or manually_created:
                TriggerProviderService.update_trigger_subscription(
                    tenant_id=tenant_id,
                    subscription_id=subscription_id,
                    name=req_data.name,
                    properties=req_data.properties,
                )
                return SimpleResultResponse(result="success").model_dump(mode="json")

            # For the rest cases(API_KEY, OAUTH2)
            # we need to call third party provider(e.g. GitHub) to rebuild the subscription
            TriggerProviderService.rebuild_trigger_subscription(
                tenant_id=tenant_id,
                name=req_data.name,
                provider_id=provider_id,
                subscription_id=subscription_id,
                credentials=req_data.credentials or subscription.credentials,
                parameters=req_data.parameters or subscription.parameters,
            )
            return SimpleResultResponse(result="success").model_dump(mode="json")
        except ValueError as e:
            raise BadRequest(str(e)) from e
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
    @rbac_permission_required(RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace()))
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
            raise BadRequest(str(e)) from e
        except Exception as e:
            logger.exception("Error deleting provider credential", exc_info=e)
            raise


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/subscriptions/oauth/authorize")
class TriggerOAuthAuthorizeApi(Resource):
    # response-contract:ignore cookie-bearing Flask response
    @error_responses(NotFoundError, TriggerOAuthClientConfigInvalidError, TriggerOAuthProviderRequestError)
    @console_ns.response(
        HTTPStatus.OK,
        "Trigger OAuth authorization URL generated successfully",
        console_ns.models[TriggerOAuthAuthorizeResponse.__name__],
    )
    @console_account_admission()
    def get(self, context: RequestContext, provider: str) -> Response:
        """Initiate OAuth authorization flow for a trigger provider."""
        try:
            result = application_services().workspaces.trigger_oauth.authorize(
                tenant_id=context.active_workspace_id,
                user_id=context.account_id,
                provider_id=TriggerProviderID(provider),
                redirect_uri=f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider}/trigger/callback",
            )
        except TriggerOAuthClientNotConfiguredError as error:
            raise NotFoundError(str(error)) from error
        except TriggerOAuthClientConfigError as error:
            raise TriggerOAuthClientConfigInvalidError(str(error)) from error
        except TriggerOAuthProviderError as error:
            raise TriggerOAuthProviderRequestError(str(error)) from error

        response = make_response(
            dump_response(
                TriggerOAuthAuthorizeResponse,
                {
                    "authorization_url": result.authorization_url,
                    "subscription_builder_id": result.subscription_builder.id,
                    "subscription_builder": result.subscription_builder,
                },
            )
        )
        response.set_cookie(
            "context_id",
            result.context_id,
            httponly=True,
            samesite="Lax",
            max_age=result.context_max_age,
        )
        return response


@console_ns.route("/oauth/plugin/<path:provider>/trigger/callback")
class TriggerOAuthCallbackApi(Resource):
    # response-contract:ignore redirect response
    @error_responses(
        ForbiddenError,
        TriggerOAuthContextInvalidError,
        TriggerOAuthClientConfigInvalidError,
        TriggerOAuthProviderRequestError,
    )
    @console_ns.response(HTTPStatus.FOUND, "Redirect to OAuth callback page")
    @setup_required
    def get(self, provider: str) -> Response:
        """Complete the cookie-bound flow without requiring a Console login."""
        try:
            application_services().workspaces.trigger_oauth.callback(
                provider_id=TriggerProviderID(provider),
                context_id=request.cookies.get("context_id"),
                redirect_uri=f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider}/trigger/callback",
                callback=TriggerOAuthCallbackRequest(
                    method=request.method,
                    full_path=request.full_path,
                    headers=tuple(request.headers.items()),
                    body=request.get_data(as_text=False),
                ),
            )
        except TriggerOAuthContextError as error:
            raise TriggerOAuthContextInvalidError(str(error)) from error
        except TriggerOAuthClientNotConfiguredError as error:
            raise ForbiddenError(str(error)) from error
        except TriggerOAuthClientConfigError as error:
            raise TriggerOAuthClientConfigInvalidError(str(error)) from error
        except TriggerOAuthProviderError as error:
            raise TriggerOAuthProviderRequestError(str(error)) from error
        return redirect(f"{dify_config.CONSOLE_WEB_URL}/oauth-callback", code=HTTPStatus.FOUND)


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/oauth/client")
class TriggerOAuthClientManageApi(Resource):
    @error_responses(TriggerOAuthClientConfigInvalidError)
    @console_ns.response(
        HTTPStatus.OK,
        "Trigger OAuth client retrieved successfully",
        console_ns.models[TriggerOAuthClientResponse.__name__],
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN}),
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    def get(self, context: RequestContext, provider: str) -> dict[str, object]:
        """Get the masked OAuth client configuration for a provider."""
        try:
            configuration = application_services().workspaces.trigger_oauth_clients.get(
                tenant_id=context.active_workspace_id,
                provider_id=TriggerProviderID(provider),
            )
        except TriggerOAuthClientConfigError as error:
            raise TriggerOAuthClientConfigInvalidError(str(error)) from error
        return dump_response(
            TriggerOAuthClientResponse,
            {
                "configured": bool(configuration.params or configuration.system_configured),
                "system_configured": configuration.system_configured,
                "custom_configured": bool(configuration.params),
                "oauth_client_schema": configuration.schema,
                "custom_enabled": configuration.custom_enabled,
                "redirect_uri": f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider}/trigger/callback",
                "params": dict(configuration.params),
            },
        )

    @error_responses(TriggerOAuthClientConfigInvalidError, TriggerOAuthClientChangedError)
    @console_ns.expect(console_ns.models[TriggerOAuthClientPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Trigger OAuth client saved successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN}),
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    @model_validate(TriggerOAuthClientPayload)
    def post(self, req_data: TriggerOAuthClientPayload, context: RequestContext, provider: str) -> dict[str, object]:
        """Configure the workspace's custom OAuth client for a provider."""
        try:
            application_services().workspaces.trigger_oauth_clients.save(
                tenant_id=context.active_workspace_id,
                provider_id=TriggerProviderID(provider),
                client_params=req_data.client_params,
                enabled=req_data.enabled,
            )
        except TriggerOAuthClientChanged as error:
            raise TriggerOAuthClientChangedError(str(error)) from error
        except TriggerOAuthClientConfigError as error:
            raise TriggerOAuthClientConfigInvalidError(str(error)) from error
        return dump_response(SimpleResultResponse, {"result": "success"})

    @console_ns.response(
        HTTPStatus.OK, "Trigger OAuth client deleted successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN}),
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    def delete(self, context: RequestContext, provider: str) -> dict[str, object]:
        """Remove the workspace's custom OAuth client configuration."""
        application_services().workspaces.trigger_oauth_clients.delete(
            tenant_id=context.active_workspace_id,
            provider_id=TriggerProviderID(provider),
        )
        return dump_response(SimpleResultResponse, {"result": "success"})


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/verify/<path:subscription_id>",
)
class TriggerSubscriptionVerifyApi(Resource):
    @console_ns.expect(console_ns.models[TriggerSubscriptionVerifyPayload.__name__])
    @console_ns.response(
        200,
        "Trigger subscription verified successfully",
        console_ns.models[TriggerVerificationResponse.__name__],
    )
    @setup_required
    @login_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace()))
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @model_validate(TriggerSubscriptionVerifyPayload)
    def post(
        self,
        req_data: TriggerSubscriptionVerifyPayload,
        tenant_id: str,
        user: Account,
        provider: str,
        subscription_id: str,
    ):
        """Verify credentials for an existing subscription (edit mode only)"""

        try:
            result = TriggerProviderService.verify_subscription_credentials(
                tenant_id=tenant_id,
                user_id=user.id,
                provider_id=TriggerProviderID(provider),
                subscription_id=subscription_id,
                credentials=req_data.credentials,
            )
            return dump_response(TriggerVerificationResponse, result)
        except ValueError as e:
            logger.warning("Credential verification failed", exc_info=e)
            raise BadRequest(str(e)) from e
        except Exception as e:
            logger.exception("Error verifying subscription credentials", exc_info=e)
            raise BadRequest(str(e)) from e
