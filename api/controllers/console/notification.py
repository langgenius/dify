from flask_restx import Resource

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, only_edition_cloud, setup_required
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService

# Notification content is stored under three lang tags.
_FALLBACK_LANG = "en"

# Maps dify interface_language prefixes to notification lang tags.
# Any unrecognised prefix falls back to _FALLBACK_LANG.
_LANG_MAP: dict[str, str] = {
    "zh": "zh",
    "ja": "jp",
}


def _resolve_lang(interface_language: str | None) -> str:
    """Derive the notification lang tag from the user's interface_language.

    e.g. "zh-Hans" → "zh", "ja-JP" → "jp", "en-US" / None → "en"
    """
    if not interface_language:
        return _FALLBACK_LANG
    prefix = interface_language.split("-")[0].lower()
    return _LANG_MAP.get(prefix, _FALLBACK_LANG)


def _pick_lang_content(contents: dict, lang: str) -> dict:
    """Return the single LangContent for *lang*, falling back to English."""
    return contents.get(lang) or contents.get(_FALLBACK_LANG) or next(iter(contents.values()), {})


@console_ns.route("/notification")
class NotificationApi(Resource):
    @console_ns.doc("get_notification")
    @console_ns.doc(
        description=(
            "Return the active in-product notification for the current user "
            "in their interface language (falls back to English if unavailable). "
            "Calling this endpoint also marks the notification as seen; subsequent "
            "calls return should_show=false when frequency='once'."
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
            return {"should_show": False}, 200

        notification = result.get("notification") or {}
        contents: dict = notification.get("contents") or {}

        lang = _resolve_lang(current_user.interface_language)
        lang_content = _pick_lang_content(contents, lang)

        return {
            "should_show": True,
            "notification": {
                "notification_id": notification.get("notificationId"),
                "frequency": notification.get("frequency"),
                "lang": lang_content.get("lang", lang),
                "title": lang_content.get("title", ""),
                "body": lang_content.get("body", ""),
                "cta_label": lang_content.get("ctaLabel", ""),
                "cta_url": lang_content.get("ctaUrl", ""),
            },
        }, 200
