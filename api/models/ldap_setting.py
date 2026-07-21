"""SQLAlchemy model for LDAP / Active Directory configuration."""
from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import TypeBase


class LdapSetting(TypeBase):
    """Stores a single LDAP/AD configuration record for the Dify instance.

    At most one row should exist; the application always reads with ``LIMIT 1``.
    """

    __tablename__ = "ldap_settings"
    __table_args__ = (sa.PrimaryKeyConstraint("id", name="ldap_setting_pkey"),)

    id: Mapped[str] = mapped_column(
        String(36),
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        init=False,
    )

    # ── Core connectivity ────────────────────────────────────────────────────
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    server_host: Mapped[str] = mapped_column(String(255), default="")
    server_port: Mapped[int] = mapped_column(Integer, default=389)
    use_ssl: Mapped[bool] = mapped_column(Boolean, default=False)

    # ── Service (reader) account ─────────────────────────────────────────────
    bind_dn: Mapped[str] = mapped_column(String(255), default="")
    # Stored encrypted via Fernet keyed on Dify's SECRET_KEY
    bind_password: Mapped[str] = mapped_column(String(1024), default="")

    # ── User search ──────────────────────────────────────────────────────────
    user_search_base: Mapped[str] = mapped_column(String(255), default="")
    # Use {username} as placeholder for the login value supplied by the user
    user_search_filter: Mapped[str] = mapped_column(String(255), default="")
    mail_attribute: Mapped[str] = mapped_column(String(128), default="mail")
    name_attribute: Mapped[str] = mapped_column(String(128), default="displayName")

    # ── Behaviour ────────────────────────────────────────────────────────────
    # When True, a failed LDAP auth falls through to local password check
    fallback_to_local: Mapped[bool] = mapped_column(Boolean, default=True)

    # ── Timestamps ───────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=sa.func.current_timestamp(),
        nullable=False,
        init=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=sa.func.current_timestamp(),
        nullable=False,
        init=False,
        onupdate=sa.func.current_timestamp(),
    )
