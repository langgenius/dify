from flask_restx import Resource, fields, marshal_with, reqparse
from werkzeug.exceptions import Forbidden, NotFound

from constants.languages import supported_language
from controllers.console import api, console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.app_fields import app_site_fields
from libs.datetime_utils import naive_utc_now
from libs.login import current_account_with_tenant, login_required
from models import Site


def parse_app_site_args():
    parser = (
        reqparse.RequestParser()
        .add_argument("title", type=str, required=False, location="json")
        .add_argument("icon_type", type=str, required=False, location="json")
        .add_argument("icon", type=str, required=False, location="json")
        .add_argument("icon_background", type=str, required=False, location="json")
        .add_argument("description", type=str, required=False, location="json")
        .add_argument("default_language", type=supported_language, required=False, location="json")
        .add_argument("chat_color_theme", type=str, required=False, location="json")
        .add_argument("chat_color_theme_inverted", type=bool, required=False, location="json")
        .add_argument("customize_domain", type=str, required=False, location="json")
        .add_argument("copyright", type=str, required=False, location="json")
        .add_argument("privacy_policy", type=str, required=False, location="json")
        .add_argument("custom_disclaimer", type=str, required=False, location="json")
        .add_argument(
            "customize_token_strategy",
            type=str,
            choices=["must", "allow", "not_allow"],
            required=False,
            location="json",
        )
        .add_argument("prompt_public", type=bool, required=False, location="json")
        .add_argument("show_workflow_steps", type=bool, required=False, location="json")
        .add_argument("use_icon_as_answer_icon", type=bool, required=False, location="json")
    )
    return parser.parse_args()


@console_ns.route("/apps/<uuid:app_id>/site")
class AppSite(Resource):
    @api.doc("update_app_site")
    @api.doc(description="Update application site configuration")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "AppSiteRequest",
            {
                "title": fields.String(description="Site title"),
                "icon_type": fields.String(description="Icon type"),
                "icon": fields.String(description="Icon"),
                "icon_background": fields.String(description="Icon background color"),
                "description": fields.String(description="Site description"),
                "default_language": fields.String(description="Default language"),
                "chat_color_theme": fields.String(description="Chat color theme"),
                "chat_color_theme_inverted": fields.Boolean(description="Inverted chat color theme"),
                "customize_domain": fields.String(description="Custom domain"),
                "copyright": fields.String(description="Copyright text"),
                "privacy_policy": fields.String(description="Privacy policy"),
                "custom_disclaimer": fields.String(description="Custom disclaimer"),
                "customize_token_strategy": fields.String(
                    enum=["must", "allow", "not_allow"], description="Token strategy"
                ),
                "prompt_public": fields.Boolean(description="Make prompt public"),
                "show_workflow_steps": fields.Boolean(description="Show workflow steps"),
                "use_icon_as_answer_icon": fields.Boolean(description="Use icon as answer icon"),
            },
        )
    )
    @api.response(200, "Site configuration updated successfully", app_site_fields)
    @api.response(403, "Insufficient permissions")
    @api.response(404, "App not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_site_fields)
    def post(self, app_model):
        args = parse_app_site_args()
        current_user, _ = current_account_with_tenant()

        # The role of the current user in the ta table must be editor, admin, or owner
        if not current_user.has_edit_permission:
            raise Forbidden()

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
            value = args.get(attr_name)
            if value is not None:
                setattr(site, attr_name, value)

        site.updated_by = current_user.id
        site.updated_at = naive_utc_now()
        db.session.commit()

        return site


@console_ns.route("/apps/<uuid:app_id>/site/access-token-reset")
class AppSiteAccessTokenReset(Resource):
    @api.doc("reset_app_site_access_token")
    @api.doc(description="Reset access token for application site")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "Access token reset successfully", app_site_fields)
    @api.response(403, "Insufficient permissions (admin/owner required)")
    @api.response(404, "App or site not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_site_fields)
    def post(self, app_model):
        # The role of the current user in the ta table must be admin or owner
        current_user, _ = current_account_with_tenant()

        if not current_user.is_admin_or_owner:
            raise Forbidden()

        site = db.session.query(Site).where(Site.app_id == app_model.id).first()

        if not site:
            raise NotFound

        site.code = Site.generate_code(16)
        site.updated_by = current_user.id
        site.updated_at = naive_utc_now()
        db.session.commit()

        return site
