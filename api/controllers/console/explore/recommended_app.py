from flask_login import current_user
from flask_restful import Resource, fields, marshal_with, reqparse

from constants.languages import languages
from controllers.console import api
from controllers.console.wraps import account_initialization_required
from libs.login import login_required
from services.recommended_app_service import RecommendedAppService

app_fields = {
    'id': fields.String,
    'name': fields.String,
    'mode': fields.String,
    'icon': fields.String,
    'icon_background': fields.String
}

recommended_app_fields = {
    'app': fields.Nested(app_fields, attribute='app'),
    'app_id': fields.String,
    'description': fields.String(attribute='description'),
    'copyright': fields.String,
    'privacy_policy': fields.String,
    'category': fields.String,
    'position': fields.Integer,
    'is_listed': fields.Boolean
}

recommended_app_list_fields = {
    'recommended_apps': fields.List(fields.Nested(recommended_app_fields)),
    'categories': fields.List(fields.String)
}


class RecommendedAppListApi(Resource):
    @login_required
    @account_initialization_required
    @marshal_with(recommended_app_list_fields)
    def get(self):
        # language args
        parser = reqparse.RequestParser()
        parser.add_argument('language', type=str, location='args')
        args = parser.parse_args()

        if args.get('language') and args.get('language') in languages:
            language_prefix = args.get('language')
        elif current_user and current_user.interface_language:
            language_prefix = current_user.interface_language
        else:
            language_prefix = languages[0]

        return RecommendedAppService.get_recommended_apps_and_categories(language_prefix)


class RecommendedAppApi(Resource):
    @login_required
    @account_initialization_required
    def get(self, app_id):
        app_id = str(app_id)
        return RecommendedAppService.get_recommend_app_detail(app_id)


api.add_resource(RecommendedAppListApi, '/explore/apps')
api.add_resource(RecommendedAppApi, '/explore/apps/<uuid:app_id>')
