"""Billing-backed notification gateway."""

from collections.abc import Mapping
from typing import Any, override

from services.billing_service import BillingService
from services.entities.notification_entities import (
    AccountNotification,
    AccountNotificationBatch,
    NotificationContent,
)
from services.notification_service import NotificationGateway


class BillingNotificationGateway(NotificationGateway):
    @override
    def get_active(self, account_id: str) -> AccountNotificationBatch:
        payload = BillingService.get_account_notification(account_id)
        notifications = tuple(self._map_notification(item) for item in payload.get("notifications") or ())
        return AccountNotificationBatch(
            should_show=bool(payload.get("shouldShow")),
            notifications=notifications,
        )

    @override
    def dismiss(self, notification_id: str, account_id: str) -> None:
        BillingService.dismiss_notification(notification_id=notification_id, account_id=account_id)

    @classmethod
    def _map_notification(cls, payload: Mapping[str, Any]) -> AccountNotification:
        raw_contents = payload.get("contents") or {}
        contents = {language: cls._map_content(content) for language, content in raw_contents.items()}
        return AccountNotification(
            notification_id=payload.get("notificationId"),
            frequency=payload.get("frequency"),
            contents=contents,
        )

    @staticmethod
    def _map_content(payload: Mapping[str, Any]) -> NotificationContent:
        return NotificationContent(
            # The application service owns the requested-language fallback.
            lang=payload.get("lang") or "",
            title=payload.get("title") or "",
            subtitle=payload.get("subtitle") or "",
            body=payload.get("body") or "",
            title_pic_url=payload.get("titlePicUrl") or "",
        )
