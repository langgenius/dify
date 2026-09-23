"""Application service for partner tenant bindings."""

from collections.abc import Callable
from typing import Any


class PartnerTenantBindingService:
    def __init__(self, *, sync_bindings: Callable[[str, str, str], dict[str, Any]]) -> None:
        self._sync_bindings = sync_bindings

    def sync(self, *, account_id: str, partner_key: str, click_id: str) -> dict[str, Any]:
        return self._sync_bindings(account_id, partner_key, click_id)
