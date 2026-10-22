import logging
from http import HTTPStatus
from typing import Any, NoReturn, Self

from flask import make_response, redirect, request
from flask_restx import Resource
from pydantic import BaseModel, RootModel, model_validator
from werkzeug import Response

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
    TriggerSubscriptionChangedError,
    TriggerSubscriptionInvalidError,
    TriggerSubscriptionLimitError,
    TriggerSubscriptionNameConflictError,
    TriggerSubscriptionNotFoundError,
    TriggerSubscriptionProviderError,
)
from controllers.console.wraps import (
    RBACPermission,
    model_validate,
    setup_required,
)
from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.api_entities import (
    SubscriptionBuilderApiEntity,
    TriggerProviderApiEntity,
    TriggerProviderSubscriptionApiEntity,
)
from core.trigger.entities.entities import RequestLog, SubscriptionBuilderUpdater
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from models.provider_ids import TriggerProviderID
from services.trigger.oauth_client_service import TriggerOAuthClientChangedError as TriggerOAuthClientChanged
from services.trigger.oauth_client_service import TriggerOAuthClientConfigError
from services.trigger.oauth_service import (
    TriggerOAuthCallbackRequest,
    TriggerOAuthClientNotConfiguredError,
    TriggerOAuthContextError,
    TriggerOAuthProviderError,
)
from services.trigger.subscription_service import TriggerSubscriptionChangedError as SubscriptionChanged
from services.trigger.subscription_service import TriggerSubscriptionError
from services.trigger.subscription_service import TriggerSubscriptionInvalidError as SubscriptionInvalid
from services.trigger.subscription_service import TriggerSubscriptionLimitError as SubscriptionLimit
from services.trigger.subscription_service import TriggerSubscriptionNameConflictError as SubscriptionNameConflict
from services.trigger.subscription_service import TriggerSubscriptionNotFoundError as SubscriptionNotFound
from services.trigger.subscription_service import TriggerSubscriptionProviderError as SubscriptionProviderError

logger = logging.getLogger(__name__)


def _raise_subscription_error(error: TriggerSubscriptionError) -> NoReturn:
    if isinstance(error, SubscriptionNotFound):
        raise TriggerSubscriptionNotFoundError(str(error)) from error
    if isinstance(error, SubscriptionNameConflict):
        raise TriggerSubscriptionNameConflictError(str(error)) from error
    if isinstance(error, SubscriptionChanged):
        raise TriggerSubscriptionChangedError(str(error)) from error
    if isinstance(error, SubscriptionLimit):
        raise TriggerSubscriptionLimitError(str(error)) from error
    if isinstance(error, SubscriptionInvalid):
        raise TriggerSubscriptionInvalidError(str(error)) from error
    if isinstance(error, SubscriptionProviderError):
        raise TriggerSubscriptionProviderError(str(error)) from error
    raise error


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
    def check_at_least_one_field(self) -> Self:
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
    # response-contract:ignore legacy JSON string containing the icon URL
    @console_ns.response(HTTPStatus.OK, "Trigger provider icon")
    @console_account_admission()
    def get(self, context: RequestContext, provider: str) -> str:
        return application_services().workspaces.trigger_providers.get_icon(
            tenant_id=context.active_workspace_id, provider_id=TriggerProviderID(provider)
        )


@console_ns.route("/workspaces/current/triggers")
class TriggerProviderListApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "Trigger providers retrieved successfully",
        console_ns.models[TriggerProviderListResponse.__name__],
    )
    @console_account_admission()
    def get(self, context: RequestContext) -> list[dict[str, Any]]:
        """List all trigger providers for the current tenant"""
        return TriggerProviderListResponse(
            application_services().workspaces.trigger_providers.list(tenant_id=context.active_workspace_id),
        ).model_dump(mode="json")


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/info")
class TriggerProviderInfoApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "Trigger provider retrieved successfully",
        console_ns.models[TriggerProviderApiEntity.__name__],
    )
    @console_account_admission()
    def get(self, context: RequestContext, provider: str) -> dict[str, Any]:
        """Get info for a trigger provider"""
        return dump_response(
            TriggerProviderApiEntity,
            application_services().workspaces.trigger_providers.get(
                tenant_id=context.active_workspace_id, provider_id=TriggerProviderID(provider)
            ),
        )


@console_ns.route("/workspaces/current/trigger-provider/<path:provider>/subscriptions/list")
class TriggerSubscriptionListApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "Trigger subscriptions retrieved successfully",
        console_ns.models[TriggerProviderSubscriptionListResponse.__name__],
    )
    @console_ns.response(
        HTTPStatus.NOT_FOUND, "Trigger provider not found", console_ns.models[TriggerProviderErrorResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    def get(self, context: RequestContext, provider: str) -> list[dict[str, Any]] | tuple[dict[str, Any], HTTPStatus]:
        """List all trigger subscriptions for the current tenant's provider"""

        try:
            return TriggerProviderSubscriptionListResponse(
                application_services().workspaces.trigger_subscriptions.list(
                    tenant_id=context.active_workspace_id,
                    account_id=context.account_id,
                    provider_id=TriggerProviderID(provider),
                ),
            ).model_dump(mode="json")
        except ValueError as e:
            return TriggerProviderErrorResponse(error=str(e)).model_dump(mode="json"), HTTPStatus.NOT_FOUND
        except Exception as e:
            logger.exception("Error listing trigger providers", exc_info=e)
            raise


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/create",
)
class TriggerSubscriptionBuilderCreateApi(Resource):
    @console_ns.expect(console_ns.models[TriggerSubscriptionBuilderCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Trigger subscription builder created successfully",
        console_ns.models[TriggerSubscriptionBuilderCreateResponse.__name__],
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    @model_validate(TriggerSubscriptionBuilderCreatePayload)
    def post(
        self, req_data: TriggerSubscriptionBuilderCreatePayload, context: RequestContext, provider: str
    ) -> dict[str, Any]:
        """Add a new subscription instance for a trigger provider"""

        try:
            credential_type = CredentialType.of(req_data.credential_type)
            subscription_builder = (
                application_services().workspaces.trigger_builders.create_trigger_subscription_builder(
                    tenant_id=context.active_workspace_id,
                    user_id=context.account_id,
                    provider_id=TriggerProviderID(provider),
                    credential_type=credential_type,
                )
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
        HTTPStatus.OK,
        "Trigger subscription builder retrieved successfully",
        console_ns.models[SubscriptionBuilderApiEntity.__name__],
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    def get(self, context: RequestContext, provider: str, subscription_builder_id: str) -> dict[str, Any]:
        """Get a subscription instance for a trigger provider"""
        subscription_builder = application_services().workspaces.trigger_builders.get_subscription_builder_by_id(
            tenant_id=context.active_workspace_id,
            user_id=context.account_id,
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
        HTTPStatus.OK,
        "Trigger subscription builder verified successfully",
        console_ns.models[TriggerVerificationResponse.__name__],
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.CREDENTIAL_MANAGE, Workspace())],
    )
    @model_validate(TriggerSubscriptionBuilderVerifyPayload)
    def post(
        self,
        req_data: TriggerSubscriptionBuilderVerifyPayload,
        context: RequestContext,
        provider: str,
        subscription_builder_id: str,
    ) -> dict[str, Any]:
        """Verify and update a subscription instance for a trigger provider"""

        try:
            # Use atomic update_and_verify to prevent race conditions
            result = application_services().workspaces.trigger_builders.update_and_verify_builder(
                tenant_id=context.active_workspace_id,
                user_id=context.account_id,
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
        HTTPStatus.OK,
        "Trigger subscription builder updated successfully",
        console_ns.models[SubscriptionBuilderApiEntity.__name__],
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.CREDENTIAL_MANAGE, Workspace())],
    )
    @model_validate(TriggerSubscriptionBuilderUpdatePayload)
    def post(
        self,
        req_data: TriggerSubscriptionBuilderUpdatePayload,
        context: RequestContext,
        provider: str,
        subscription_builder_id: str,
    ) -> dict[str, Any]:
        """Update a subscription instance for a trigger provider"""

        try:
            return (
                application_services()
                .workspaces.trigger_builders.update_trigger_subscription_builder(
                    tenant_id=context.active_workspace_id,
                    user_id=context.account_id,
                    provider_id=TriggerProviderID(provider),
                    subscription_builder_id=subscription_builder_id,
                    subscription_builder_updater=SubscriptionBuilderUpdater(
                        name=req_data.name,
                        parameters=req_data.parameters,
                        properties=req_data.properties,
                        credentials=req_data.credentials,
                    ),
                )
                .model_dump(mode="json")
            )
        except Exception as e:
            logger.exception("Error updating provider credential", exc_info=e)
            raise


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:provider>/subscriptions/builder/logs/<path:subscription_builder_id>",
)
class TriggerSubscriptionBuilderLogsApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "Trigger subscription builder logs retrieved successfully",
        console_ns.models[TriggerSubscriptionBuilderLogsResponse.__name__],
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    def get(self, context: RequestContext, provider: str, subscription_builder_id: str) -> dict[str, Any]:
        """Get the request logs for a subscription instance for a trigger provider"""

        try:
            logs = application_services().workspaces.trigger_builders.list_logs(
                tenant_id=context.active_workspace_id,
                user_id=context.account_id,
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
    @error_responses(
        TriggerSubscriptionNameConflictError, TriggerSubscriptionLimitError, TriggerSubscriptionProviderError
    )
    @console_ns.expect(console_ns.models[TriggerSubscriptionBuilderUpdatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Trigger subscription builder built successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    @model_validate(TriggerSubscriptionBuilderUpdatePayload)
    def post(
        self,
        req_data: TriggerSubscriptionBuilderUpdatePayload,
        context: RequestContext,
        provider: str,
        subscription_builder_id: str,
    ) -> dict[str, Any]:
        """Build a subscription instance for a trigger provider"""
        try:
            # Use atomic update_and_build to prevent race conditions
            application_services().workspaces.trigger_builders.update_and_build_builder(
                tenant_id=context.active_workspace_id,
                user_id=context.account_id,
                provider_id=TriggerProviderID(provider),
                subscription_builder_id=subscription_builder_id,
                subscription_builder_updater=SubscriptionBuilderUpdater(
                    name=req_data.name,
                    parameters=req_data.parameters,
                    properties=req_data.properties,
                ),
            )
            return SimpleResultResponse(result="success").model_dump(mode="json")
        except TriggerSubscriptionError as error:
            _raise_subscription_error(error)
        except Exception as e:
            logger.exception("Error building provider credential", exc_info=e)
            raise ValueError(str(e)) from e


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:subscription_id>/subscriptions/update",
)
class TriggerSubscriptionUpdateApi(Resource):
    @error_responses(
        TriggerSubscriptionNotFoundError,
        TriggerSubscriptionNameConflictError,
        TriggerSubscriptionChangedError,
        TriggerSubscriptionProviderError,
    )
    @console_ns.expect(console_ns.models[TriggerSubscriptionBuilderUpdatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Trigger subscription updated successfully", console_ns.models[SimpleResultResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    @model_validate(TriggerSubscriptionBuilderUpdatePayload)
    def post(
        self, req_data: TriggerSubscriptionBuilderUpdatePayload, context: RequestContext, subscription_id: str
    ) -> dict[str, Any]:
        """Rename a subscription or rebuild its provider configuration."""
        try:
            application_services().workspaces.trigger_subscription_management.update(
                tenant_id=context.active_workspace_id,
                subscription_id=subscription_id,
                name=req_data.name,
                properties=req_data.properties,
                parameters=req_data.parameters,
                credentials=req_data.credentials,
            )
        except TriggerSubscriptionError as error:
            _raise_subscription_error(error)
        return SimpleResultResponse(result="success").model_dump(mode="json")


@console_ns.route(
    "/workspaces/current/trigger-provider/<path:subscription_id>/subscriptions/delete",
)
class TriggerSubscriptionDeleteApi(Resource):
    @error_responses(
        TriggerSubscriptionNotFoundError, TriggerSubscriptionChangedError, TriggerSubscriptionProviderError
    )
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN}),
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    def post(self, context: RequestContext, subscription_id: str) -> dict[str, Any]:
        """Delete the subscription and its workflow trigger bindings."""
        try:
            application_services().workspaces.trigger_subscription_management.delete(
                tenant_id=context.active_workspace_id,
                subscription_id=subscription_id,
            )
        except TriggerSubscriptionError as error:
            _raise_subscription_error(error)
        return SimpleResultResponse(result="success").model_dump(mode="json")


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
    @error_responses(
        TriggerSubscriptionNotFoundError, TriggerSubscriptionInvalidError, TriggerSubscriptionProviderError
    )
    @console_ns.expect(console_ns.models[TriggerSubscriptionVerifyPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Trigger subscription verified successfully",
        console_ns.models[TriggerVerificationResponse.__name__],
    )
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    @model_validate(TriggerSubscriptionVerifyPayload)
    def post(
        self,
        req_data: TriggerSubscriptionVerifyPayload,
        context: RequestContext,
        provider: str,
        subscription_id: str,
    ) -> dict[str, Any]:
        """Verify credentials against the subscription's own provider without updating it."""
        try:
            result = application_services().workspaces.trigger_subscription_management.verify(
                tenant_id=context.active_workspace_id,
                user_id=context.account_id,
                provider_id=TriggerProviderID(provider),
                subscription_id=subscription_id,
                credentials=req_data.credentials,
            )
        except TriggerSubscriptionError as error:
            _raise_subscription_error(error)
        return dump_response(TriggerVerificationResponse, result)
