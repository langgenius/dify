"""Connection management for the Console: a member's connections and the workspace admin view."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account
from models.knowledge_agent import (
    KnowledgeAgentClient,
    KnowledgeAgentGrant,
    KnowledgeAgentGrantSpace,
    KnowledgeAgentWorkspaceSetting,
)
from services.knowledge_agent.contracts import (
    Clock,
    KnowledgeAgentAccessError,
    KnowledgeAgentUrls,
    aware,
    is_workspace_admin,
)
from services.knowledge_agent.oauth import (
    DEFAULT_KNOWLEDGE_AGENT_SCOPE,
    PERSONAL_TOKEN_DEFAULT_DAYS,
    PERSONAL_TOKEN_MAX_DAYS,
)
from services.knowledge_agent.policy import KnowledgeAgentAccessPolicy
from services.knowledge_agent.tokens import KnowledgeAgentTokenStore

TOKEN_HINT_LENGTH = 4
# The shared bearer table requires an expiry; a personal token that never expires gets this one.
_NEVER_EXPIRES = datetime(2999, 12, 31, tzinfo=UTC)


class KnowledgeAgentGrantConsole:
    """Lists, creates, changes and disconnects connections on behalf of a signed-in Console member."""

    def __init__(
        self,
        *,
        session_maker: sessionmaker[Session],
        tokens: KnowledgeAgentTokenStore,
        policy: KnowledgeAgentAccessPolicy,
        clock: Clock,
    ) -> None:
        self._sessions = session_maker
        self._tokens = tokens
        self._policy = policy
        self._now = clock

    def list_mine(self, *, account: Account, tenant_id: str, urls: KnowledgeAgentUrls) -> dict[str, Any]:
        """The member's live connections in this workspace, the MCP URL and the switches that apply."""
        with self._sessions() as session:
            grants = self._grant_views(
                session,
                (KnowledgeAgentGrant.account_id == account.id, KnowledgeAgentGrant.tenant_id == tenant_id),
                with_account=False,
            )
        return {
            "available": self._policy.deployment_enabled(),
            "agent_access_enabled": self._policy.workspace_enabled(tenant_id),
            "blocked_knowledge_base_ids": self._policy.blocked_knowledge_bases(
                tenant_id=tenant_id, account_id=account.id
            ),
            "mcp_url": urls.resource,
            "grants": grants,
        }

    def create_personal_token(self, *, account: Account, tenant_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Mint a personal token for chosen knowledge bases; the token itself is returned only here."""
        self._policy.require_enabled()
        self._policy.require_workspace_enabled(tenant_id)
        name = body.get("name").strip() if isinstance(body.get("name"), str) else ""
        if not name or len(name) > 100:
            raise KnowledgeAgentAccessError(422, "invalid_name", "Give the token a name of at most 100 characters")
        # An explicit null asks for a token that never expires; leaving the field out takes the default.
        days = body.get("expires_in_days", PERSONAL_TOKEN_DEFAULT_DAYS)
        if days is not None and (
            not isinstance(days, int) or isinstance(days, bool) or not 1 <= days <= PERSONAL_TOKEN_MAX_DAYS
        ):
            raise KnowledgeAgentAccessError(
                422, "invalid_expiry", f"expires_in_days must be null or between 1 and {PERSONAL_TOKEN_MAX_DAYS}"
            )
        space_ids = self._policy.check_knowledge_bases(
            account_id=account.id, tenant_id=tenant_id, raw=body.get("knowledge_base_ids")
        )
        expires_at = None if days is None else self._now() + timedelta(days=days)
        with self._sessions.begin() as session:
            grant = self._tokens.create_grant(
                session,
                account_id=account.id,
                tenant_id=tenant_id,
                kind="personal",
                name=name,
                scopes=[DEFAULT_KNOWLEDGE_AGENT_SCOPE],
                space_ids=space_ids,
                client_ref=None,
                expires_at=expires_at,
            )
            # The bearer row needs a date; the grant, which is what gets checked, carries "never".
            token = self._tokens.upsert_bearer(session, grant, expires_at or _NEVER_EXPIRES)
            grant.token_hint = token[-TOKEN_HINT_LENGTH:]
            grant_id = grant.id
        return {"grant": self._live_view(grant_id), "token": token}

    def update_grant(self, *, account: Account, tenant_id: str, grant_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Replace the knowledge bases of the member's own live connection.

        The connection is checked twice: first so a caller who may not change it is told so
        before the chosen bases are looked at, then again, under a row lock, in the transaction
        that writes. A connection revoked, expired or disconnected in between is not written to.
        """
        with self._sessions() as session:
            self._owned_live_grant(session, account=account, tenant_id=tenant_id, grant_id=grant_id, lock=False)
        space_ids = self._policy.check_knowledge_bases(
            account_id=account.id, tenant_id=tenant_id, raw=body.get("knowledge_base_ids")
        )
        with self._sessions.begin() as session:
            self._owned_live_grant(session, account=account, tenant_id=tenant_id, grant_id=grant_id, lock=True)
            session.execute(
                sa.delete(KnowledgeAgentGrantSpace)
                .where(KnowledgeAgentGrantSpace.grant_id == grant_id)
                .execution_options(synchronize_session=False)
            )
            session.add_all(
                KnowledgeAgentGrantSpace(grant_id=grant_id, control_space_id=space_id, tenant_id=tenant_id)
                for space_id in space_ids
            )
        return self._live_view(grant_id)

    def revoke_grant(self, *, account: Account, tenant_id: str, role: str | None, grant_id: str) -> None:
        """Disconnect a connection: the owner's own, or any member's for a workspace admin."""
        with self._sessions.begin() as session:
            grant = self._find_grant(session, tenant_id=tenant_id, grant_id=grant_id)
            if grant.account_id != account.id and not is_workspace_admin(role):
                raise KnowledgeAgentAccessError(
                    403, "permission_denied", "Only the owner or a workspace admin can disconnect this"
                )
            self._tokens.revoke_grant(session, grant.id, reason="disconnected")

    def workspace_settings(self, *, tenant_id: str, role: str | None) -> dict[str, Any]:
        """The workspace switch and every member's live connections (workspace admins only)."""
        if not is_workspace_admin(role):
            raise KnowledgeAgentAccessError(403, "permission_denied", "Only workspace admins can do this")
        with self._sessions() as session:
            grants = self._grant_views(session, (KnowledgeAgentGrant.tenant_id == tenant_id,), with_account=True)
        return {"agent_access_enabled": self._policy.workspace_enabled(tenant_id), "grants": grants}

    def update_workspace_settings(
        self, *, account: Account, tenant_id: str, role: str | None, body: dict[str, Any]
    ) -> dict[str, Any]:
        """Turn personal agents on or off for the workspace and return the admin view."""
        if not is_workspace_admin(role):
            raise KnowledgeAgentAccessError(403, "permission_denied", "Only workspace admins can do this")
        enabled = body.get("enabled")
        if not isinstance(enabled, bool):
            raise KnowledgeAgentAccessError(422, "invalid_agent_access", "enabled must be a boolean")
        with self._sessions.begin() as session:
            setting = session.get(KnowledgeAgentWorkspaceSetting, tenant_id)
            if setting is None:
                setting = KnowledgeAgentWorkspaceSetting(tenant_id=tenant_id)
                session.add(setting)
            setting.enabled = enabled
            setting.updated_by_account_id = account.id
        return self.workspace_settings(tenant_id=tenant_id, role=role)

    def _owned_live_grant(
        self, session: Session, *, account: Account, tenant_id: str, grant_id: str, lock: bool
    ) -> KnowledgeAgentGrant:
        """The member's own connection, if it is live; ``lock`` holds its row until the transaction ends."""
        grant = self._find_grant(session, tenant_id=tenant_id, grant_id=grant_id, lock=lock)
        if grant.account_id != account.id:
            raise KnowledgeAgentAccessError(403, "permission_denied", "Only the owner of a connection can change it")
        if grant.expires_at is not None and aware(grant.expires_at) <= self._now():
            # An expired connection is no longer listed and cannot come back: it is gone.
            raise _grant_not_found()
        return grant

    @staticmethod
    def _find_grant(session: Session, *, tenant_id: str, grant_id: str, lock: bool = False) -> KnowledgeAgentGrant:
        statement = sa.select(KnowledgeAgentGrant).where(
            KnowledgeAgentGrant.id == grant_id,
            KnowledgeAgentGrant.tenant_id == tenant_id,
            KnowledgeAgentGrant.revoked_at.is_(None),
        )
        if lock:
            # A row lock, and a fresh read even if the session has seen the row before.
            statement = statement.with_for_update().execution_options(populate_existing=True)
        grant = session.scalar(statement)
        if grant is None:
            raise _grant_not_found()
        return grant

    def _live_view(self, grant_id: str) -> dict[str, Any]:
        """The view of one connection, or not-found if it was revoked or expired in the meantime."""
        with self._sessions() as session:
            views = self._grant_views(session, (KnowledgeAgentGrant.id == grant_id,), with_account=False)
        if not views:
            raise _grant_not_found()
        return views[0]

    def _grant_views(self, session: Session, where: Iterable[Any], *, with_account: bool) -> list[dict[str, Any]]:
        now = self._now()
        grants = session.scalars(
            sa.select(KnowledgeAgentGrant)
            .where(
                *where,
                KnowledgeAgentGrant.revoked_at.is_(None),
                sa.or_(KnowledgeAgentGrant.expires_at.is_(None), KnowledgeAgentGrant.expires_at > now),
            )
            .order_by(KnowledgeAgentGrant.created_at.desc(), KnowledgeAgentGrant.id.desc())
            .limit(500)
        ).all()
        if not grants:
            return []
        ids = [grant.id for grant in grants]
        spaces: dict[str, list[str]] = {}
        for grant_id, space_id in session.execute(
            sa.select(KnowledgeAgentGrantSpace.grant_id, KnowledgeAgentGrantSpace.control_space_id).where(
                KnowledgeAgentGrantSpace.grant_id.in_(ids)
            )
        ):
            spaces.setdefault(grant_id, []).append(space_id)
        clients = dict(
            session.execute(
                sa.select(KnowledgeAgentClient.id, KnowledgeAgentClient.name).where(
                    KnowledgeAgentClient.id.in_([grant.client_ref for grant in grants if grant.client_ref])
                )
            )
            .tuples()
            .all()
        )
        accounts: dict[str, tuple[str, str]] = {}
        if with_account:
            accounts = {
                row.id: (row.name, row.email)
                for row in session.execute(
                    sa.select(Account.id, Account.name, Account.email).where(
                        Account.id.in_({grant.account_id for grant in grants})
                    )
                )
            }
        return [
            {
                "id": grant.id,
                "kind": grant.kind,
                "name": grant.name,
                "client_name": clients.get(grant.client_ref) if grant.client_ref else None,
                "scopes": grant.scope.split(),
                "knowledge_base_ids": spaces.get(grant.id, []),
                "created_at": aware(grant.created_at),
                "expires_at": aware(grant.expires_at),
                "token_hint": grant.token_hint,
                "last_used_at": aware(grant.last_used_at),
                **(
                    {
                        "account": {
                            "id": grant.account_id,
                            "name": accounts.get(grant.account_id, ("", ""))[0],
                            "email": accounts.get(grant.account_id, ("", ""))[1],
                        }
                    }
                    if with_account
                    else {}
                ),
            }
            for grant in grants
        ]


def _grant_not_found() -> KnowledgeAgentAccessError:
    return KnowledgeAgentAccessError(404, "agent_grant_not_found", "Connection not found")
