from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from flask import request
from flask_restx import Resource, fields, reqparse
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound, Unauthorized

P = ParamSpec("P")
R = TypeVar("R")
from configs import dify_config
from constants.languages import supported_language
from controllers.console import api, console_ns
from controllers.console.wraps import only_edition_cloud
from extensions.ext_database import db
from libs.token import extract_access_token
from models.model import App, InstalledApp, RecommendedApp


def admin_required(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        if not dify_config.ADMIN_API_KEY:
            raise Unauthorized("API key is invalid.")

        auth_token = extract_access_token(request)
        if not auth_token:
            raise Unauthorized("Authorization header is missing.")
        if auth_token != dify_config.ADMIN_API_KEY:
            raise Unauthorized("API key is invalid.")

        return view(*args, **kwargs)

    return decorated


@console_ns.route("/admin/insert-explore-apps")
class InsertExploreAppListApi(Resource):
    @api.doc("insert_explore_app")
    @api.doc(description="Insert or update an app in the explore list")
    @api.expect(
        api.model(
            "InsertExploreAppRequest",
            {
                "app_id": fields.String(required=True, description="Application ID"),
                "desc": fields.String(description="App description"),
                "copyright": fields.String(description="Copyright information"),
                "privacy_policy": fields.String(description="Privacy policy"),
                "custom_disclaimer": fields.String(description="Custom disclaimer"),
                "language": fields.String(required=True, description="Language code"),
                "category": fields.String(required=True, description="App category"),
                "position": fields.Integer(required=True, description="Display position"),
            },
        )
    )
    @api.response(200, "App updated successfully")
    @api.response(201, "App inserted successfully")
    @api.response(404, "App not found")
    @only_edition_cloud
    @admin_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("app_id", type=str, required=True, nullable=False, location="json")
            .add_argument("desc", type=str, location="json")
            .add_argument("copyright", type=str, location="json")
            .add_argument("privacy_policy", type=str, location="json")
            .add_argument("custom_disclaimer", type=str, location="json")
            .add_argument("language", type=supported_language, required=True, nullable=False, location="json")
            .add_argument("category", type=str, required=True, nullable=False, location="json")
            .add_argument("position", type=int, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()

        app = db.session.execute(select(App).where(App.id == args["app_id"])).scalar_one_or_none()
        if not app:
            raise NotFound(f"App '{args['app_id']}' is not found")

        site = app.site
        if not site:
            desc = args["desc"] or ""
            copy_right = args["copyright"] or ""
            privacy_policy = args["privacy_policy"] or ""
            custom_disclaimer = args["custom_disclaimer"] or ""
        else:
            desc = site.description or args["desc"] or ""
            copy_right = site.copyright or args["copyright"] or ""
            privacy_policy = site.privacy_policy or args["privacy_policy"] or ""
            custom_disclaimer = site.custom_disclaimer or args["custom_disclaimer"] or ""

        with Session(db.engine) as session:
            recommended_app = session.execute(
                select(RecommendedApp).where(RecommendedApp.app_id == args["app_id"])
            ).scalar_one_or_none()

            if not recommended_app:
                recommended_app = RecommendedApp(
                    app_id=app.id,
                    description=desc,
                    copyright=copy_right,
                    privacy_policy=privacy_policy,
                    custom_disclaimer=custom_disclaimer,
                    language=args["language"],
                    category=args["category"],
                    position=args["position"],
                )

                db.session.add(recommended_app)

                app.is_public = True
                db.session.commit()

                return {"result": "success"}, 201
            else:
                recommended_app.description = desc
                recommended_app.copyright = copy_right
                recommended_app.privacy_policy = privacy_policy
                recommended_app.custom_disclaimer = custom_disclaimer
                recommended_app.language = args["language"]
                recommended_app.category = args["category"]
                recommended_app.position = args["position"]

                app.is_public = True

                db.session.commit()

                return {"result": "success"}, 200


@console_ns.route("/admin/insert-explore-apps/<uuid:app_id>")
class InsertExploreAppApi(Resource):
    @api.doc("delete_explore_app")
    @api.doc(description="Remove an app from the explore list")
    @api.doc(params={"app_id": "Application ID to remove"})
    @api.response(204, "App removed successfully")
    @only_edition_cloud
    @admin_required
    def delete(self, app_id):
        with Session(db.engine) as session:
            recommended_app = session.execute(
                select(RecommendedApp).where(RecommendedApp.app_id == str(app_id))
            ).scalar_one_or_none()

        if not recommended_app:
            return {"result": "success"}, 204

        with Session(db.engine) as session:
            app = session.execute(select(App).where(App.id == recommended_app.app_id)).scalar_one_or_none()

        if app:
            app.is_public = False

        with Session(db.engine) as session:
            installed_apps = (
                session.execute(
                    select(InstalledApp).where(
                        InstalledApp.app_id == recommended_app.app_id,
                        InstalledApp.tenant_id != InstalledApp.app_owner_tenant_id,
                    )
                )
                .scalars()
                .all()
            )

            for installed_app in installed_apps:
                session.delete(installed_app)

        db.session.delete(recommended_app)
        db.session.commit()

        return {"result": "success"}, 204
