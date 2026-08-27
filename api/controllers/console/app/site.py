from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import NotFound

from constants.languages import supported_language
from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.app.wraps import agent_manage_required_for_agent_app
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.app_site_service import (
    AppSiteAppNotFoundError,
    AppSiteChanges,
    AppSiteNotFoundError,
    AppSiteTokenStrategy,
)

_APP_SITE_EDIT_ROLES = frozenset(
    {
        TenantAccountRole.OWNER,
        TenantAccountRole.ADMIN,
        TenantAccountRole.EDITOR,
    }
)
_APP_SITE_TOKEN_RESET_ROLES = frozenset(
    {
        TenantAccountRole.OWNER,
        TenantAccountRole.ADMIN,
    }
)


class AppSiteUpdatePayload(BaseModel):
    title: str | None = Field(default=None)
    icon_type: str | None = Field(default=None)
    icon: str | None = Field(default=None)
    icon_background: str | None = Field(default=None)
    description: str | None = Field(default=None)
    default_language: str | None = Field(default=None)
    chat_color_theme: str | None = Field(default=None)
    chat_color_theme_inverted: bool | None = Field(default=None)
    customize_domain: str | None = Field(default=None)
    copyright: str | None = Field(default=None)
    privacy_policy: str | None = Field(default=None)
    input_placeholder: str | None = Field(default=None)
    custom_disclaimer: str | None = Field(default=None)
    customize_token_strategy: AppSiteTokenStrategy | None = Field(default=None)
    prompt_public: bool | None = Field(default=None)
    show_workflow_steps: bool | None = Field(default=None)
    use_icon_as_answer_icon: bool | None = Field(default=None)

    @field_validator("default_language")
    @classmethod
    def validate_language(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return supported_language(value)

    def to_changes(self) -> AppSiteChanges:
        return AppSiteChanges(**self.model_dump())


class AppSiteResponse(ResponseModel):
    app_id: str
    access_token: str | None = Field(default=None, validation_alias="code")
    code: str | None = None
    title: str
    icon: str | None = None
    icon_background: str | None = None
    description: str | None = None
    default_language: str
    customize_domain: str | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    input_placeholder: str | None = None
    custom_disclaimer: str | None = None
    customize_token_strategy: str
    prompt_public: bool
    show_workflow_steps: bool
    use_icon_as_answer_icon: bool


register_schema_models(console_ns, AppSiteUpdatePayload, AppSiteResponse)


@console_ns.route("/apps/<uuid:app_id>/site")
class AppSite(Resource):
    @console_ns.doc("update_app_site")
    @console_ns.doc(description="Update application site configuration")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppSiteUpdatePayload.__name__])
    @console_ns.response(200, "Site configuration updated successfully", console_ns.models[AppSiteResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "App not found")
    @console_account_admission(
        allowed_roles=_APP_SITE_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_RELEASE_AND_VERSION,
    )
    @agent_manage_required_for_agent_app
    @model_validate(AppSiteUpdatePayload)
    def post(
        self,
        req_data: AppSiteUpdatePayload,
        request_context: RequestContext,
        app_id: UUID,
    ):
        try:
            site = application_services().app_sites.update(request_context, str(app_id), req_data.to_changes())
        except AppSiteAppNotFoundError as error:
            raise AppNotFoundError() from error
        except AppSiteNotFoundError as error:
            raise NotFound from error

        return dump_response(AppSiteResponse, site)


@console_ns.route("/apps/<uuid:app_id>/site/access-token-reset")
class AppSiteAccessTokenReset(Resource):
    @console_ns.doc("reset_app_site_access_token")
    @console_ns.doc(description="Reset access token for application site")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Access token reset successfully", console_ns.models[AppSiteResponse.__name__])
    @console_ns.response(403, "Insufficient permissions (admin/owner required)")
    @console_ns.response(404, "App or site not found")
    @console_account_admission(
        allowed_roles=_APP_SITE_TOKEN_RESET_ROLES,
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_RELEASE_AND_VERSION,
    )
    @agent_manage_required_for_agent_app
    def post(self, request_context: RequestContext, app_id: UUID):
        try:
            site = application_services().app_sites.reset_access_token(request_context, str(app_id))
        except AppSiteAppNotFoundError as error:
            raise AppNotFoundError() from error
        except AppSiteNotFoundError as error:
            raise NotFound from error

        return dump_response(AppSiteResponse, site)
