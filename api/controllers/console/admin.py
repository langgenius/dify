import csv
import io
from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from werkzeug.exceptions import BadRequest, NotFound, Unauthorized

from configs import dify_config
from constants.languages import supported_language
from controllers.console import console_ns
from controllers.console.wraps import only_edition_cloud
from core.db.session_factory import session_factory
from extensions.ext_database import db
from libs.token import extract_access_token
from models.model import App, ExporleBanner, InstalledApp, RecommendedApp, TrialApp
from services.billing_service import BillingService

P = ParamSpec("P")
R = TypeVar("R")

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
    can_trial: bool = Field(default=False)
    trial_limit: int = Field(default=0)

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        return supported_language(value)


class InsertExploreBannerPayload(BaseModel):
    category: str = Field(...)
    title: str = Field(...)
    description: str = Field(...)
    img_src: str = Field(..., alias="img-src")
    language: str = Field(default="en-US")
    link: str = Field(...)
    sort: int = Field(...)

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str) -> str:
        return supported_language(value)

    model_config = {"populate_by_name": True}


console_ns.schema_model(
    InsertExploreAppPayload.__name__,
    InsertExploreAppPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)

console_ns.schema_model(
    InsertExploreBannerPayload.__name__,
    InsertExploreBannerPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
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

        with session_factory.create_session() as session:
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
                if payload.can_trial:
                    trial_app = db.session.execute(
                        select(TrialApp).where(TrialApp.app_id == payload.app_id)
                    ).scalar_one_or_none()
                    if not trial_app:
                        db.session.add(
                            TrialApp(
                                app_id=payload.app_id,
                                tenant_id=app.tenant_id,
                                trial_limit=payload.trial_limit,
                            )
                        )
                    else:
                        trial_app.trial_limit = payload.trial_limit

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

                if payload.can_trial:
                    trial_app = db.session.execute(
                        select(TrialApp).where(TrialApp.app_id == payload.app_id)
                    ).scalar_one_or_none()
                    if not trial_app:
                        db.session.add(
                            TrialApp(
                                app_id=payload.app_id,
                                tenant_id=app.tenant_id,
                                trial_limit=payload.trial_limit,
                            )
                        )
                    else:
                        trial_app.trial_limit = payload.trial_limit
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
        with session_factory.create_session() as session:
            recommended_app = session.execute(
                select(RecommendedApp).where(RecommendedApp.app_id == str(app_id))
            ).scalar_one_or_none()

        if not recommended_app:
            return {"result": "success"}, 204

        with session_factory.create_session() as session:
            app = session.execute(select(App).where(App.id == recommended_app.app_id)).scalar_one_or_none()

        if app:
            app.is_public = False

        with session_factory.create_session() as session:
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

            trial_app = session.execute(
                select(TrialApp).where(TrialApp.app_id == recommended_app.app_id)
            ).scalar_one_or_none()
            if trial_app:
                session.delete(trial_app)

        db.session.delete(recommended_app)
        db.session.commit()

        return {"result": "success"}, 204


@console_ns.route("/admin/insert-explore-banner")
class InsertExploreBannerApi(Resource):
    @console_ns.doc("insert_explore_banner")
    @console_ns.doc(description="Insert an explore banner")
    @console_ns.expect(console_ns.models[InsertExploreBannerPayload.__name__])
    @console_ns.response(201, "Banner inserted successfully")
    @only_edition_cloud
    @admin_required
    def post(self):
        payload = InsertExploreBannerPayload.model_validate(console_ns.payload)

        banner = ExporleBanner(
            content={
                "category": payload.category,
                "title": payload.title,
                "description": payload.description,
                "img-src": payload.img_src,
            },
            link=payload.link,
            sort=payload.sort,
            language=payload.language,
        )
        db.session.add(banner)
        db.session.commit()

        return {"result": "success"}, 201


@console_ns.route("/admin/delete-explore-banner/<uuid:banner_id>")
class DeleteExploreBannerApi(Resource):
    @console_ns.doc("delete_explore_banner")
    @console_ns.doc(description="Delete an explore banner")
    @console_ns.doc(params={"banner_id": "Banner ID to delete"})
    @console_ns.response(204, "Banner deleted successfully")
    @only_edition_cloud
    @admin_required
    def delete(self, banner_id):
        banner = db.session.execute(select(ExporleBanner).where(ExporleBanner.id == banner_id)).scalar_one_or_none()
        if not banner:
            raise NotFound(f"Banner '{banner_id}' is not found")

        db.session.delete(banner)
        db.session.commit()

        return {"result": "success"}, 204


class SaveNotificationContentPayload(BaseModel):
    content: str = Field(...)


class SaveNotificationUserPayload(BaseModel):
    user_email: list[str] = Field(...)


console_ns.schema_model(
    SaveNotificationContentPayload.__name__,
    SaveNotificationContentPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)

console_ns.schema_model(
    SaveNotificationUserPayload.__name__,
    SaveNotificationUserPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)


@console_ns.route("/admin/save_notification_content")
class SaveNotificationContentApi(Resource):
    @console_ns.doc("save_notification_content")
    @console_ns.doc(description="Save a notification content")
    @console_ns.expect(console_ns.models[SaveNotificationContentPayload.__name__])
    @console_ns.response(200, "Notification content saved successfully")
    @only_edition_cloud
    @admin_required
    def post(self):
        payload = SaveNotificationContentPayload.model_validate(console_ns.payload)
        BillingService.save_notification_content(payload.content)
        return {"result": "success"}, 200


@console_ns.route("/admin/save_notification_user")
class SaveNotificationUserApi(Resource):
    @console_ns.doc("save_notification_user")
    @console_ns.doc(
        description="Save notification users via JSON body or file upload. "
        'JSON: {"user_email": ["a@example.com", ...]}. '
        "File: multipart/form-data with a 'file' field (CSV or TXT, one email per line)."
    )
    @console_ns.response(200, "Notification users saved successfully")
    @only_edition_cloud
    @admin_required
    def post(self):
        # Determine input mode: file upload or JSON body
        if "file" in request.files:
            emails = self._parse_emails_from_file()
        else:
            payload = SaveNotificationUserPayload.model_validate(console_ns.payload)
            emails = payload.user_email

        if not emails:
            raise BadRequest("No valid email addresses provided.")

        # Use batch API for bulk insert (chunks of 1000 per request to billing service)
        result = BillingService.save_notification_users_batch(emails)

        return {
            "result": "success",
            "total": len(emails),
            "succeeded": result["succeeded"],
            "failed_chunks": result["failed_chunks"],
        }, 200

    @staticmethod
    def _parse_emails_from_file() -> list[str]:
        """Parse email addresses from an uploaded CSV or TXT file."""
        file = request.files["file"]

        if not file.filename:
            raise BadRequest("Uploaded file has no filename.")

        filename_lower = file.filename.lower()
        if not filename_lower.endswith((".csv", ".txt")):
            raise BadRequest("Invalid file type. Only CSV (.csv) and TXT (.txt) files are allowed.")

        # Read file content
        try:
            content = file.read().decode("utf-8")
        except UnicodeDecodeError:
            try:
                file.seek(0)
                content = file.read().decode("gbk")
            except UnicodeDecodeError:
                raise BadRequest("Unable to decode the file. Please use UTF-8 or GBK encoding.")

        emails: list[str] = []
        if filename_lower.endswith(".csv"):
            reader = csv.reader(io.StringIO(content))
            for row in reader:
                for cell in row:
                    cell = cell.strip()
                    emails.append(cell)
        else:
            # TXT file: one email per line
            for line in content.splitlines():
                line = line.strip()
                emails.append(line)

        # Deduplicate while preserving order
        seen: set[str] = set()
        unique_emails: list[str] = []
        for email in emails:
            email_lower = email.lower()
            if email_lower not in seen:
                seen.add(email_lower)
                unique_emails.append(email)

        return unique_emails
