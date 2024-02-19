from flask_login import current_user
from flask_restful import Resource, marshal_with, reqparse
from werkzeug.exceptions import Forbidden, NotFound

from constants.languages import supported_language
from controllers.console import api
from controllers.console.app import _get_app
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from extensions.ext_database import db
from fields.app_fields import app_site_fields
from libs.login import login_required
from models.model import Site


def parse_app_site_args():
    parser = reqparse.RequestParser()
    parser.add_argument('title', type=str, required=False, location='json')
    parser.add_argument('icon', type=str, required=False, location='json')
    parser.add_argument('icon_background', type=str, required=False, location='json')
    parser.add_argument('description', type=str, required=False, location='json')
    parser.add_argument('default_language', type=supported_language, required=False, location='json')
    parser.add_argument('customize_domain', type=str, required=False, location='json')
    parser.add_argument('copyright', type=str, required=False, location='json')
    parser.add_argument('privacy_policy', type=str, required=False, location='json')
    parser.add_argument('customize_token_strategy', type=str, choices=['must', 'allow', 'not_allow'],
                        required=False,
                        location='json')
    parser.add_argument('prompt_public', type=bool, required=False, location='json')
    return parser.parse_args()


class AppSite(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_site_fields)
    def post(self, app_id):
        args = parse_app_site_args()

        app_id = str(app_id)
        app_model = _get_app(app_id)

        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        site = db.session.query(Site). \
            filter(Site.app_id == app_model.id). \
            one_or_404()

        for attr_name in [
            'title',
            'icon',
            'icon_background',
            'description',
            'default_language',
            'customize_domain',
            'copyright',
            'privacy_policy',
            'customize_token_strategy',
            'prompt_public'
        ]:
            value = args.get(attr_name)
            if value is not None:
                setattr(site, attr_name, value)

                if attr_name == 'title':
                    app_model.name = value
                elif attr_name == 'icon':
                    app_model.icon = value
                elif attr_name == 'icon_background':
                    app_model.icon_background = value

        db.session.commit()

        return site


class AppSiteAccessTokenReset(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_site_fields)
    def post(self, app_id):
        app_id = str(app_id)
        app_model = _get_app(app_id)

        # The role of the current user in the ta table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()

        site = db.session.query(Site).filter(Site.app_id == app_model.id).first()

        if not site:
            raise NotFound

        site.code = Site.generate_code(16)
        db.session.commit()

        return site


api.add_resource(AppSite, '/apps/<uuid:app_id>/site')
api.add_resource(AppSiteAccessTokenReset, '/apps/<uuid:app_id>/site/access-token-reset')
