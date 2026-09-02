"""Reference declarative schema for current IM Identity and Binding state.

This file is an OpenSpec artifact and is not imported by the application.

Invariants:
1. Channel ID is the only Identity and Binding persistence parent.
2. Provider facts remain authoritative on the Channel and are not duplicated.
3. Default Bindings and workspace overrides use different tables.
4. Target tenant identifies only the workspace receiving an override.
5. Current Domain values omit every owner and persistence-only field.
6. All references are logical; repositories use explicit scoped predicates.
"""

from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from pydantic import ConfigDict, JsonValue, RootModel
from sqlalchemy.orm import Mapped, mapped_column

from models.base import DefaultFieldsDCMixin, TypeBase
from models.types import FrozenPydanticModelColumn, StringUUID


class IMIdentityRawPayload(RootModel[dict[str, JsonValue]]):
    model_config = ConfigDict(
        frozen=True,
        strict=True,
        validate_default=True,
    )


class HumanInputIMIdentity(DefaultFieldsDCMixin, TypeBase):
    """Current Provider user synchronized through one IM Channel."""

    __tablename__ = "human_input_im_identities"
    __table_args__ = (
        sa.UniqueConstraint(
            "channel_id",
            "provider_user_id",
            name="human_input_im_identities_channel_provider_user_uq",
        ),
        sa.CheckConstraint(
            "length(trim(provider_user_id)) > 0",
            name="human_input_im_identities_provider_user_nonblank",
        ),
        sa.Index("hiimi_channel_email_idx", "channel_id", "normalized_email"),
        sa.Index("hiimi_channel_name_idx", "channel_id", "normalized_name"),
        sa.Index(
            "hiimi_channel_last_seen_run_idx", "channel_id", "last_seen_sync_run_id"
        ),
        {
            "comment": (
                "Current Provider users synchronized through one IM Channel. "
                "Channel ownership remains outside this table."
            )
        },
    )

    channel_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical human_input_im_channels.id reference.",
    )
    provider_user_id: Mapped[str] = mapped_column(
        sa.String(255),
        nullable=False,
        comment="Provider-native user identifier within the owning Channel.",
    )
    raw_payload: Mapped[IMIdentityRawPayload] = mapped_column(
        FrozenPydanticModelColumn(IMIdentityRawPayload),
        nullable=False,
        comment="Latest opaque Provider payload retained for diagnostics.",
    )
    last_seen_sync_run_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical human_input_im_sync_runs.id reference for the latest observation.",
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        comment="Timestamp of the latest successful Provider observation.",
    )
    display_name: Mapped[str | None] = mapped_column(
        sa.String(255),
        nullable=True,
        default=None,
        comment="Latest canonical non-blank Provider display name.",
    )
    normalized_name: Mapped[str | None] = mapped_column(
        sa.String(255),
        nullable=True,
        default=None,
        comment="Canonical display name used by persistence queries.",
    )
    email: Mapped[str | None] = mapped_column(
        sa.String(320),
        nullable=True,
        default=None,
        comment="Latest canonical non-blank Provider email.",
    )
    normalized_email: Mapped[str | None] = mapped_column(
        sa.String(320),
        nullable=True,
        default=None,
        comment="Canonical email used by matching and persistence queries.",
    )


class HumanInputIMBinding(DefaultFieldsDCMixin, TypeBase):
    """Default Contact-to-IM-identity Binding for one IM Channel."""

    __tablename__ = "human_input_im_bindings"
    __table_args__ = (
        sa.UniqueConstraint(
            "channel_id",
            "contact_id",
            name="human_input_im_bindings_channel_contact_uq",
        ),
        sa.UniqueConstraint(
            "channel_id",
            "im_identity_id",
            name="human_input_im_bindings_channel_identity_uq",
        ),
        sa.Index("hiimb_contact_idx", "contact_id"),
        sa.Index("hiimb_identity_idx", "im_identity_id"),
        {"comment": "Default Contact-to-IM-identity Bindings for one IM Channel."},
    )

    channel_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical human_input_im_channels.id reference.",
    )
    contact_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical human_input_contact_identities.id reference.",
    )
    im_identity_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical human_input_im_identities.id reference.",
    )
    bound_by_account_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Latest Dify Account that manually selected this Binding, when available.",
    )


class HumanInputIMBindingWorkspaceOverride(DefaultFieldsDCMixin, TypeBase):
    """Workspace-specific override for one default IM Binding."""

    __tablename__ = "human_input_im_workspace_binding_overrides"
    __table_args__ = (
        sa.UniqueConstraint(
            "channel_id",
            "tenant_id",
            "contact_id",
            name="hiimwbo_channel_tenant_contact_uq",
        ),
        sa.UniqueConstraint(
            "channel_id",
            "tenant_id",
            "im_identity_id",
            name="hiimwbo_channel_tenant_identity_uq",
        ),
        sa.Index("hiimwbo_channel_identity_idx", "channel_id", "im_identity_id"),
        {"comment": "Workspace-specific Binding overrides for one IM Channel."},
    )

    channel_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical human_input_im_channels.id reference.",
    )
    tenant_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Target tenants.id whose effective Binding is overridden.",
    )
    contact_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical human_input_contact_identities.id reference.",
    )
    im_identity_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical human_input_im_identities.id reference.",
    )
    bound_by_account_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Dify Account that selected this workspace override.",
    )


__all__ = [
    "HumanInputIMBinding",
    "HumanInputIMBindingWorkspaceOverride",
    "HumanInputIMIdentity",
    "IMIdentityRawPayload",
]
