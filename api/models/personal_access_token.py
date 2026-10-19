"""Account-owned PAT metadata, independent of workspace credentials."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from models.base import DefaultFieldsDCMixin, TypeBase
from models.types import StringUUID


class PersonalAccessToken(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "personal_access_tokens"
    __table_args__ = (
        sa.Index("personal_access_token_account_idx", "account_id"),
        sa.Index("personal_access_token_digest_idx", "secret_digest", unique=True),
        sa.UniqueConstraint("account_id", "creation_key", name="personal_access_token_creation_unique"),
        sa.CheckConstraint("resource_scope_mode IN ('all', 'selected', 'none')", name="pat_resource_scope_mode"),
        sa.CheckConstraint("workspace_scope_mode IN ('all', 'selected', 'none')", name="pat_workspace_scope_mode"),
        sa.CheckConstraint("resource_scope_mode != 'none' OR workspace_scope_mode != 'none'", name="pat_enabled_scope"),
        sa.CheckConstraint("version >= 1", name="pat_version"),
    )

    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    secret_digest: Mapped[str] = mapped_column(sa.String(64), nullable=False, repr=False)
    secret_ciphertext: Mapped[bytes] = mapped_column(sa.LargeBinary, nullable=False, repr=False)
    secret_last_four: Mapped[str] = mapped_column(sa.String(4), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True)
    resource_scope_mode: Mapped[str] = mapped_column(sa.String(16), default="all")
    workspace_scope_mode: Mapped[str] = mapped_column(sa.String(16), default="all")
    revoked_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    last_used_at: Mapped[datetime | None] = mapped_column(sa.DateTime, default=None)
    creation_key: Mapped[str | None] = mapped_column(sa.String(128), default=None, repr=False)
    creation_fingerprint: Mapped[str | None] = mapped_column(sa.String(64), default=None, repr=False)
    version: Mapped[int] = mapped_column(sa.Integer, default=1)


class PersonalAccessTokenResource(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "personal_access_token_resources"
    __table_args__ = (
        sa.UniqueConstraint("token_id", "resource_type", "resource_id", name="personal_access_token_resource_unique"),
        sa.CheckConstraint("resource_type IN ('app', 'dataset', 'app_runner')", name="pat_resource_type"),
        sa.Index("personal_access_token_resource_token_idx", "token_id"),
    )

    token_id: Mapped[str] = mapped_column(StringUUID)
    resource_id: Mapped[str] = mapped_column(StringUUID)
    resource_type: Mapped[str] = mapped_column(sa.String(16))
    workspace_id: Mapped[str] = mapped_column(StringUUID)
    display_name_snapshot: Mapped[str] = mapped_column(sa.Text)
    workspace_name_snapshot: Mapped[str] = mapped_column(sa.String(255))


class PersonalAccessTokenWorkspace(DefaultFieldsDCMixin, TypeBase):
    __tablename__ = "personal_access_token_workspaces"
    __table_args__ = (
        sa.UniqueConstraint("token_id", "workspace_id", name="personal_access_token_workspace_unique"),
        sa.Index("personal_access_token_workspace_token_idx", "token_id"),
    )

    token_id: Mapped[str] = mapped_column(StringUUID)
    workspace_id: Mapped[str] = mapped_column(StringUUID)
    display_name_snapshot: Mapped[str] = mapped_column(sa.String(255))
