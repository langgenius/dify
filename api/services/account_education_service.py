"""Application service for account education-discount use cases."""

from typing import Protocol

from machinery.context import RequestContext
from machinery.errors import ActiveWorkspaceRequiredError
from services.account_errors import AccountNotFoundError, EducationRateLimitExceededError
from services.account_ports import AccountRepository
from services.entities.account_entities import (
    AccountEducationActivation,
    AccountEducationAutocomplete,
    AccountEducationStatus,
    AccountEducationVerification,
)


class AccountEducationRateLimiter(Protocol):
    def is_rate_limited(self, key: str, /) -> bool: ...

    def increment_rate_limit(self, key: str, /) -> None: ...


class AccountEducationGateway(Protocol):
    def verify(self, *, account_id: str) -> AccountEducationVerification: ...

    def activate(
        self,
        *,
        account_id: str,
        tenant_id: str,
        token: str,
        institution: str,
        role: str,
    ) -> AccountEducationActivation: ...

    def status(self, account_id: str) -> AccountEducationStatus: ...

    def autocomplete(self, *, keywords: str, page: int, limit: int) -> AccountEducationAutocomplete: ...


class AccountEducationService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        education: AccountEducationGateway,
        verification_rate_limiter: AccountEducationRateLimiter,
        activation_rate_limiter: AccountEducationRateLimiter,
    ) -> None:
        self._accounts = accounts
        self._education = education
        self._verification_rate_limiter = verification_rate_limiter
        self._activation_rate_limiter = activation_rate_limiter

    def verify(self, context: RequestContext) -> AccountEducationVerification:
        account = self._accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError
        if self._verification_rate_limiter.is_rate_limited(account.email):
            raise EducationRateLimitExceededError
        self._verification_rate_limiter.increment_rate_limit(account.email)
        return self._education.verify(account_id=account.id)

    def activate(
        self,
        context: RequestContext,
        *,
        token: str,
        institution: str,
        role: str,
    ) -> AccountEducationActivation:
        account = self._accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError
        if context.active_workspace_id is None:
            raise ActiveWorkspaceRequiredError
        if self._activation_rate_limiter.is_rate_limited(account.email):
            raise EducationRateLimitExceededError
        self._activation_rate_limiter.increment_rate_limit(account.email)
        return self._education.activate(
            account_id=account.id,
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
