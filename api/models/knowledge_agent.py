"""Personal agents (Claude Code, Codex, any MCP client) reading Agent Knowledge Bases as a user.

A connection (``KnowledgeAgentGrant``) is either an OAuth authorization of one MCP client or one
personal token. It belongs to one account in one workspace and covers the knowledge bases chosen
for it. Its bearer lives in ``oauth_access_tokens`` as the ``dfok_`` token type (one row per
connection, rotated in place), so it shares the account's token list, revocation path and audit
trail with the other account tokens while carrying only the ``knowledge:read`` scope.
"""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from libs.uuid_utils import uuidv7

from .base import TypeBase
from .types import AdjustedJSON, LongText, StringUUID


class KnowledgeAgentClient(TypeBase):
    """An MCP client registered dynamically (``dcr``) or known by its metadata document (``cimd``)."""

    __tablename__ = "knowledge_agent_clients"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="knowledge_agent_client_pkey"),
        sa.UniqueConstraint("client_id_hash", name="knowledge_agent_client_id_hash_uq"),
        sa.CheckConstraint("kind IN ('cimd', 'dcr')", name=sa.schema.conv("knowledge_agent_client_kind_ck")),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    # A metadata-document client id is an HTTPS URL (up to 2 KiB); uniqueness goes through its hash
    # because MySQL cannot index long text.
    client_id: Mapped[str] = mapped_column(LongText, nullable=False)
    client_id_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    kind: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    redirect_uris: Mapped[list[str]] = mapped_column(AdjustedJSON, nullable=False)
    metadata_fetched_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True, default=None
    )
    last_used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=func.now(), init=False
    )


class KnowledgeAgentGrant(TypeBase):
    """One agent connection: an OAuth authorization or a personal token, in one workspace."""

    __tablename__ = "knowledge_agent_grants"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="knowledge_agent_grant_pkey"),
        sa.Index("knowledge_agent_grant_account_idx", "account_id", "tenant_id"),
        sa.Index("knowledge_agent_grant_tenant_idx", "tenant_id"),
        sa.CheckConstraint("kind IN ('oauth', 'personal')", name=sa.schema.conv("knowledge_agent_grant_kind_ck")),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"], name="knowledge_agent_grant_account_fk", ondelete="CASCADE"
        ),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    kind: Mapped[str] = mapped_column(sa.String(16), nullable=False)
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    scope: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    client_ref: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True, default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True, default=None)
    last_used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=func.now(), init=False
    )


class KnowledgeAgentGrantSpace(TypeBase):
    """A knowledge base (control-space) chosen for a connection."""

    __tablename__ = "knowledge_agent_grant_spaces"
    __table_args__ = (
        sa.PrimaryKeyConstraint("grant_id", "control_space_id", name="knowledge_agent_grant_space_pkey"),
        sa.ForeignKeyConstraint(
            ["grant_id"], ["knowledge_agent_grants.id"], name="knowledge_agent_grant_space_grant_fk", ondelete="CASCADE"
        ),
    )

    grant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    control_space_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)


class KnowledgeAgentRefreshToken(TypeBase):
    """A rotating refresh token: a used one (``rotated_at``) presented again ends the connection."""

    __tablename__ = "knowledge_agent_refresh_tokens"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="knowledge_agent_refresh_token_pkey"),
        sa.UniqueConstraint("token_hash", name="knowledge_agent_refresh_token_hash_uq"),
        sa.Index("knowledge_agent_refresh_token_grant_idx", "grant_id"),
        sa.ForeignKeyConstraint(
            ["grant_id"],
            ["knowledge_agent_grants.id"],
            name="knowledge_agent_refresh_token_grant_fk",
            ondelete="CASCADE",
        ),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    grant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    token_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    rotated_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=func.now(), init=False
    )


class KnowledgeAgentWorkspaceSetting(TypeBase):
    """Workspace switch for personal agents. No row means the default: allowed."""

    __tablename__ = "knowledge_agent_workspace_settings"
    __table_args__ = (sa.PrimaryKeyConstraint("tenant_id", name="knowledge_agent_workspace_setting_pkey"),)

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"), default=True)
    updated_by_account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        init=False,
    )
