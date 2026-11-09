"""Framework-independent notification contracts."""

from collections.abc import Mapping
from typing import Literal, NamedTuple

type NotificationFrequency = Literal["once", "every_page_load"]


class NotificationContent(NamedTuple):
    lang: str
    title: str
    subtitle: str
    body: str
    title_pic_url: str


class AccountNotification(NamedTuple):
    notification_id: str
    frequency: NotificationFrequency
    contents: Mapping[str, NotificationContent]


class AccountNotificationBatch(NamedTuple):
    should_show: bool
    notifications: tuple[AccountNotification, ...]


class NotificationItem(NamedTuple):
    notification_id: str
    frequency: NotificationFrequency
    lang: str
    title: str
    subtitle: str
    body: str
    title_pic_url: str


class NotificationResult(NamedTuple):
    should_show: bool
    notifications: tuple[NotificationItem, ...]
