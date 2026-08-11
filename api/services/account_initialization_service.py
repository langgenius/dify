"""Application service for initializing a newly admitted account."""

from collections.abc import Callable
from datetime import datetime

from machinery.context import RequestContext
from machinery.errors import ActiveWorkspaceRequiredError
from services.account_errors import (
    AccountAlreadyInitializedError,
    AccountNotFoundError,
    InvalidInvitationCodeError,
    MissingInvitationCodeError,
)
from services.account_ports import AccountRepository
from services.entities.account_entities import AccountInitialization, AccountInitializationStatus, AccountSnapshot


class AccountInitializationService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        invitation_required: bool,
        now: Callable[[], datetime],
    ) -> None:
        self._accounts = accounts
        self._invitation_required = invitation_required
        self._now = now

    def initialize(
        self,
        context: RequestContext,
        *,
        interface_language: str,
        timezone: str,
        invitation_code: str | None,
    ) -> AccountSnapshot:
        workspace_id: str | None = None
        if self._invitation_required:
            if invitation_code is None:
                raise MissingInvitationCodeError("invitation_code is required")
            workspace_id = context.active_workspace_id
            if workspace_id is None:
                raise ActiveWorkspaceRequiredError

        result = self._accounts.initialize(
            context.account_id,
            AccountInitialization(
                interface_language=interface_language,
                interface_theme="light",
                timezone=timezone,
                initialized_at=self._now(),
            ),
            invitation_code=invitation_code if self._invitation_required else None,
            workspace_id=workspace_id,
        )
        if result.status == AccountInitializationStatus.ACCOUNT_NOT_FOUND:
            raise AccountNotFoundError
        if result.status == AccountInitializationStatus.ALREADY_INITIALIZED:
            raise AccountAlreadyInitializedError
        if result.status == AccountInitializationStatus.INVALID_INVITATION:
            raise InvalidInvitationCodeError
        if result.account is None:
            raise RuntimeError("Account repository returned an initialized result without an account")
        return result.account
