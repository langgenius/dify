"""Reference declarative schema for the IM Channel redesign.

This file is an OpenSpec artifact and is not imported by the application.

Invariants:
1. Workspace and deployment repositories use the same Dify table.
2. A non-null unique owner key identifies one current Channel slot.
3. Workspace keys use `workspace:<tenant_id>` and deployment uses `deployment`.
4. The owner key is a logical persistence key, not a Dify foreign key.
5. The canonical `IMEncryptedCredentials` model is unchanged.
6. Existing-resource writes compare owner key, Channel ID, and numeric version.
7. The configuration version is positive.
8. The model has no relationships to Identity, Binding, Sync, Reconciliation,
   Contact, or message inbox models.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from models.types import EnumText, FrozenPydanticModelColumn, LongText, StringUUID


# Reuse the existing canonical IMEncryptedCredentials Pydantic model.
# This reference artifact intentionally does not declare another envelope model.
# Reuse canonical core IMProvider and Repository-owned IMChannelStatus
# definitions because both values cross the ORM model boundary.


class HumanInputIMChannel(DefaultFieldsDCMixin, TypeBase):
    """One current IM Channel in a repository-generated owner slot.

    `owner_key` deliberately replaces a polymorphic database foreign key.
    Its unique constraint serializes concurrent first creation for both
    workspace and deployment owners without Redis or a separate lock row.
    """

    __tablename__ = "human_input_im_channels"
    __table_args__ = (
        sa.UniqueConstraint(
            "owner_key",
            name="human_input_im_channels_owner_key_uq",
        ),
        sa.UniqueConstraint(
            "webhook_id",
            name="human_input_im_channels_webhook_id_uq",
        ),
        {
            "comment": (
                "Current Organization-owned Human Input IM Channel configuration. "
                "Directory, Binding, Sync, and inbox records remain separately owned."
            )
        },
    )

    owner_key: Mapped[str] = mapped_column(
        sa.String(50),
        nullable=False,
        comment="Canonical owner slot: workspace:<tenant_id> or deployment.",
    )
    provider: Mapped[IMProvider] = mapped_column(
        EnumText(IMProvider),
        nullable=False,
        comment="Configured IM provider discriminator.",
    )
    provider_tenant_id: Mapped[str] = mapped_column(
        sa.String(255),
        nullable=False,
        comment="Confirmed provider-side Organization, tenant, or workspace identifier.",
    )
    encrypted_credentials: Mapped[IMEncryptedCredentials] = mapped_column(
        FrozenPydanticModelColumn(IMEncryptedCredentials),
        nullable=False,
        comment="Versioned opaque encrypted IM Channel credential envelope.",
    )
    app_identifier: Mapped[str] = mapped_column(
        sa.String(255),
        nullable=False,
        comment="Safe provider application identifier used by credential-free projections.",
    )
    configured_by_account_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Latest configuring Dify Account; null for deployment-owned writes.",
    )
    webhook_id: Mapped[str] = mapped_column(
        sa.String(32),
        nullable=False,
        comment="Server-generated globally unique route ID used to derive webhook URLs.",
    )
    status: Mapped[IMChannelStatus] = mapped_column(
        EnumText(IMChannelStatus),
        nullable=False,
        default=IMChannelStatus.CONNECTED,
        comment="Stored credential-safe Channel status snapshot.",
    )
    status_reason: Mapped[str | None] = mapped_column(
        LongText,
        nullable=True,
        default=None,
        comment="Operator-safe status explanation without provider payload or credentials.",
    )
    config_version: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        default=1,
        comment="Monotonic numeric version paired with the Channel ID for CAS.",
    )


__all__ = [
    "HumanInputIMChannel",
]
