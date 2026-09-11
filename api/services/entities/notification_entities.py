"""Framework-independent notification contracts."""

from collections.abc import Mapping
from typing import NamedTuple


class NotificationContent(NamedTuple):
    lang: str
    title: str
    subtitle: str
    body: str
    title_pic_url: str


class AccountNotification(NamedTuple):
    notification_id: str | None
    frequency: str | None
    contents: Mapping[str, NotificationContent]


class AccountNotificationBatch(NamedTuple):
    should_show: bool
    notifications: tuple[AccountNotification, ...]


class NotificationItem(NamedTuple):
    notification_id: str | None
    frequency: str | None
    lang: str
    title: str
    subtitle: str
    body: str
    title_pic_url: str


class NotificationResult(NamedTuple):
    should_show: bool
    notifications: tuple[NotificationItem, ...]
