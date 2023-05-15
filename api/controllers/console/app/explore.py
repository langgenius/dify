# -*- coding:utf-8 -*-
from datetime import datetime

from flask_login import login_required, current_user
from flask_restful import Resource, reqparse, fields, marshal_with, abort, inputs
from sqlalchemy import and_

from controllers.console import api
from extensions.ext_database import db
from models.model import Tenant, App, InstalledApp, RecommendedApp
from services.account_service import TenantService

app_fields = {
    'id': fields.String,
    'name': fields.String,
    'mode': fields.String,
    'icon': fields.String,
    'icon_background': fields.String
}

installed_app_fields = {
    'id': fields.String,
    'app': fields.Nested(app_fields, attribute='app'),
    'app_owner_tenant_id': fields.String,
    'is_pinned': fields.Boolean,
    'last_used_at': fields.DateTime,
    'editable': fields.Boolean
}

installed_app_list_fields = {
    'installed_apps': fields.List(fields.Nested(installed_app_fields))
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
    'editable': fields.Boolean
}

recommended_app_list_fields = {
    'recommended_apps': fields.List(fields.Nested(recommended_app_fields)),
    'categories': fields.List(fields.String)
}


class InstalledAppsListResource(Resource):
    @login_required
    @marshal_with(installed_app_list_fields)
    def get(self):
        current_tenant_id = Tenant.query.first().id
        installed_apps = db.session.query(InstalledApp).filter(
            InstalledApp.tenant_id == current_tenant_id
        ).all()

        current_user.role = TenantService.get_user_role(current_user, current_user.current_tenant)
        installed_apps = [
            {
                **installed_app,
                "editable": current_user.role in ["owner", "admin"],
            }
            for installed_app in installed_apps
        ]
        installed_apps.sort(key=lambda app: (-app.is_pinned, app.last_used_at))

        return {'installed_apps': installed_apps}

    @login_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('app_id', type=str, required=True, help='Invalid app_id')
        args = parser.parse_args()

        current_tenant_id = Tenant.query.first().id
        app = App.query.get(args['app_id'])
        if app is None:
            abort(404, message='App not found')
        recommended_app = RecommendedApp.query.filter(RecommendedApp.app_id == args['app_id']).first()
        if recommended_app is None:
            abort(404, message='App not found')
        if not app.is_public:
            abort(403, message="You can't install a non-public app")

        installed_app = InstalledApp.query.filter(and_(
            InstalledApp.app_id == args['app_id'],
            InstalledApp.tenant_id == current_tenant_id
        )).first()

        if installed_app is None:
            # todo: position
            recommended_app.install_count += 1

            new_installed_app = InstalledApp(
                app_id=args['app_id'],
                tenant_id=current_tenant_id,
                is_pinned=False,
                last_used_at=datetime.utcnow()
            )
            db.session.add(new_installed_app)
            db.session.commit()

        return {'message': 'App installed successfully'}


class InstalledAppResource(Resource):

    @login_required
    def delete(self, installed_app_id):

        installed_app = InstalledApp.query.filter(and_(
            InstalledApp.id == str(installed_app_id),
            InstalledApp.tenant_id == current_user.current_tenant_id
        )).first()

        if installed_app is None:
            abort(404, message='App not found')

        if installed_app.app_owner_tenant_id == current_user.current_tenant_id:
            abort(400, message="You can't uninstall an app owned by the current tenant")

        db.session.delete(installed_app)
        db.session.commit()

        return {'result': 'success', 'message': 'App uninstalled successfully'}

    @login_required
    def patch(self, installed_app_id):
        parser = reqparse.RequestParser()
        parser.add_argument('is_pinned', type=inputs.boolean)
        args = parser.parse_args()

        current_tenant_id = Tenant.query.first().id
        installed_app = InstalledApp.query.filter(and_(
            InstalledApp.id == str(installed_app_id),
            InstalledApp.tenant_id == current_tenant_id
        )).first()

        if installed_app is None:
            abort(404, message='Installed app not found')

        commit_args = False
        if 'is_pinned' in args:
            installed_app.is_pinned = args['is_pinned']
            commit_args = True

        if commit_args:
            db.session.commit()

        return {'result': 'success', 'message': 'App info updated successfully'}


class RecommendedAppsResource(Resource):
    @login_required
    @marshal_with(recommended_app_list_fields)
    def get(self):
        recommended_apps = db.session.query(RecommendedApp).filter(
            RecommendedApp.is_listed == True
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

            language_prefix = current_user.interface_language.split('-')[0]
            desc = None
            if recommended_app.description:
                if language_prefix in recommended_app.description:
                    desc = recommended_app.description[language_prefix]
                elif 'en' in recommended_app.description:
                    desc = recommended_app.description['en']

            recommended_app_result = {
                'id': recommended_app.id,
                'app': recommended_app.app,
                'app_id': recommended_app.app_id,
                'description': desc,
                'copyright': recommended_app.copyright,
                'privacy_policy': recommended_app.privacy_policy,
                'category': recommended_app.category,
                'position': recommended_app.position,
                'is_listed': recommended_app.is_listed,
                'install_count': recommended_app.install_count,
                'installed': installed,
                'editable': current_user.role in ['owner', 'admin'],
            }
            recommended_apps_result.append(recommended_app_result)

            categories.add(recommended_app.category)  # add category to categories

        return {'recommended_apps': recommended_apps_result, 'categories': list(categories)}


api.add_resource(InstalledAppsListResource, '/installed-apps')
api.add_resource(InstalledAppResource, '/installed-apps/<uuid:installed_app_id>')
api.add_resource(RecommendedAppsResource, '/explore/apps')
