from flask_login import current_user
from flask_restful import Resource, fields, marshal_with
from sqlalchemy import and_

from constants.languages import languages
from controllers.console import api
from controllers.console.app.error import AppNotFoundError
from controllers.console.wraps import account_initialization_required
from extensions.ext_database import db
from libs.login import login_required
from models.model import App, InstalledApp, RecommendedApp
from services.account_service import TenantService

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
    'is_listed': fields.Boolean,
    'install_count': fields.Integer,
    'installed': fields.Boolean,
    'editable': fields.Boolean,
    'is_agent': fields.Boolean
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
        language_prefix = current_user.interface_language if current_user.interface_language else languages[0]

        recommended_apps = db.session.query(RecommendedApp).filter(
            RecommendedApp.is_listed == True,
            RecommendedApp.language == language_prefix
        ).all()

        categories = set()
        current_user.role = TenantService.get_user_role(current_user, current_user.current_tenant)
        recommended_apps_result = []
        for recommended_app in recommended_apps:
            installed = db.session.query(InstalledApp).filter(
                and_(
                    InstalledApp.app_id == recommended_app.app_id,
                    InstalledApp.tenant_id == current_user.current_tenant_id
                )
            ).first() is not None

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
                'is_listed': recommended_app.is_listed,
                'install_count': recommended_app.install_count,
                'installed': installed,
                'editable': current_user.role in ['owner', 'admin'],
                "is_agent": app.is_agent
            }
            recommended_apps_result.append(recommended_app_result)

            categories.add(recommended_app.category)  # add category to categories

        return {'recommended_apps': recommended_apps_result, 'categories': list(categories)}


class RecommendedAppApi(Resource):
    model_config_fields = {
        'opening_statement': fields.String,
        'suggested_questions': fields.Raw(attribute='suggested_questions_list'),
        'suggested_questions_after_answer': fields.Raw(attribute='suggested_questions_after_answer_dict'),
        'more_like_this': fields.Raw(attribute='more_like_this_dict'),
        'model': fields.Raw(attribute='model_dict'),
        'user_input_form': fields.Raw(attribute='user_input_form_list'),
        'pre_prompt': fields.String,
        'agent_mode': fields.Raw(attribute='agent_mode_dict'),
    }

    app_simple_detail_fields = {
        'id': fields.String,
        'name': fields.String,
        'icon': fields.String,
        'icon_background': fields.String,
        'mode': fields.String,
        'app_model_config': fields.Nested(model_config_fields),
    }

    @login_required
    @account_initialization_required
    @marshal_with(app_simple_detail_fields)
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
        app = db.session.query(App).filter(App.id == app_id).first()
        if not app or not app.is_public:
            raise AppNotFoundError

        return app


api.add_resource(RecommendedAppListApi, '/explore/apps')
api.add_resource(RecommendedAppApi, '/explore/apps/<uuid:app_id>')
