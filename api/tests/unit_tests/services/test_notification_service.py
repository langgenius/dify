from machinery.context import RequestContext
from services.entities.notification_entities import (
    AccountNotification,
    AccountNotificationBatch,
    NotificationContent,
    NotificationItem,
    NotificationResult,
)
from services.notification_service import NotificationService


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


class NotificationGatewayStub:
    def __init__(self, batch: AccountNotificationBatch) -> None:
        self.batch = batch
        self.get_account_ids: list[str] = []
        self.dismissals: list[tuple[str, str]] = []

    def get_active(self, account_id: str) -> AccountNotificationBatch:
        self.get_account_ids.append(account_id)
        return self.batch

    def dismiss(self, notification_id: str, account_id: str) -> None:
        self.dismissals.append((notification_id, account_id))


def _notification(contents: dict[str, NotificationContent]) -> AccountNotification:
    return AccountNotification(
        notification_id="notification-1",
        frequency="once",
        contents=contents,
    )


def test_get_active_localizes_notification_for_requested_language() -> None:
    chinese = NotificationContent("zh-Hans", "标题", "副标题", "正文", "zh.png")
    english = NotificationContent("en-US", "Title", "Subtitle", "Body", "en.png")
    gateway = NotificationGatewayStub(
        AccountNotificationBatch(True, (_notification({"zh-Hans": chinese, "en-US": english}),))
    )
    service = NotificationService(notifications=gateway)

    result = service.get_active(_context(), "zh-Hans")

    assert result.notifications == (
        NotificationItem("notification-1", "once", "zh-Hans", "标题", "副标题", "正文", "zh.png"),
    )
    assert gateway.get_account_ids == ["account-1"]


def test_get_active_falls_back_to_english() -> None:
    english = NotificationContent("en-US", "Title", "Subtitle", "Body", "en.png")
    gateway = NotificationGatewayStub(AccountNotificationBatch(True, (_notification({"en-US": english}),)))
    service = NotificationService(notifications=gateway)

    result = service.get_active(_context(), "fr-FR")

    assert result.notifications[0].lang == "en-US"
    assert result.notifications[0].title == "Title"


def test_get_active_falls_back_to_english_for_unsupported_language() -> None:
    unsupported = NotificationContent("xx-YY", "Unknown", "Unknown", "Unknown", "unknown.png")
    english = NotificationContent("en-US", "Title", "Subtitle", "Body", "en.png")
    gateway = NotificationGatewayStub(
        AccountNotificationBatch(True, (_notification({"xx-YY": unsupported, "en-US": english}),))
    )
    service = NotificationService(notifications=gateway)

    result = service.get_active(_context(), "xx-YY")

    assert result.notifications[0].lang == "en-US"
    assert result.notifications[0].title == "Title"


def test_get_active_returns_empty_when_gateway_says_not_to_show() -> None:
    service = NotificationService(notifications=NotificationGatewayStub(AccountNotificationBatch(False, ())))

    result = service.get_active(_context(), "zh-Hans")

    assert result == NotificationResult(False, ())


def test_get_active_uses_empty_content_when_notification_has_no_translations() -> None:
    gateway = NotificationGatewayStub(AccountNotificationBatch(True, (_notification({}),)))
    service = NotificationService(notifications=gateway)

    result = service.get_active(_context(), "")

    assert result.notifications == (NotificationItem("notification-1", "once", "en-US", "", "", "", ""),)


def test_dismiss_delegates_identifiers_to_gateway() -> None:
    gateway = NotificationGatewayStub(AccountNotificationBatch(False, ()))
    service = NotificationService(notifications=gateway)

    service.dismiss(_context(), "notification-1")

    assert gateway.dismissals == [("notification-1", "account-1")]
