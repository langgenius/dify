import httpx

from services.billing_client import saas
from tests.unit_tests.services.billing_client.conftest import RespondWith


def test_path_params_are_percent_encoded_and_body_uses_wire_names(respond_with: RespondWith) -> None:
    requests = respond_with(httpx.Response(200, json={"success": True}))

    reply = saas.notification_dismiss_notification(
        notification_id="a/b c", body=saas.DismissNotificationReq(notification_id="a/b c", account_id="acc")
    )

    assert reply.success is True
    assert str(requests[0].url) == "http://billing/v1/notifications/a%2Fb%20c/dismiss"
    assert requests[0].url.raw_path == b"/v1/notifications/a%2Fb%20c/dismiss"
    assert b'"accountId"' in requests[0].content
