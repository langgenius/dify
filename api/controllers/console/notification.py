from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, only_edition_cloud, setup_required
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService

# Notification content is stored under three lang tags.
_FALLBACK_LANG = "en-US"


def _pick_lang_content(contents: dict, lang: str) -> dict:
    """Return the single LangContent for *lang*, falling back to English."""
    return contents.get(lang) or contents.get(_FALLBACK_LANG) or next(iter(contents.values()), {})


class DismissNotificationPayload(BaseModel):
    notification_id: str = Field(...)


@console_ns.route("/notification")
class NotificationApi(Resource):
    @console_ns.doc("get_notification")
    @console_ns.doc(
        description=(
            "Return the active in-product notification for the current user "
            "in their interface language (falls back to English if unavailable). "
            "The notification is NOT marked as seen here; call POST /notification/dismiss "
            "when the user explicitly closes the modal."
        ),
        responses={
            200: "Success — inspect should_show to decide whether to render the modal",
            401: "Unauthorized",
        },
    )
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user, _ = current_account_with_tenant()

        result = BillingService.get_account_notification(str(current_user.id))

        # Proto JSON uses camelCase field names (Kratos default marshaling).
        if not result.get("shouldShow"):
            return {"should_show": False, "notifications": []}, 200

        lang = current_user.interface_language or _FALLBACK_LANG

        notifications = []
        for notification in result.get("notifications") or []:
            contents: dict = notification.get("contents") or {}
            lang_content = _pick_lang_content(contents, lang)
            notifications.append(
                {
                    "notification_id": notification.get("notificationId"),
                    "frequency": notification.get("frequency"),
                    "lang": lang_content.get("lang", lang),
                    "title": lang_content.get("title", ""),
                    "subtitle": lang_content.get("subtitle", ""),
                    "body": lang_content.get("body", ""),
                    "title_pic_url": lang_content.get("titlePicUrl", ""),
                }
            )

        return {"should_show": bool(notifications), "notifications": notifications}, 200


@console_ns.route("/notification/dismiss")
class NotificationDismissApi(Resource):
    @console_ns.doc("dismiss_notification")
    @console_ns.doc(
        description="Mark a notification as dismissed for the current user.",
        responses={200: "Success", 401: "Unauthorized"},
    )
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def post(self):
        current_user, _ = current_account_with_tenant()
        payload = DismissNotificationPayload.model_validate(request.get_json())
        BillingService.dismiss_notification(
            notification_id=payload.notification_id,
            account_id=str(current_user.id),
        )
        return {"result": "success"}, 200
