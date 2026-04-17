from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.tools.entities.tool_credential_access import ToolCredentialAccessScope
from models.account import TenantAccountJoin
from models.tools import BuiltinToolProvider, ToolBuiltinProviderAllowedAccount


def load_allowed_account_ids_for_credentials(session: Session, credential_ids: list[str]) -> dict[str, set[str]]:
    if not credential_ids:
        return {}
    rows = session.execute(
        select(ToolBuiltinProviderAllowedAccount.credential_id, ToolBuiltinProviderAllowedAccount.account_id).where(
            ToolBuiltinProviderAllowedAccount.credential_id.in_(credential_ids)
        )
    ).all()
    result: dict[str, set[str]] = {}
    for cred_id, account_id in rows:
        result.setdefault(cred_id, set()).add(account_id)
    return result


def validate_accounts_belong_to_tenant(session: Session, tenant_id: str, account_ids: list[str]) -> None:
    if not account_ids:
        return
    unique = list(dict.fromkeys(account_ids))
    rows = session.scalars(
        select(TenantAccountJoin.account_id).where(
            TenantAccountJoin.tenant_id == tenant_id,
            TenantAccountJoin.account_id.in_(unique),
        )
    ).all()
    if len(set(rows)) != len(unique):
        raise ValueError("one or more selected members are not in this workspace")


def sync_allowed_accounts(
    session: Session,
    *,
    credential_id: str,
    tenant_id: str,
    access_scope: ToolCredentialAccessScope,
    allowed_account_ids: list[str] | None,
) -> None:
    session.execute(
        delete(ToolBuiltinProviderAllowedAccount).where(
            ToolBuiltinProviderAllowedAccount.credential_id == credential_id
        )
    )
    if access_scope != ToolCredentialAccessScope.RESTRICTED:
        return
    raw = [x for x in (allowed_account_ids or []) if x]
    validate_accounts_belong_to_tenant(session, tenant_id, raw)
    for account_id in dict.fromkeys(raw):
        session.add(
            ToolBuiltinProviderAllowedAccount(
                credential_id=credential_id,
                account_id=account_id,
            )
        )


def account_may_view_credential_list(
    *,
    viewer_account_id: str,
    viewer_role: str,
    provider: BuiltinToolProvider,
    extra_allowed_ids: set[str],
) -> bool:
    """Whether masked credential metadata may be listed in the console for this viewer."""
    if viewer_role in ("owner", "admin"):
        return True
    return account_may_use_credential(
        viewer_account_id=viewer_account_id,
        provider=provider,
        extra_allowed_ids=extra_allowed_ids,
    )


def account_may_use_credential(
    *,
    viewer_account_id: str | None,
    provider: BuiltinToolProvider,
    extra_allowed_ids: set[str],
) -> bool:
    """Whether a caller may execute tools using this credential."""
    scope = provider.access_scope
    if scope == ToolCredentialAccessScope.WORKSPACE:
        return True
    if viewer_account_id is None:
        return False
    if scope == ToolCredentialAccessScope.PRIVATE:
        return viewer_account_id == provider.user_id
    if scope == ToolCredentialAccessScope.RESTRICTED:
        return viewer_account_id == provider.user_id or viewer_account_id in extra_allowed_ids
    return False


def assert_account_may_use_tool_credential(
    *,
    tenant_id: str,
    account_id: str | None,
    provider: BuiltinToolProvider,
    session: Session,
) -> None:
    from core.tools.errors import ToolProviderNotFoundError

    if provider.tenant_id != tenant_id:
        raise ToolProviderNotFoundError("credential does not belong to this workspace")

    extra: set[str] = set()
    if provider.access_scope == ToolCredentialAccessScope.RESTRICTED:
        extra = set(
            session.scalars(
                select(ToolBuiltinProviderAllowedAccount.account_id).where(
                    ToolBuiltinProviderAllowedAccount.credential_id == provider.id
                )
            ).all()
        )

    if not account_may_use_credential(
        viewer_account_id=account_id,
        provider=provider,
        extra_allowed_ids=extra,
    ):
        raise ToolProviderNotFoundError("credential is not available for this user")
