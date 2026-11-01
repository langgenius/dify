"""Billing-backed notification gateway."""

from typing import override

from services.billing_client import saas
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
        reply = BillingService.get_account_notification(account_id)
        return AccountNotificationBatch(
            should_show=bool(reply.should_show),
            notifications=tuple(self._map_notification(item) for item in reply.notifications or ()),
        )

    @override
    def dismiss(self, notification_id: str, account_id: str) -> None:
        BillingService.dismiss_notification(notification_id=notification_id, account_id=account_id)

    @classmethod
    def _map_notification(cls, payload: saas.NotificationPayload) -> AccountNotification:
        """Accept observed upstream models; omit translations with no non-null fields to allow language fallback."""
        contents = {
            language: cls._map_content(content)
            for language, content in (payload.contents or {}).items()
            if content and content.model_dump(exclude_none=True, warnings=False)
        }
        return AccountNotification(
            notification_id=payload.notification_id,
            frequency=payload.frequency,
            contents=contents,
        )

    @staticmethod
    def _map_content(payload: saas.LangContent) -> NotificationContent:
        return NotificationContent(
            # The application service owns the requested-language fallback.
            lang=payload.lang or "",
            title=payload.title or "",
            subtitle=payload.subtitle or "",
            body=payload.body or "",
            title_pic_url=payload.title_pic_url or "",
        )
