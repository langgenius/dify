from unittest.mock import patch

from services.entities.notification_entities import NotificationContent
from services.notification_gateway import BillingNotificationGateway


def test_get_active_maps_billing_proto_json_contract() -> None:
    payload = {
        "shouldShow": True,
        "notifications": [
            {
                "notificationId": "notification-1",
                "frequency": "once",
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

    with patch("services.notification_gateway.BillingService.get_account_notification", return_value=payload):
        result = BillingNotificationGateway().get_active("account-1")

    assert result.should_show is True
    assert result.notifications[0].notification_id == "notification-1"
    assert result.notifications[0].contents["en-US"].title_pic_url == "title.png"


def test_get_active_omits_empty_localized_content_so_service_can_fall_back() -> None:
    empty_localized_content: dict[str, str] = {}
    payload = {
        "shouldShow": True,
        "notifications": [
            {
                "notificationId": "notification-1",
                "frequency": "once",
                "contents": {
                    "zh-Hans": empty_localized_content,
                    "en-US": {"lang": "en-US", "title": "Title"},
                },
            }
        ],
    }

    with patch("services.notification_gateway.BillingService.get_account_notification", return_value=payload):
        result = BillingNotificationGateway().get_active("account-1")

    assert result.notifications[0].contents == {
        "en-US": NotificationContent("en-US", "Title", "", "", ""),
    }


def test_dismiss_delegates_to_billing_service() -> None:
    with patch("services.notification_gateway.BillingService.dismiss_notification") as dismiss:
        BillingNotificationGateway().dismiss("notification-1", "account-1")

    dismiss.assert_called_once_with(notification_id="notification-1", account_id="account-1")
