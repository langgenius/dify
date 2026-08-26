"""Application service for account identity and access-session use cases."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from machinery.context import RequestContext
from services.account_ports import (
    AccountSessionRepository,
    AccountSnapshotQuery,
    AccountTokenCacheInvalidator,
    AccountWorkspaceSnapshotQuery,
)
from services.account_errors import AccountNotFoundError, AccountSessionNotFoundError
from services.entities.account_access_entities import AccountAccessSnapshot, AccountSessionPage


class AccountAccessService:
    def __init__(
        self,
        *,
        accounts: AccountSnapshotQuery,
        workspaces: AccountWorkspaceSnapshotQuery,
        sessions: AccountSessionRepository,
        invalidate_token_cache: AccountTokenCacheInvalidator,
        now: Callable[[], datetime],
    ) -> None:
        self._accounts = accounts
        self._workspaces = workspaces
        self._sessions = sessions
        self._invalidate_token_cache = invalidate_token_cache
        self._now = now

    def get(self, context: RequestContext) -> AccountAccessSnapshot:
        account = self._accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError

        workspaces = tuple(self._workspaces.list_account_access_workspaces(context.account_id))
        default_workspace_id = next((workspace.id for workspace in workspaces if workspace.current), None)
        if default_workspace_id is None and workspaces:
            default_workspace_id = workspaces[0].id

        return AccountAccessSnapshot(
            account=account,
            workspaces=workspaces,
            default_workspace_id=default_workspace_id,
        )

    def list_sessions(self, context: RequestContext, *, page: int, limit: int) -> AccountSessionPage:
        total, sessions = self._sessions.list_active(
            account_id=context.account_id,
            active_at=self._now(),
            offset=(page - 1) * limit,
            limit=limit,
        )
        return AccountSessionPage(page=page, limit=limit, total=total, items=tuple(sessions))

    def revoke_current_session(self, context: RequestContext) -> None:
        if context.access_token_id is None:
            raise RuntimeError("OpenAPI account admission did not resolve an access token")
        self._revoke(context, token_id=context.access_token_id, require_owned=False)

    def revoke_session(self, context: RequestContext, *, token_id: str) -> None:
        self._revoke(context, token_id=token_id, require_owned=True)

    def _revoke(self, context: RequestContext, *, token_id: str, require_owned: bool) -> None:
        revocation = self._sessions.revoke(
            account_id=context.account_id,
            token_id=token_id,
            revoked_at=self._now(),
        )
        if require_owned and not revocation.owned:
            raise AccountSessionNotFoundError
        if revocation.token_hash is not None:
            self._invalidate_token_cache(revocation.token_hash)
