from typing import Any, cast

from flask_restx import fields, marshal, marshal_with
from pydantic import Field
from sqlalchemy import select
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.schema import register_response_schema_models
from controllers.web import web_ns
from controllers.web.wraps import WebApiResource
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import AppIconUrlField
from models.account import TenantStatus
from models.model import App, EndUser, Site
from services.feature_service import FeatureModel, FeatureService


class AppSiteModelConfigResponse(ResponseModel):
    opening_statement: str | None = None
    suggested_questions: Any
    suggested_questions_after_answer: Any
    more_like_this: Any
    model: Any
    user_input_form: Any
    pre_prompt: str | None = None


class AppSiteResponse(ResponseModel):
    title: str | None = None
    chat_color_theme: str | None = None
    chat_color_theme_inverted: bool | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    icon_url: str | None = None
    description: str | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    input_placeholder: str | None = None
    custom_disclaimer: str | None = None
    default_language: str | None = None
    prompt_public: bool | None = None
    show_workflow_steps: bool | None = None
    use_icon_as_answer_icon: bool | None = None


class AppSiteInfoResponse(ResponseModel):
    app_id: str
    end_user_id: str | None = None
    enable_site: bool
    site: AppSiteResponse
    model_config_: AppSiteModelConfigResponse | None = Field(default=None, alias="model_config")
    plan: str | None = None
    can_replace_logo: bool
    custom_config: dict[str, Any] | None = Field(default=None)


register_response_schema_models(web_ns, AppSiteInfoResponse)


@web_ns.route("/site")
class AppSiteApi(WebApiResource):
    """Resource for app sites."""

    model_config_fields = {
        "opening_statement": fields.String,
        "suggested_questions": fields.Raw(attribute="suggested_questions_list"),
        "suggested_questions_after_answer": fields.Raw(attribute="suggested_questions_after_answer_dict"),
        "more_like_this": fields.Raw(attribute="more_like_this_dict"),
        "model": fields.Raw(attribute="model_dict"),
        "user_input_form": fields.Raw(attribute="user_input_form_list"),
        "pre_prompt": fields.String,
    }

    site_fields = {
        "title": fields.String,
        "chat_color_theme": fields.String,
        "chat_color_theme_inverted": fields.Boolean,
        "icon_type": fields.String,
        "icon": fields.String,
        "icon_background": fields.String,
        "icon_url": AppIconUrlField,
        "description": fields.String,
        "copyright": fields.String,
        "privacy_policy": fields.String,
        "input_placeholder": fields.String,
        "custom_disclaimer": fields.String,
        "default_language": fields.String,
        "prompt_public": fields.Boolean,
        "show_workflow_steps": fields.Boolean,
        "use_icon_as_answer_icon": fields.Boolean,
    }

    app_fields = {
        "app_id": fields.String,
        "end_user_id": fields.String,
        "enable_site": fields.Boolean,
        "site": fields.Nested(site_fields),
        "model_config": fields.Nested(model_config_fields, allow_null=True),
        "plan": fields.String,
        "can_replace_logo": fields.Boolean,
        "custom_config": fields.Raw(attribute="custom_config"),
    }

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
    @web_ns.response(200, "Success", web_ns.models[AppSiteInfoResponse.__name__])
    @marshal_with(app_fields)
    def get(self, app_model: App, end_user: EndUser):
        """Retrieve app site info."""
        # get site
        site = db.session.scalar(select(Site).where(Site.app_id == app_model.id).limit(1))

        if not site:
            raise Forbidden()

        if app_model.tenant and app_model.tenant.status == TenantStatus.ARCHIVE:
            raise Forbidden()

        features = FeatureService.get_features(app_model.tenant_id, exclude_vector_space=True)

        return AppSiteInfo(
            app_model.tenant,
            app_model,
            serialize_runtime_site(site, features),
            end_user.id,
            features.can_replace_logo,
        )


class AppSiteInfo:
    """Class to store site information."""

    def __init__(self, tenant, app, site, end_user, can_replace_logo):
        """Initialize AppSiteInfo instance."""
        self.app_id = app.id
        self.end_user_id = end_user
        self.enable_site = app.enable_site
        self.site = site
        self.model_config = None
        self.plan = tenant.plan
        self.can_replace_logo = can_replace_logo

        if can_replace_logo:
            base_url = dify_config.FILES_URL
            remove_webapp_brand = tenant.custom_config_dict.get("remove_webapp_brand", False)
            replace_webapp_logo = (
                f"{base_url}/files/workspaces/{tenant.id}/webapp-logo"
                if tenant.custom_config_dict.get("replace_webapp_logo")
                else None
            )
            self.custom_config = {
                "remove_webapp_brand": remove_webapp_brand,
                "replace_webapp_logo": replace_webapp_logo,
            }


def serialize_site(site: Site) -> dict[str, Any]:
    """Serialize Site model using the same schema as AppSiteApi."""
    return cast(dict[str, Any], marshal(site, AppSiteApi.site_fields))


def serialize_runtime_site(site: Site, features: FeatureModel) -> dict[str, Any]:
    site_payload = serialize_site(site)
    if not features.billing.enabled or features.webapp_copyright_enabled:
        return site_payload

    site_payload["copyright"] = None
    site_payload["input_placeholder"] = None
    return site_payload


def serialize_app_site_payload(app_model: App, site: Site, end_user_id: str | None) -> dict[str, Any]:
    features = FeatureService.get_features(app_model.tenant_id, exclude_vector_space=True)
    app_site_info = AppSiteInfo(
        app_model.tenant,
        app_model,
        serialize_runtime_site(site, features),
        end_user_id,
        features.can_replace_logo,
    )
    return cast(dict[str, Any], marshal(app_site_info, AppSiteApi.app_fields))
