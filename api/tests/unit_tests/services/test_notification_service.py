from datetime import datetime
from unittest.mock import Mock

import pytest

from machinery.context import RequestContext
from services.account_ports import AccountRepository
from services.entities.account_entities import AccountSnapshot
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


def _account(language: str | None = "zh-Hans") -> AccountSnapshot:
    return AccountSnapshot(
        id="account-1",
        name="Account",
        email="account@example.com",
        avatar=None,
        is_password_set=False,
        interface_language=language,
        interface_theme="light",
        timezone="UTC",
        last_login_at=None,
        last_login_ip=None,
        status="active",
        initialized_at=None,
        created_at=datetime(2026, 1, 1),
    )


def _accounts(account: AccountSnapshot | None) -> Mock:
    accounts = Mock(spec=AccountRepository)
    accounts.get.return_value = account
    return accounts


def _notification(contents: dict[str, NotificationContent]) -> AccountNotification:
    return AccountNotification(
        notification_id="notification-1",
        frequency="once",
        contents=contents,
    )


def test_get_active_localizes_notification_for_account_language() -> None:
    chinese = NotificationContent("zh-Hans", "标题", "副标题", "正文", "zh.png")
    english = NotificationContent("en-US", "Title", "Subtitle", "Body", "en.png")
    gateway = NotificationGatewayStub(
        AccountNotificationBatch(True, (_notification({"zh-Hans": chinese, "en-US": english}),))
    )
    service = NotificationService(accounts=_accounts(_account()), notifications=gateway)

    result = service.get_active(_context())

    assert result == NotificationResult(
        should_show=True,
        notifications=(NotificationItem("notification-1", "once", "zh-Hans", "标题", "副标题", "正文", "zh.png"),),
    )
    assert gateway.get_account_ids == ["account-1"]


def test_get_active_falls_back_to_english() -> None:
    english = NotificationContent("en-US", "Title", "Subtitle", "Body", "en.png")
    gateway = NotificationGatewayStub(AccountNotificationBatch(True, (_notification({"en-US": english}),)))
    service = NotificationService(accounts=_accounts(_account("fr-FR")), notifications=gateway)

    result = service.get_active(_context())

    assert result.notifications[0].lang == "en-US"
    assert result.notifications[0].title == "Title"


def test_get_active_skips_account_query_when_gateway_says_not_to_show() -> None:
    accounts = _accounts(None)
    service = NotificationService(
        accounts=accounts,
        notifications=NotificationGatewayStub(AccountNotificationBatch(False, ())),
    )

    result = service.get_active(_context())

    assert result == NotificationResult(False, ())
    accounts.get.assert_not_called()


def test_get_active_uses_empty_content_when_notification_has_no_translations() -> None:
    gateway = NotificationGatewayStub(AccountNotificationBatch(True, (_notification({}),)))
    service = NotificationService(accounts=_accounts(_account(None)), notifications=gateway)

    result = service.get_active(_context())

    assert result.notifications == (NotificationItem("notification-1", "once", "en-US", "", "", "", ""),)


def test_get_active_rejects_unknown_admitted_account() -> None:
    gateway = NotificationGatewayStub(AccountNotificationBatch(True, (_notification({}),)))
    service = NotificationService(accounts=_accounts(None), notifications=gateway)

    with pytest.raises(RuntimeError, match="unknown account"):
        service.get_active(_context())


def test_dismiss_delegates_identifiers_to_gateway() -> None:
    gateway = NotificationGatewayStub(AccountNotificationBatch(False, ()))
    service = NotificationService(accounts=_accounts(_account()), notifications=gateway)

    service.dismiss(_context(), "notification-1")

    assert gateway.dismissals == [("notification-1", "account-1")]
