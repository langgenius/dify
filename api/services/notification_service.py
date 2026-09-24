"""Application service for Console account notifications."""

from typing import Protocol

from constants.languages import languages
from machinery.context import RequestContext
from services.entities.notification_entities import (
    AccountNotification,
    AccountNotificationBatch,
    NotificationContent,
    NotificationItem,
    NotificationResult,
)

_FALLBACK_LANGUAGE = "en-US"


class NotificationGateway(Protocol):
    def get_active(self, account_id: str) -> AccountNotificationBatch: ...

    def dismiss(self, notification_id: str, account_id: str) -> None: ...


class NotificationService:
    def __init__(self, *, notifications: NotificationGateway) -> None:
        self._notifications = notifications

    def get_active(self, context: RequestContext, language: str) -> NotificationResult:
        batch = self._notifications.get_active(context.account_id)
        if not batch.should_show:
            return NotificationResult(should_show=False, notifications=())

        language = language if language in languages else _FALLBACK_LANGUAGE
        notifications = tuple(self._localize(notification, language) for notification in batch.notifications)
        return NotificationResult(should_show=bool(notifications), notifications=notifications)

    def dismiss(self, context: RequestContext, notification_id: str) -> None:
        self._notifications.dismiss(notification_id, context.account_id)

    @staticmethod
    def _localize(notification: AccountNotification, language: str) -> NotificationItem:
        content = (
            notification.contents.get(language)
            or notification.contents.get(_FALLBACK_LANGUAGE)
            or next(iter(notification.contents.values()), NotificationContent(language, "", "", "", ""))
        )
        return NotificationItem(
            notification_id=notification.notification_id,
            frequency=notification.frequency,
            lang=content.lang or language,
            title=content.title,
            subtitle=content.subtitle,
            body=content.body,
            title_pic_url=content.title_pic_url,
        )
