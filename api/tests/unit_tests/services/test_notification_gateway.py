from unittest.mock import patch

from services.billing_client import saas
from services.entities.notification_entities import NotificationContent
from services.notification_gateway import BillingNotificationGateway


def _content(lang: str, title: str, *, title_pic_url: str = "") -> saas.LangContent:
    return saas.LangContent(lang=lang, title=title, subtitle="", body="", title_pic_url=title_pic_url)


def _reply(*contents: tuple[str, saas.LangContent | None]) -> saas.GetAccountNotificationReply:
    notification = saas.NotificationPayload.model_construct(
        notification_id="notification-1", contents=dict(contents), frequency="once", is_global=False
    )
    return saas.GetAccountNotificationReply(should_show=True, notifications=[notification])


def test_get_active_maps_billing_proto_json_contract() -> None:
    reply = saas.GetAccountNotificationReply.model_validate(
        {
            "shouldShow": True,
            "notifications": [
                {
                    "notificationId": "notification-1",
                    "frequency": "once",
                    "isGlobal": False,
                    "contents": {
                        "en-US": {
                            "lang": "en-US",
                            "title": "Title",
                            "subtitle": "Subtitle",
                            "body": "Body",
                            "titlePicUrl": "title.png",
                        }
                    },
                }
            ],
        }
    )

    with patch("services.notification_gateway.BillingService.get_account_notification", return_value=reply):
        result = BillingNotificationGateway().get_active("account-1")

    assert result.should_show is True
    assert result.notifications[0].notification_id == "notification-1"
    assert result.notifications[0].frequency == "once"
    assert result.notifications[0].contents["en-US"].title_pic_url == "title.png"


def test_get_active_omits_missing_localized_content_so_service_can_fall_back() -> None:
    reply = _reply(("zh-Hans", None), ("en-US", _content("en-US", "Title")))

    with patch("services.notification_gateway.BillingService.get_account_notification", return_value=reply):
        result = BillingNotificationGateway().get_active("account-1")

    assert result.notifications[0].contents == {
        "en-US": NotificationContent("en-US", "Title", "", "", ""),
    }


def test_dismiss_delegates_to_billing_service() -> None:
    with patch("services.notification_gateway.BillingService.dismiss_notification") as dismiss:
        BillingNotificationGateway().dismiss("notification-1", "account-1")

    dismiss.assert_called_once_with(notification_id="notification-1", account_id="account-1")
