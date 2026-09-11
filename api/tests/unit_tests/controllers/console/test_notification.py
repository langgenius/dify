from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from flask import Flask

from controllers.console.notification import (
    DismissNotificationPayload,
    NotificationApi,
    NotificationDismissApi,
)
from machinery.context import RequestContext
from services.entities.notification_entities import NotificationItem, NotificationResult


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


@pytest.mark.parametrize(
    ("query_string", "expected_language"),
    [({}, "en-US"), ({"language": "zh-Hans"}, "zh-Hans")],
)
def test_get_notification_validates_language_query_and_serializes_result(
    app: Flask,
    query_string: dict[str, str],
    expected_language: str,
) -> None:
    service = Mock()
    service.get_active.return_value = NotificationResult(
        should_show=True,
        notifications=(
            NotificationItem(
                notification_id="notification-1",
                frequency="once",
                lang="en-US",
                title="Title",
                subtitle="Subtitle",
                body="Body",
                title_pic_url="https://example.com/title.png",
            ),
        ),
    )
    services = SimpleNamespace(notifications=service)
    api = NotificationApi()
    method = api.get.__wrapped__
    context = _request_context()

    with (
        app.test_request_context("/notification", query_string=query_string),
        patch("controllers.console.notification.application_services", return_value=services),
    ):
        result, status = method(api, context)

    assert status == 200
    assert result == {
        "should_show": True,
        "notifications": [
            {
                "notification_id": "notification-1",
                "frequency": "once",
                "lang": "en-US",
                "title": "Title",
                "subtitle": "Subtitle",
                "body": "Body",
                "title_pic_url": "https://example.com/title.png",
            }
        ],
    }
    service.get_active.assert_called_once_with(context, expected_language)


def test_dismiss_notification_delegates_with_stable_account_context() -> None:
    service = Mock()
    services = SimpleNamespace(notifications=service)
    api = NotificationDismissApi()
    method = unwrap(api.post)
    context = _request_context()

    with patch("controllers.console.notification.application_services", return_value=services):
        result, status = method(api, DismissNotificationPayload(notification_id="notification-1"), context)

    assert status == 200
    assert result == {"result": "success"}
    service.dismiss.assert_called_once_with(context, "notification-1")
