from typing import Literal

from flask_restx import Resource, marshal_with
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import NotFound

from constants.languages import supported_language
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    is_admin_or_owner_required,
    setup_required,
)
from extensions.ext_database import db
from fields.app_fields import app_site_fields
from libs.datetime_utils import naive_utc_now
from libs.login import current_account_with_tenant, login_required
from models import Site

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


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
    custom_disclaimer: str | None = Field(default=None)
    customize_token_strategy: Literal["must", "allow", "not_allow"] | None = Field(default=None)
    prompt_public: bool | None = Field(default=None)
    show_workflow_steps: bool | None = Field(default=None)
    use_icon_as_answer_icon: bool | None = Field(default=None)

    @field_validator("default_language")
    @classmethod
    def validate_language(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return supported_language(value)


console_ns.schema_model(
    AppSiteUpdatePayload.__name__,
    AppSiteUpdatePayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)

# Register model for flask_restx to avoid dict type issues in Swagger
app_site_model = console_ns.model("AppSite", app_site_fields)


@console_ns.route("/apps/<uuid:app_id>/site")
class AppSite(Resource):
    @console_ns.doc("update_app_site")
    @console_ns.doc(description="Update application site configuration")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AppSiteUpdatePayload.__name__])
    @console_ns.response(200, "Site configuration updated successfully", app_site_model)
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "App not found")
    @setup_required
    @login_required
    @edit_permission_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_site_model)
    def post(self, app_model):
        args = AppSiteUpdatePayload.model_validate(console_ns.payload or {})
        current_user, _ = current_account_with_tenant()
        site = db.session.query(Site).where(Site.app_id == app_model.id).first()
        if not site:
            raise NotFound

        for attr_name in [
            "title",
            "icon_type",
            "icon",
            "icon_background",
            "description",
            "default_language",
            "chat_color_theme",
            "chat_color_theme_inverted",
            "customize_domain",
            "copyright",
            "privacy_policy",
            "custom_disclaimer",
            "customize_token_strategy",
            "prompt_public",
            "show_workflow_steps",
            "use_icon_as_answer_icon",
        ]:
            value = getattr(args, attr_name)
            if value is not None:
                setattr(site, attr_name, value)

        site.updated_by = current_user.id
        site.updated_at = naive_utc_now()
        db.session.commit()

        return site


@console_ns.route("/apps/<uuid:app_id>/site/access-token-reset")
class AppSiteAccessTokenReset(Resource):
    @console_ns.doc("reset_app_site_access_token")
    @console_ns.doc(description="Reset access token for application site")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Access token reset successfully", app_site_model)
    @console_ns.response(403, "Insufficient permissions (admin/owner required)")
    @console_ns.response(404, "App or site not found")
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_site_model)
    def post(self, app_model):
        current_user, _ = current_account_with_tenant()
        site = db.session.query(Site).where(Site.app_id == app_model.id).first()

        if not site:
            raise NotFound

        site.code = Site.generate_code(16)
        site.updated_by = current_user.id
        site.updated_at = naive_utc_now()
        db.session.commit()

        return site
