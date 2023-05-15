# -*- coding:utf-8 -*-
from flask_login import login_required, current_user
from flask_restful import Resource, reqparse, fields, marshal_with
from werkzeug.exceptions import NotFound, Forbidden

from controllers.console import api
from controllers.console.app import _get_app
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from libs.helper import supported_language
from extensions.ext_database import db
from models.model import Site

app_site_fields = {
    'app_id': fields.String,
    'access_token': fields.String(attribute='code'),
    'code': fields.String,
    'title': fields.String,
    'icon': fields.String,
    'icon_background': fields.String,
    'description': fields.String,
    'default_language': fields.String,
    'customize_domain': fields.String,
    'copyright': fields.String,
    'privacy_policy': fields.String,
    'customize_token_strategy': fields.String,
    'prompt_public': fields.Boolean
}


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
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
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
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        site = db.session.query(Site).filter(Site.app_id == app_model.id).first()

        if not site:
            raise NotFound

        site.code = Site.generate_code(16)
        db.session.commit()

        return site


api.add_resource(AppSite, '/apps/<uuid:app_id>/site')
api.add_resource(AppSiteAccessTokenReset, '/apps/<uuid:app_id>/site/access-token-reset')
