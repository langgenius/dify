"""Application service for account education-discount use cases."""

from typing import Any, Protocol

from machinery.context import RequestContext
from machinery.errors import ActiveWorkspaceRequiredError
from services.account_errors import AccountNotFoundError
from services.account_ports import AccountRepository
from services.entities.account_entities import (
    AccountEducationAutocomplete,
    AccountEducationStatus,
    AccountEducationVerification,
)


class AccountEducationGateway(Protocol):
    def verify(self, *, account_id: str, email: str) -> AccountEducationVerification: ...

    def activate(
        self,
        *,
        account_id: str,
        email: str,
        tenant_id: str,
        token: str,
        institution: str,
        role: str,
    ) -> dict[str, Any] | None: ...

    def status(self, account_id: str) -> AccountEducationStatus: ...

    def autocomplete(self, *, keywords: str, page: int, limit: int) -> AccountEducationAutocomplete: ...


class AccountEducationService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        education: AccountEducationGateway,
    ) -> None:
        self._accounts = accounts
        self._education = education

    def verify(self, context: RequestContext) -> AccountEducationVerification:
        account = self._accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError
        return self._education.verify(account_id=account.id, email=account.email)

    def activate(
        self,
        context: RequestContext,
        *,
        token: str,
        institution: str,
        role: str,
    ) -> dict[str, Any] | None:
        account = self._accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError
        if context.active_workspace_id is None:
            raise ActiveWorkspaceRequiredError
        return self._education.activate(
            account_id=account.id,
            email=account.email,
            tenant_id=context.active_workspace_id,
            token=token,
            institution=institution,
            role=role,
        )

    def status(self, context: RequestContext) -> AccountEducationStatus:
        return self._education.status(context.account_id)

    def autocomplete(
        self,
        context: RequestContext,
        *,
        keywords: str,
        page: int,
        limit: int,
    ) -> AccountEducationAutocomplete:
        return self._education.autocomplete(keywords=keywords, page=page, limit=limit)
