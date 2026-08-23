"""Application service for Console Billing portal links."""

from collections.abc import Callable
from typing import TypedDict

from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError
from services.account_ports import AccountRepository


class BillingPortalLink(TypedDict):
    url: str


class BillingPortalService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        get_subscription: Callable[[str, str, str, str], BillingPortalLink],
        get_invoices: Callable[[str, str], BillingPortalLink],
    ) -> None:
        self._accounts = accounts
        self._get_subscription = get_subscription
        self._get_invoices = get_invoices

    def get_subscription(
        self,
        context: RequestContext,
        *,
        plan: str,
        interval: str,
    ) -> BillingPortalLink:
        email, workspace_id = self._resolve_account_email_and_workspace_id(context)
        return self._get_subscription(plan, interval, email, workspace_id)

    def get_invoices(self, context: RequestContext) -> BillingPortalLink:
        email, workspace_id = self._resolve_account_email_and_workspace_id(context)
        return self._get_invoices(email, workspace_id)

    def _resolve_account_email_and_workspace_id(self, context: RequestContext) -> tuple[str, str]:
        workspace_id = context.active_workspace_id
        if workspace_id is None:
            raise RuntimeError("Console account admission did not resolve an active workspace")

        account = self._accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError
        return account.email, workspace_id
