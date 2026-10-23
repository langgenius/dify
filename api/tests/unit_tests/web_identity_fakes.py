"""Account snapshots for web identity boundary tests."""

from dataclasses import dataclass
from datetime import datetime

from services.entities.account_entities import AccountSnapshot
from services.web_identity_service import WebIdentityService

ACCOUNT_ID = "8a3e045b-9051-4e12-8431-93786413c001"


@dataclass
class WebAccounts:
    status: str | None = "active"

    def get(self, account_id: str) -> AccountSnapshot | None:
        if self.status is None:
            return None
        return AccountSnapshot(
            id=account_id,
            name="Consumer",
            email="consumer@example.com",
            avatar=None,
            is_password_set=True,
            interface_language="en-US",
            interface_theme=None,
            timezone="UTC",
            last_login_at=None,
            last_login_ip=None,
            status=self.status,
            initialized_at=None,
            created_at=datetime(2026, 1, 1),
        )


def web_identities() -> WebIdentityService:
    return WebIdentityService(accounts=WebAccounts(), allow_console_login=True, allow_webapp_login=True)
