from typing import Any, Self

from pydantic import AliasChoices, Field, computed_field
from sqlalchemy import select
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.schema import register_response_schema_models
from controllers.web import web_ns
from controllers.web.wraps import WebApiResource
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import build_icon_url
from models.account import Tenant, TenantStatus
from models.model import App, EndUser, Site
from services.feature_service import FeatureModel, FeatureService


class WebSiteResponse(ResponseModel):
    title: str
    chat_color_theme: str | None = None
    chat_color_theme_inverted: bool
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    description: str | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    input_placeholder: str | None = None
    custom_disclaimer: str | None = None
    default_language: str | None = None
    prompt_public: bool | None = None
    show_workflow_steps: bool | None = None
    use_icon_as_answer_icon: bool | None = None

    @computed_field(return_type=str | None)  # type: ignore[prop-decorator]
    @property
    def icon_url(self) -> str | None:
        return build_icon_url(self.icon_type, self.icon)


class WebModelConfigResponse(ResponseModel):
    opening_statement: str | None = None
    suggested_questions: Any = Field(
        default=None,
        validation_alias=AliasChoices("suggested_questions_list", "suggested_questions"),
    )
    suggested_questions_after_answer: Any = Field(
        default=None,
        validation_alias=AliasChoices("suggested_questions_after_answer_dict", "suggested_questions_after_answer"),
    )
    more_like_this: Any = Field(
        default=None,
        validation_alias=AliasChoices("more_like_this_dict", "more_like_this"),
    )
    model: Any = Field(default=None, validation_alias=AliasChoices("model_dict", "model"))
    user_input_form: Any = Field(
        default=None,
        validation_alias=AliasChoices("user_input_form_list", "user_input_form"),
    )
    pre_prompt: str | None = None


class WebAppCustomConfigResponse(ResponseModel):
    remove_webapp_brand: bool
    replace_webapp_logo: str | None = None


class WebAppSiteResponse(ResponseModel):
    app_id: str
    end_user_id: str | None = None
    enable_site: bool
    site: WebSiteResponse
    model_config_: WebModelConfigResponse | None = Field(
        default=None, validation_alias="model_config", serialization_alias="model_config"
    )
    plan: str
    can_replace_logo: bool
    custom_config: WebAppCustomConfigResponse | None = None

    @classmethod
    def from_app_site(
        cls,
        *,
        tenant: Tenant,
        app_model: App,
        site: Site,
        end_user_id: str | None,
        features: FeatureModel,
        can_replace_logo: bool,
    ) -> Self:
        custom_config = None
        if can_replace_logo:
            replace_webapp_logo = (
                f"{dify_config.FILES_URL}/files/workspaces/{tenant.id}/webapp-logo"
                if tenant.custom_config_dict.get("replace_webapp_logo")
                else None
            )
            custom_config = WebAppCustomConfigResponse(
                remove_webapp_brand=tenant.custom_config_dict.get("remove_webapp_brand", False),
                replace_webapp_logo=replace_webapp_logo,
            )

        site_response = WebSiteResponse.model_validate(site, from_attributes=True)
        if features.billing.enabled and not features.webapp_copyright_enabled:
            site_response.copyright = None
            site_response.input_placeholder = None

        return cls(
            app_id=app_model.id,
            end_user_id=end_user_id,
            enable_site=app_model.enable_site,
            site=site_response,
            model_config_=None,
            plan=tenant.plan,
            can_replace_logo=can_replace_logo,
            custom_config=custom_config,
        )


register_response_schema_models(
    web_ns, WebSiteResponse, WebModelConfigResponse, WebAppCustomConfigResponse, WebAppSiteResponse
)


@web_ns.route("/site")
class AppSiteApi(WebApiResource):
    @web_ns.doc("Get App Site Info")
    @web_ns.doc(description="Retrieve app site information and configuration.")
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "App Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[WebAppSiteResponse.__name__])
    def get(self, app_model: App, end_user: EndUser):
        """Retrieve app site info."""
        # get site
        site = db.session.scalar(select(Site).where(Site.app_id == app_model.id).limit(1))

        if site is None:
            raise Forbidden()

        tenant = app_model.tenant
        if tenant is None or tenant.status == TenantStatus.ARCHIVE:
            raise Forbidden()

        features = FeatureService.get_features(app_model.tenant_id, exclude_vector_space=True)

        return WebAppSiteResponse.from_app_site(
            tenant=tenant,
            app_model=app_model,
            site=site,
            end_user_id=end_user.id,
            features=features,
            can_replace_logo=features.can_replace_logo,
        ).model_dump(mode="json")
