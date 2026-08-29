"""Reference declarative schema for the Contact identity and profile proposal.

This file is an OpenSpec artifact and is not imported by the application.

Invariants:
1. ``human_input_contact_identities`` stores Contact identity only.
2. Account subjects require ``account_id``; External subjects forbid it.
3. External workspace ownership lives only on its one-to-one current profile.
4. Deleting an External Contact removes its profile and identity atomically.
5. WORKSPACE, PLATFORM, EXTERNAL remain query resolutions.
6. Every durable ``contact_id`` continues to target ``human_input_contact_identities.id``.
7. One Account maps to one globally unique Contact identity.
8. Workspace access is enforced by membership、Platform visibility or External
   Contact profile ownership predicates; possession of a Contact ID grants no access.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import orm
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    MappedAsDataclass,
    mapped_column,
    relationship,
)

from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.types import EnumText, StringUUID


class ContactSubjectType(StrEnum):
    """Immutable subject discriminator; never serialized as Contact resolution."""

    ACCOUNT = "account"
    EXTERNAL = "external"


class HumanInputContactIdentity(TypeBase):
    """Immutable Contact identity shared by every durable Contact reference."""

    __tablename__ = "human_input_contact_identities"
    __table_args__ = (
        sa.CheckConstraint(
            "(subject_type = 'account' AND account_id IS NOT NULL) OR "
            "(subject_type = 'external' AND account_id IS NULL)",
            name="human_input_contact_identities_subject_type_ck",
        ),
        sa.UniqueConstraint(
            "account_id",
            name="human_input_contact_identities_account_id_uq",
        ),
        {
            "comment": (
                "Immutable Human Input Contact identities. Mutable Account and External "
                "Contact profile facts live with their source owners."
            )
        },
    )

    subject_type: Mapped[ContactSubjectType] = mapped_column(
        EnumText(ContactSubjectType),
        nullable=False,
        comment="Immutable Account or External subject discriminator.",
    )
    account_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical accounts.id reference for Account subjects only.",
    )

    external_profile: Mapped[HumanInputExternalContactProfile | None] = relationship(
        lambda: HumanInputExternalContactProfile,
        primaryjoin=lambda: sa.and_(
            HumanInputContactIdentity.id == orm.foreign(HumanInputExternalContactProfile.contact_id),
            HumanInputContactIdentity.subject_type == ContactSubjectType.EXTERNAL,
        ),
        back_populates="identity",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputExternalContactProfile(DefaultFieldsMixin, TypeBase):
    """Current workspace-owned profile for one External Contact identity."""

    __tablename__ = "human_input_external_contact_profiles"
    __table_args__ = (
        sa.UniqueConstraint(
            "tenant_id",
            "normalized_email",
            name="hiecp_tenant_normalized_email_uq",
        ),
        sa.Index(
            "hiecp_tenant_normalized_name_idx",
            "tenant_id",
            "normalized_name",
        ),
        {
            "comment": (
                "Current workspace-owned External Contact profiles. Deletion removes "
                "both this profile and its Contact identity."
            )
        },
    )

    contact_id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        comment="Logical human_input_contact_identities.id reference for one External subject.",
    )
    tenant_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Owning tenants.id used by every current External Contact lookup.",
    )
    name: Mapped[str] = mapped_column(
        sa.String(255),
        nullable=False,
        comment="Workspace-managed display name.",
    )
    normalized_name: Mapped[str] = mapped_column(
        sa.String(255),
        nullable=False,
        comment="Canonical search value maintained by External Contact writes.",
    )
    email: Mapped[str] = mapped_column(
        sa.String(320),
        nullable=False,
        comment="Workspace-managed deliverable Email address.",
    )
    normalized_email: Mapped[str] = mapped_column(
        sa.String(320),
        nullable=False,
        comment="Canonical Email equality value maintained by External Contact writes.",
    )
    avatar_file_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical upload_files.id reference owned by the same workspace.",
    )


@dataclass(frozen=True, slots=True)
class ContactReference:
    """One logical reference to ``human_input_contact_identities.id``."""

    table_name: str
    column_name: str
    nullable: bool
    role: str


CONTACT_REFERENCES: tuple[ContactReference, ...] = (
    ContactReference(
        "human_input_platform_contact_workspace_entries",
        "contact_id",
        False,
        "current Platform visibility",
    ),
    ContactReference(
        "human_input_im_bindings",
        "contact_id",
        False,
        "current Organization binding or workspace override",
    ),
    ContactReference(
        "human_input_im_sync_results",
        "contact_id",
        True,
        "historical synchronization result",
    ),
    ContactReference(
        "human_input_im_reconciliation_changes",
        "contact_id",
        True,
        "historical reconciliation mutation",
    ),
    ContactReference(
        "human_input_v2_form_approver_grants",
        "contact_id",
        True,
        "frozen form approval subject",
    ),
    ContactReference(
        "human_input_v2_form_otp_challenges",
        "contact_id",
        True,
        "captured Contact proof subject",
    ),
)


__all__ = [
    "CONTACT_REFERENCES",
    "ContactReference",
    "ContactSubjectType",
    "HumanInputContactIdentity",
    "HumanInputExternalContactProfile",
]
