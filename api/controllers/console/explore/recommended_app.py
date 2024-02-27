from flask_login import current_user
from flask_restful import Resource, fields, marshal_with, reqparse

from constants.languages import languages
from controllers.console import api
from controllers.console.app.error import AppNotFoundError
from extensions.ext_database import db
from models.model import App, RecommendedApp
from services.app_service import AppService

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

        recommended_apps = db.session.query(RecommendedApp).filter(
            RecommendedApp.is_listed == True,
            RecommendedApp.language == language_prefix
        ).all()

        categories = set()
        recommended_apps_result = []
        for recommended_app in recommended_apps:
            app = recommended_app.app
            if not app or not app.is_public:
                continue

            site = app.site
            if not site:
                continue

            recommended_app_result = {
                'id': recommended_app.id,
                'app': app,
                'app_id': recommended_app.app_id,
                'description': site.description,
                'copyright': site.copyright,
                'privacy_policy': site.privacy_policy,
                'category': recommended_app.category,
                'position': recommended_app.position,
                'is_listed': recommended_app.is_listed
            }
            recommended_apps_result.append(recommended_app_result)

            categories.add(recommended_app.category)  # add category to categories

        return {'recommended_apps': recommended_apps_result, 'categories': list(categories)}


class RecommendedAppApi(Resource):
    def get(self, app_id):
        app_id = str(app_id)

        # is in public recommended list
        recommended_app = db.session.query(RecommendedApp).filter(
            RecommendedApp.is_listed == True,
            RecommendedApp.app_id == app_id
        ).first()

        if not recommended_app:
            raise AppNotFoundError

        # get app detail
        app_model = db.session.query(App).filter(App.id == app_id).first()
        if not app_model or not app_model.is_public:
            raise AppNotFoundError

        app_service = AppService()
        export_str = app_service.export_app(app_model)

        return {
            'id': app_model.id,
            'name': app_model.name,
            'icon': app_model.icon,
            'icon_background': app_model.icon_background,
            'mode': app_model.mode,
            'export_data': export_str
        }


api.add_resource(RecommendedAppListApi, '/explore/apps')
api.add_resource(RecommendedAppApi, '/explore/apps/<uuid:app_id>')
