from datetime import datetime
from enum import StrEnum
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import TypeBase
from .types import StringUUID


class CredentialType(StrEnum):
    """Discriminator for polymorphic credential permission table."""

    TRIGGER_SUBSCRIPTION = "trigger_subscription"
    BUILTIN_TOOL_PROVIDER = "builtin_tool_provider"
    DATASOURCE_PROVIDER = "datasource_provider"
    PROVIDER_CREDENTIAL = "provider_credential"


class CredentialPermission(TypeBase):
    """
    Polymorphic join table for per-credential partial-member access control.
    Mirrors DatasetPermission (api/models/dataset.py) but supports all credential types
    via a credential_type discriminator column.
    """

    __tablename__ = "credential_permissions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="credential_permission_pkey"),
        sa.Index("idx_credential_permissions_credential", "credential_id", "credential_type"),
        sa.Index("idx_credential_permissions_account_id", "account_id"),
        sa.Index("idx_credential_permissions_tenant_id", "tenant_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID,
        insert_default=lambda: str(uuid4()),
        default_factory=lambda: str(uuid4()),
        primary_key=True,
        init=False,
    )
    credential_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    credential_type: Mapped[str] = mapped_column(String(40), nullable=False)
    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    has_permission: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true"), default=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
