from collections.abc import Iterable

from configs import dify_config
from models.account import Account


def get_platform_admin_emails() -> set[str]:
    return {email.strip().lower() for email in dify_config.PLATFORM_ADMIN_EMAILS.split(",") if email.strip()}


def is_platform_admin_email(email: str | None) -> bool:
    if not email:
        return False
    return email.lower() in get_platform_admin_emails()


def apply_platform_admin_flag(account: Account | None) -> Account | None:
    if account is not None:
        account.is_platform_admin = is_platform_admin_email(account.email)
    return account


def apply_platform_admin_flag_for_accounts(accounts: Iterable[Account]) -> list[Account]:
    updated_accounts: list[Account] = []
    for account in accounts:
        apply_platform_admin_flag(account)
        updated_accounts.append(account)
    return updated_accounts
