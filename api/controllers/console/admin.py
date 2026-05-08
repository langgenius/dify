import csv
import io
from collections.abc import Callable
from functools import wraps
from typing import cast

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from werkzeug.exceptions import BadRequest, NotFound, Unauthorized

from configs import dify_config
from constants.languages import supported_language
from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import only_edition_cloud
from core.db.session_factory import session_factory
from extensions.ext_database import db
from libs.token import extract_access_token
from models.model import App, ExporleBanner, InstalledApp, RecommendedApp, TrialApp
from services.billing_service import BillingService, LangContentDict

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


def admin_required[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
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


class LangContentPayload(BaseModel):
    lang: str = Field(..., description="Language tag: 'zh' | 'en' | 'jp'")
    title: str = Field(...)
    subtitle: str | None = Field(default=None)
    body: str = Field(...)
    title_pic_url: str | None = Field(default=None)


class UpsertNotificationPayload(BaseModel):
    notification_id: str | None = Field(default=None, description="Omit to create; supply UUID to update")
    contents: list[LangContentPayload] = Field(..., min_length=1)
    start_time: str | None = Field(default=None, description="RFC3339, e.g. 2026-03-01T00:00:00Z")
    end_time: str | None = Field(default=None, description="RFC3339, e.g. 2026-03-20T23:59:59Z")
    frequency: str = Field(default="once", description="'once' | 'every_page_load'")
    status: str = Field(default="active", description="'active' | 'inactive'")


class BatchAddNotificationAccountsPayload(BaseModel):
    notification_id: str = Field(...)
    user_email: list[str] = Field(..., description="List of account email addresses")


register_schema_models(console_ns, UpsertNotificationPayload, BatchAddNotificationAccountsPayload)


@console_ns.route("/admin/upsert_notification")
class UpsertNotificationApi(Resource):
    @console_ns.doc("upsert_notification")
    @console_ns.doc(
        description=(
            "Create or update an in-product notification. "
            "Supply notification_id to update an existing one; omit it to create a new one. "
            "Pass at least one language variant in contents (zh / en / jp)."
        )
    )
    @console_ns.expect(console_ns.models[UpsertNotificationPayload.__name__])
    @console_ns.response(200, "Notification upserted successfully")
    @only_edition_cloud
    @admin_required
    def post(self):
        payload = UpsertNotificationPayload.model_validate(console_ns.payload)
        result = BillingService.upsert_notification(
            contents=[cast(LangContentDict, c.model_dump()) for c in payload.contents],
            frequency=payload.frequency,
            status=payload.status,
            notification_id=payload.notification_id,
            start_time=payload.start_time,
            end_time=payload.end_time,
        )
        return {"result": "success", "notification_id": result.get("notificationId")}, 200


@console_ns.route("/admin/batch_add_notification_accounts")
class BatchAddNotificationAccountsApi(Resource):
    @console_ns.doc("batch_add_notification_accounts")
    @console_ns.doc(
        description=(
            "Register target accounts for a notification by email address. "
            'JSON body: {"notification_id": "...", "user_email": ["a@example.com", ...]}. '
            "File upload: multipart/form-data with a 'file' field (CSV or TXT, one email per line) "
            "plus a 'notification_id' field. "
            "Emails that do not match any account are silently skipped."
        )
    )
    @console_ns.response(200, "Accounts added successfully")
    @only_edition_cloud
    @admin_required
    def post(self):
        from models.account import Account

        if "file" in request.files:
            notification_id = request.form.get("notification_id", "").strip()
            if not notification_id:
                raise BadRequest("notification_id is required.")
            emails = self._parse_emails_from_file()
        else:
            payload = BatchAddNotificationAccountsPayload.model_validate(console_ns.payload)
            notification_id = payload.notification_id
            emails = payload.user_email

        if not emails:
            raise BadRequest("No valid email addresses provided.")

        # Resolve emails → account IDs in chunks to avoid large IN-clause
        account_ids: list[str] = []
        chunk_size = 500
        for i in range(0, len(emails), chunk_size):
            chunk = emails[i : i + chunk_size]
            rows = db.session.execute(select(Account.id, Account.email).where(Account.email.in_(chunk))).all()
            account_ids.extend(str(row.id) for row in rows)

        if not account_ids:
            raise BadRequest("None of the provided emails matched an existing account.")

        # Send to dify-saas in batches of 1000
        total_count = 0
        batch_size = 1000
        for i in range(0, len(account_ids), batch_size):
            batch = account_ids[i : i + batch_size]
            result = BillingService.batch_add_notification_accounts(
                notification_id=notification_id,
                account_ids=batch,
            )
            total_count += result.get("count", 0)

        return {
            "result": "success",
            "emails_provided": len(emails),
            "accounts_matched": len(account_ids),
            "count": total_count,
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
                    if cell:
                        emails.append(cell)
        else:
            for line in content.splitlines():
                line = line.strip()
                if line:
                    emails.append(line)

        # Deduplicate while preserving order
        seen: set[str] = set()
        unique_emails: list[str] = []
        for email in emails:
            if email.lower() not in seen:
                seen.add(email.lower())
                unique_emails.append(email)

        return unique_emails
