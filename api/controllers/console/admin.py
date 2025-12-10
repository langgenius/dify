from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound, Unauthorized

P = ParamSpec("P")
R = TypeVar("R")
from configs import dify_config
from constants.languages import supported_language
from controllers.console import console_ns
from controllers.console.wraps import only_edition_cloud
from extensions.ext_database import db
from libs.token import extract_access_token
from models.model import App, InstalledApp, RecommendedApp

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class InsertExploreAppPayload(BaseModel):
    app_id: str = Field(...)
    desc: str | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    custom_disclaimer: str | None = None
    language: str = Field(...)
    category: str = Field(...)
    position: int = Field(...)

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        return supported_language(value)


console_ns.schema_model(
    InsertExploreAppPayload.__name__,
    InsertExploreAppPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


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
    @console_ns.doc("insert_explore_app")
    @console_ns.doc(description="Insert or update an app in the explore list")
    @console_ns.expect(console_ns.models[InsertExploreAppPayload.__name__])
    @console_ns.response(200, "App updated successfully")
    @console_ns.response(201, "App inserted successfully")
    @console_ns.response(404, "App not found")
    @only_edition_cloud
    @admin_required
    def post(self):
        payload = InsertExploreAppPayload.model_validate(console_ns.payload)

        app = db.session.execute(select(App).where(App.id == payload.app_id)).scalar_one_or_none()
        if not app:
            raise NotFound(f"App '{payload.app_id}' is not found")

        site = app.site
        if not site:
            desc = payload.desc or ""
            copy_right = payload.copyright or ""
            privacy_policy = payload.privacy_policy or ""
            custom_disclaimer = payload.custom_disclaimer or ""
        else:
            desc = site.description or payload.desc or ""
            copy_right = site.copyright or payload.copyright or ""
            privacy_policy = site.privacy_policy or payload.privacy_policy or ""
            custom_disclaimer = site.custom_disclaimer or payload.custom_disclaimer or ""

        with Session(db.engine) as session:
            recommended_app = session.execute(
                select(RecommendedApp).where(RecommendedApp.app_id == payload.app_id)
            ).scalar_one_or_none()

            if not recommended_app:
                recommended_app = RecommendedApp(
                    app_id=app.id,
                    description=desc,
                    copyright=copy_right,
                    privacy_policy=privacy_policy,
                    custom_disclaimer=custom_disclaimer,
                    language=payload.language,
                    category=payload.category,
                    position=payload.position,
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
                recommended_app.language = payload.language
                recommended_app.category = payload.category
                recommended_app.position = payload.position

                app.is_public = True

                db.session.commit()

                return {"result": "success"}, 200


@console_ns.route("/admin/insert-explore-apps/<uuid:app_id>")
class InsertExploreAppApi(Resource):
    @console_ns.doc("delete_explore_app")
    @console_ns.doc(description="Remove an app from the explore list")
    @console_ns.doc(params={"app_id": "Application ID to remove"})
    @console_ns.response(204, "App removed successfully")
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
