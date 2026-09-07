import logging
from http import HTTPStatus
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from uuid import UUID

from flask import redirect
from flask_restx import Resource
from pydantic import BaseModel, Field, ValidationError

from configs import dify_config
from controllers.common.fields import RedirectResponse
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console.flask_admission import console_account_admission
from core.rbac import RBACPermission, RBACResourceScope
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.data_source_oauth_service import (
    DataSourceOAuthConfigurationError,
    DataSourceOAuthError,
    InvalidDataSourceOAuthCodeError,
    InvalidDataSourceOAuthProviderError,
)
from services.entities.data_source_oauth_entities import DataSourceOAuthCallback

from .. import console_ns

logger = logging.getLogger(__name__)


class OAuthDataSourceResponse(ResponseModel):
    data: str = Field(description="Authorization URL or 'internal' for internal setup")


class OAuthDataSourceBindingResponse(ResponseModel):
    result: str = Field(description="Operation result")


class OAuthDataSourceSyncResponse(ResponseModel):
    result: str = Field(description="Operation result")


class OAuthDataSourceCallbackQuery(BaseModel):
    code: str | None = Field(default=None, description="Authorization code from OAuth provider")
    error: str | None = Field(default=None, description="Error message from OAuth provider")


class OAuthDataSourceBindingQuery(BaseModel):
    code: str = Field(description="Authorization code from OAuth provider")


register_schema_models(
    console_ns,
    OAuthDataSourceCallbackQuery,
    OAuthDataSourceBindingQuery,
)
register_response_schema_models(
    console_ns,
    OAuthDataSourceResponse,
    OAuthDataSourceBindingResponse,
    OAuthDataSourceSyncResponse,
)
register_response_schema_model(console_ns, RedirectResponse)

_ADMIN_OR_OWNER_ROLES = frozenset({TenantAccountRole.ADMIN, TenantAccountRole.OWNER})


def _invalid_provider_response() -> tuple[dict[str, str], HTTPStatus]:
    return {"error": "Invalid provider"}, HTTPStatus.BAD_REQUEST


def _provider_failure_response(provider: str, error: Exception) -> tuple[dict[str, str], HTTPStatus]:
    logger.exception("OAuth data source operation failed for provider %s", provider, exc_info=error)
    return {"error": "OAuth data source process failed"}, HTTPStatus.BAD_REQUEST


def _callback_redirect_location(callback: DataSourceOAuthCallback) -> str:
    callback_value = ("code", callback.code) if callback.code is not None else ("error", callback.error)
    split_url = urlsplit(dify_config.CONSOLE_WEB_URL)
    query = [*parse_qsl(split_url.query, keep_blank_values=True), ("type", callback.provider), callback_value]
    return urlunsplit(
        (
            split_url.scheme,
            split_url.netloc,
            split_url.path,
            urlencode(query, quote_via=quote),
            split_url.fragment,
        )
    )


@console_ns.route("/oauth/data-source/<string:provider>")
class OAuthDataSource(Resource):
    @console_ns.doc("oauth_data_source")
    @console_ns.doc(description="Get OAuth authorization URL for data source provider")
    @console_ns.doc(params={"provider": "Data source provider name (notion)"})
    @console_ns.response(
        HTTPStatus.OK,
        "Authorization URL or internal setup success",
        console_ns.models[OAuthDataSourceResponse.__name__],
    )
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid provider")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Admin privileges required")
    @console_account_admission(
        allowed_roles=_ADMIN_OR_OWNER_ROLES,
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.CREDENTIAL_MANAGE,
        rbac_resource_required=False,
    )
    def get(self, request_context: RequestContext, provider: str):
        try:
            service = application_services().resolve_data_source_oauth(provider)
            authorization = service.start_authorization(request_context)
        except InvalidDataSourceOAuthProviderError:
            return _invalid_provider_response()
        except DataSourceOAuthConfigurationError as error:
            return {"error": str(error)}, HTTPStatus.BAD_REQUEST
        except DataSourceOAuthError as error:
            return _provider_failure_response(provider, error)

        return dump_response(OAuthDataSourceResponse, {"data": authorization}), HTTPStatus.OK


@console_ns.route("/oauth/data-source/callback/<string:provider>")
class OAuthDataSourceCallback(Resource):
    @console_ns.doc("oauth_data_source_callback")
    @console_ns.doc(description="Handle OAuth callback from data source provider")
    @console_ns.doc(params={"provider": "Data source provider name (notion)"})
    @console_ns.doc(params=query_params_from_model(OAuthDataSourceCallbackQuery))
    @console_ns.response(
        HTTPStatus.FOUND, "Redirect to console with result", console_ns.models[RedirectResponse.__name__]
    )
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid provider")
    def get(self, provider: str):
        query = query_params_from_request(OAuthDataSourceCallbackQuery)
        try:
            service = application_services().resolve_data_source_oauth(provider)
            callback = service.complete_callback(
                code=query.code,
                error=query.error,
            )
        except InvalidDataSourceOAuthProviderError:
            return _invalid_provider_response()
        return redirect(_callback_redirect_location(callback))


@console_ns.route("/oauth/data-source/binding/<string:provider>")
class OAuthDataSourceBinding(Resource):
    @console_ns.doc("oauth_data_source_binding")
    @console_ns.doc(description="Bind OAuth data source with authorization code")
    @console_ns.doc(params={"provider": "Data source provider name (notion)"})
    @console_ns.doc(params=query_params_from_model(OAuthDataSourceBindingQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "Data source binding success",
        console_ns.models[OAuthDataSourceBindingResponse.__name__],
    )
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid provider or code")
    @console_account_admission()
    def get(self, request_context: RequestContext, provider: str):
        try:
            query = query_params_from_request(OAuthDataSourceBindingQuery)
        except ValidationError:
            return {"error": "Invalid code"}, HTTPStatus.BAD_REQUEST
        if not query.code:
            return {"error": "Invalid code"}, HTTPStatus.BAD_REQUEST
        try:
            service = application_services().resolve_data_source_oauth(provider)
            service.bind(request_context, code=query.code)
        except InvalidDataSourceOAuthProviderError:
            return _invalid_provider_response()
        except InvalidDataSourceOAuthCodeError:
            return {"error": "Invalid code"}, HTTPStatus.BAD_REQUEST
        except DataSourceOAuthError as error:
            return _provider_failure_response(provider, error)

        return dump_response(OAuthDataSourceBindingResponse, {"result": "success"}), HTTPStatus.OK


@console_ns.route("/oauth/data-source/<string:provider>/<uuid:binding_id>/sync")
class OAuthDataSourceSync(Resource):
    @console_ns.doc("oauth_data_source_sync")
    @console_ns.doc(description="Sync data from OAuth data source")
    @console_ns.doc(params={"provider": "Data source provider name (notion)", "binding_id": "Data source binding ID"})
    @console_ns.response(
        HTTPStatus.OK,
        "Data source sync success",
        console_ns.models[OAuthDataSourceSyncResponse.__name__],
    )
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid provider or sync failed")
    @console_account_admission()
    def get(self, request_context: RequestContext, provider: str, binding_id: UUID):
        try:
            service = application_services().resolve_data_source_oauth(provider)
            service.sync(
                request_context,
                binding_id=str(binding_id),
            )
        except InvalidDataSourceOAuthProviderError:
            return _invalid_provider_response()
        except DataSourceOAuthError as error:
            return _provider_failure_response(provider, error)

        return dump_response(OAuthDataSourceSyncResponse, {"result": "success"}), HTTPStatus.OK
