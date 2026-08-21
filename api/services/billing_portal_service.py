"""Application service for Console Billing portal links."""

from collections.abc import Callable
from typing import TypedDict

from services.errors.billing import BillingAccessDeniedError

_PRIVILEGED_ROLES = frozenset({"owner", "admin"})


class BillingPortalLink(TypedDict):
    url: str


class BillingPortalService:
    def __init__(
        self,
        *,
        get_subscription: Callable[[str, str, str, str], BillingPortalLink],
        get_invoices: Callable[[str, str], BillingPortalLink],
    ) -> None:
        self._get_subscription = get_subscription
        self._get_invoices = get_invoices

    def get_subscription(
        self,
        *,
        plan: str,
        interval: str,
        email: str,
        workspace_id: str,
        role: str | None,
    ) -> BillingPortalLink:
        self._ensure_access(role)
        return self._get_subscription(plan, interval, email, workspace_id)

    def get_invoices(self, *, email: str, workspace_id: str, role: str | None) -> BillingPortalLink:
        self._ensure_access(role)
        return self._get_invoices(email, workspace_id)

    @staticmethod
    def _ensure_access(role: str | None) -> None:
        if role not in _PRIVILEGED_ROLES:
            raise BillingAccessDeniedError
