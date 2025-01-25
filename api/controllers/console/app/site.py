from datetime import UTC, datetime

from flask_login import current_user  # type: ignore
from flask_restful import Resource, marshal_with, reqparse  # type: ignore
from werkzeug.exceptions import Forbidden, NotFound

from constants.languages import supported_language
from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.app_fields import app_site_fields
from libs.login import login_required
from models import Site


def parse_app_site_args():
    parser = reqparse.RequestParser()
    parser.add_argument("title", type=str, required=False, location="json")
    parser.add_argument("icon_type", type=str, required=False, location="json")
    parser.add_argument("icon", type=str, required=False, location="json")
    parser.add_argument("icon_background", type=str, required=False, location="json")
    parser.add_argument("description", type=str, required=False, location="json")
    parser.add_argument("default_language", type=supported_language, required=False, location="json")
    parser.add_argument("chat_color_theme", type=str, required=False, location="json")
    parser.add_argument("chat_color_theme_inverted", type=bool, required=False, location="json")
    parser.add_argument("customize_domain", type=str, required=False, location="json")
    parser.add_argument("copyright", type=str, required=False, location="json")
    parser.add_argument("privacy_policy", type=str, required=False, location="json")
    parser.add_argument("custom_disclaimer", type=str, required=False, location="json")
    parser.add_argument(
        "customize_token_strategy", type=str, choices=["must", "allow", "not_allow"], required=False, location="json"
    )
    parser.add_argument("prompt_public", type=bool, required=False, location="json")
    parser.add_argument("show_workflow_steps", type=bool, required=False, location="json")
    parser.add_argument("use_icon_as_answer_icon", type=bool, required=False, location="json")
    return parser.parse_args()


class AppSite(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_site_fields)
    def post(self, app_model):
        args = parse_app_site_args()

        # The role of the current user in the ta table must be editor, admin, or owner
        if not current_user.is_editor:
            raise Forbidden()

        site = Site.query.filter(Site.app_id == app_model.id).one_or_404()

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
        site.updated_at = datetime.now(UTC).replace(tzinfo=None)
        db.session.commit()

        return site


class AppSiteAccessTokenReset(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    @marshal_with(app_site_fields)
    def post(self, app_model):
        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        site = db.session.query(Site).filter(Site.app_id == app_model.id).first()

        if not site:
            raise NotFound

        site.code = Site.generate_code(16)
        site.updated_by = current_user.id
        site.updated_at = datetime.now(UTC).replace(tzinfo=None)
        db.session.commit()

        return site


api.add_resource(AppSite, "/apps/<uuid:app_id>/site")
api.add_resource(AppSiteAccessTokenReset, "/apps/<uuid:app_id>/site/access-token-reset")
