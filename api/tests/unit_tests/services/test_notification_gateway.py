from collections.abc import Callable
from unittest.mock import patch

import httpx
import pytest

from machinery.context import RequestContext
from services.billing_client import saas, transport
from services.entities.notification_entities import NotificationItem
from services.notification_gateway import BillingNotificationGateway
from services.notification_service import NotificationService


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


@pytest.mark.parametrize("localized_content", [None, {}])
def test_get_active_falls_back_to_english_for_empty_upstream_translation(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    localized_content: dict[str, str] | None,
) -> None:
    payload = {
        "shouldShow": True,
        "notifications": [
            {
                "notificationId": "notification-1",
                "frequency": "once",
                "isGlobal": False,
                "contents": {
                    "zh-Hans": localized_content,
                    "en-US": {
                        "lang": "en-US",
                        "title": "Title",
                        "subtitle": "Subtitle",
                        "body": "Body",
                        "titlePicUrl": "title.png",
                    },
                },
            }
        ],
    }
    context = RequestContext(
        request_id="request-1", trace_id="trace-1", account_id="account-1", active_workspace_id="workspace-1"
    )
    service = NotificationService(notifications=BillingNotificationGateway())
    config_overrides(BILLING_API_URL="http://billing/v1")
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))) as client:
        monkeypatch.setattr(transport, "_http_client", client)
        result = service.get_active(context, "zh-Hans")

    assert result.should_show is True
    assert result.notifications == (
        NotificationItem("notification-1", "once", "en-US", "Title", "Subtitle", "Body", "title.png"),
    )


def test_dismiss_delegates_to_billing_service() -> None:
    with patch("services.notification_gateway.BillingService.dismiss_notification") as dismiss:
        BillingNotificationGateway().dismiss("notification-1", "account-1")

    dismiss.assert_called_once_with(notification_id="notification-1", account_id="account-1")
