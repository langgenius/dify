"""Persistence models for retained Human Input v2 Contact, channel, IM sync, and inbox capabilities.

The models use explicit logical owner references where database foreign keys are intentionally absent.
Repository queries must therefore preserve complete owner predicates and explicit loading strategies.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, Field, JsonValue, NaiveDatetime, RootModel, TypeAdapter
from sqlalchemy import orm
from sqlalchemy.orm import Mapped, MappedAsDataclass, mapped_column, relationship

from core.human_input_v2.entities import (
    EmailProviderType as _EmailProviderType,
)
from core.human_input_v2.entities import (
    IMBindingScope as _IMBindingScope,
)
from core.human_input_v2.entities import (
    IMProvider as _IMProvider,
)
from core.human_input_v2.entities import (
    IMSyncRemovalReason as _IMSyncRemovalReason,
)
from core.human_input_v2.entities import (
    IMSyncResultType as _IMSyncResultType,
)
from core.human_input_v2.entities import (
    IMSyncRunStatus as _IMSyncRunStatus,
)
from core.human_input_v2.im_integration.adapters.entities import IMEventIngressKind as _IMEventIngressKind
from core.human_input_v2.im_integration.change_log import (
    IMReconciliationOperation as _IMReconciliationOperation,
)
from core.human_input_v2.im_integration.change_log import (
    IMReconciliationSubjectKind as _IMReconciliationSubjectKind,
)
from core.human_input_v2.im_message_inbox import IM_INBOX_PROVIDER_METADATA_MAX_LENGTH, InboxProcessingStatus
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from repositories.human_input_v2.im_channel_repository import IMChannelStatus

from .base import DefaultFieldsDCMixin, TypeBase
from .types import EnumText, FrozenPydanticModelColumn, LongText, StringUUID


class _ImmutableJSONModel(BaseModel):
    """Strict immutable base for structured JSON persistence values."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)


class _ImmutableJSONObject(RootModel[dict[str, JsonValue]]):
    """Strict immutable base for intentionally opaque JSON object payloads."""

    model_config = ConfigDict(frozen=True, strict=True, validate_default=True)


class IMEncryptedCredentials(BaseModel):
    """Versioned opaque credential envelope persisted for one IM Integration."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    version: Literal[1] = Field(default=1, description="Credential envelope format version.")
    ciphertext: str = Field(
        min_length=1,
        repr=False,
        description="Encrypted complete credential payload.",
    )


class ResendEmailProviderEncryptedCredentials(_ImmutableJSONModel):
    """Encrypted credentials persisted for a Resend email provider."""

    provider: Literal[_EmailProviderType.RESEND] = Field(
        default=_EmailProviderType.RESEND,
        description="Discriminator for Resend encrypted credentials.",
    )
    encrypted_api_key: str = Field(description="Encrypted Resend API key.")


class IMIdentityRawPayload(_ImmutableJSONObject):
    """Opaque provider identity payload retained only for diagnostics."""


class IMSyncDirectoryEntryPayload(_ImmutableJSONObject):
    """Opaque provider directory entry captured by one synchronization run."""


class IMSyncContactSnapshot(_ImmutableJSONModel):
    """Immutable contact values needed to display historical sync results."""

    contact_id: str = Field(description="Contact identifier captured by the sync result.")
    name: str = Field(description="Contact display name captured by the sync result.")
    email: str | None = Field(default=None, description="Contact email captured by the sync result.")
    avatar_file_id: str | None = Field(default=None, description="Avatar file identifier captured by the result.")
    created_at: NaiveDatetime | None = Field(
        default=None,
        description="Contact creation time captured by new results; absent from historical snapshots.",
    )


class IMSyncIdentitySnapshot(_ImmutableJSONModel):
    """Immutable last-known IM identity values retained after removal."""

    identity_id: str = Field(description="IM identity identifier captured by the sync result.")
    provider: _IMProvider = Field(
        strict=False,
        description="Provider that owned the captured IM identity.",
    )
    provider_user_id: str = Field(description="Provider user identifier captured by the sync result.")
    display_name: str | None = Field(default=None, description="Provider display name captured by the result.")
    email: str | None = Field(default=None, description="Provider email captured by the result.")


class IMIdentityReconciliationSnapshot(_ImmutableJSONModel):
    """Minimal current IM identity state retained by the reconciliation change log."""

    subject_kind: Literal[_IMReconciliationSubjectKind.IDENTITY] = _IMReconciliationSubjectKind.IDENTITY
    identity_id: str
    provider: _IMProvider = Field(strict=False)
    provider_user_id: str
    display_name: str | None = None
    email: str | None = None
    normalized_email: str | None = None
    last_seen_sync_run_id: str | None = None


class IMBindingReconciliationSnapshot(_ImmutableJSONModel):
    """Minimal current IM binding state retained by the reconciliation change log."""

    subject_kind: Literal[_IMReconciliationSubjectKind.BINDING] = _IMReconciliationSubjectKind.BINDING
    binding_id: str
    identity_id: str
    contact_id: str


type IMReconciliationChangeSnapshot = Annotated[
    IMIdentityReconciliationSnapshot | IMBindingReconciliationSnapshot,
    Field(discriminator="subject_kind"),
]


_IM_RECONCILIATION_SNAPSHOT_ADAPTER: TypeAdapter[IMReconciliationChangeSnapshot] = TypeAdapter(
    IMReconciliationChangeSnapshot
)


class ContactSubjectType(StrEnum):
    """Immutable Contact subject discriminator, never a current Contact type."""

    ACCOUNT = "account"
    EXTERNAL = "external"


class HumanInputContactIdentity(DefaultFieldsDCMixin, TypeBase):
    """Immutable Contact identity shared by every durable Contact reference.

    Account profile, membership, Platform visibility, and authorization state
    deliberately remain with their source owners. External mutable facts live
    in exactly one ``HumanInputExternalContactProfile``.
    """

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
                "Immutable Human Input Contact identities. Mutable Account and External Contact profile facts "
                "live with their source owners."
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


class HumanInputExternalContactProfile(TypeBase):
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
                "Current workspace-owned External Contact profiles. Deletion removes both this profile and its "
                "Contact identity."
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
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        init=False,
        server_default=sa.func.current_timestamp(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        init=False,
        server_default=sa.func.current_timestamp(),
        onupdate=sa.func.current_timestamp(),
    )

    identity: Mapped[HumanInputContactIdentity] = relationship(
        lambda: HumanInputContactIdentity,
        primaryjoin=lambda: orm.foreign(HumanInputExternalContactProfile.contact_id) == HumanInputContactIdentity.id,
        back_populates="external_profile",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputPlatformContactWorkspaceEntry(DefaultFieldsDCMixin, TypeBase):
    """EE-only workspace allow-list entry for an Organization Account contact.

    The entry does not own the Contact and does not duplicate workspace
    membership or the externally resolved Contact type. Its existence means that
    an EE Organization Account contact without current membership is explicitly
    available in one workspace. The Enterprise Contact repository must ensure the
    referenced Contact is an Account subject. Membership changes never mutate
    the Contact identity.
    """

    __tablename__ = "human_input_platform_contact_workspace_entries"
    __table_args__ = (
        sa.UniqueConstraint(
            "tenant_id",
            "contact_id",
            name="hipcwe_tenant_contact_uq",
        ),
        sa.Index("hipcwe_tenant_created_at_id_idx", "tenant_id", "created_at", "id"),
        sa.Index("hipcwe_contact_id_idx", "contact_id"),
        {
            "comment": (
                "EE-only workspace allow-list for Organization Account contacts. Workspace membership and External "
                "contact ownership must not create rows in this table."
            )
        },
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    contact_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_contact_identities.id."
    )
    added_by_account_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to accounts.id for the administrator who added this directory entry.",
    )


class _IMMessageInboxDefaultFieldsMixin(MappedAsDataclass):
    """Default fields whose update timestamp is controlled by the inbox repository."""

    __abstract__ = True

    id: Mapped[str] = mapped_column(
        StringUUID,
        primary_key=True,
        insert_default=lambda: str(uuidv7()),
        default_factory=lambda: str(uuidv7()),
        init=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        default_factory=naive_utc_now,
        init=False,
        server_default=sa.func.current_timestamp(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        insert_default=naive_utc_now,
        default_factory=naive_utc_now,
        init=False,
        server_default=sa.func.current_timestamp(),
        comment="Repository-owned processing transition timestamp and retry-backoff anchor.",
    )


class IMMessageInbox(_IMMessageInboxDefaultFieldsMixin, TypeBase):
    """Authenticated event facts plus one renewable fenced processing lease.

    ``updated_at`` is the repository-owned processing transition timestamp and
    retry-backoff anchor. It must never be replaced by an automatic database
    clock update because processing policy evaluates application-injected UTC.
    """

    __tablename__ = "im_message_inbox"
    __table_args__ = (
        sa.UniqueConstraint(
            "provider",
            "provider_tenant_id",
            "provider_event_id",
            name="im_message_inbox_provider_event_uq",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name="im_message_inbox_attempt_count_nonnegative",
        ),
        sa.CheckConstraint(
            # Pending work must remain unowned so any eligible worker can claim it.
            "(status = 'pending' AND claim_token IS NULL AND lease_expires_at IS NULL) OR "
            # Active work needs complete lease ownership for fencing and recovery.
            "(status = 'processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR "
            # Finalized work must release ownership so stale workers cannot retain a claim.
            "(status IN ('succeeded', 'ignored', 'failed') AND claim_token IS NULL AND lease_expires_at IS NULL)",
            name=sa.schema.conv("im_message_inbox_processing_state_valid"),
        ),
        sa.Index("im_message_inbox_processing_lease_idx", "status", "lease_expires_at", "id"),
        sa.Index("im_message_inbox_status_created_idx", "status", "created_at", "id"),
        {"comment": "Durable authenticated IM event intake and processing backlog."},
    )

    integration_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        kw_only=True,
        comment="Logical local Integration routing identifier without physical ownership.",
    )
    provider: Mapped[_IMProvider] = mapped_column(
        EnumText(_IMProvider), nullable=False, kw_only=True, comment="Authenticated Provider discriminator."
    )
    provider_tenant_id: Mapped[str] = mapped_column(
        sa.String(IM_INBOX_PROVIDER_METADATA_MAX_LENGTH),
        nullable=False,
        kw_only=True,
        comment="Stable authenticated Provider tenant identifier.",
    )
    provider_event_id: Mapped[str | None] = mapped_column(
        sa.String(IM_INBOX_PROVIDER_METADATA_MAX_LENGTH),
        nullable=True,
        default=None,
        kw_only=True,
        comment="Real Provider event ID when supplied.",
    )
    provider_event_time: Mapped[datetime | None] = mapped_column(
        sa.DateTime, nullable=True, default=None, kw_only=True, comment="Provider event timestamp when supplied."
    )
    received_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, kw_only=True, comment="Dify receive timestamp for this delivery."
    )
    provider_event_type: Mapped[str | None] = mapped_column(
        sa.String(IM_INBOX_PROVIDER_METADATA_MAX_LENGTH),
        nullable=True,
        default=None,
        kw_only=True,
        comment="Provider-owned event discriminator.",
    )
    ingress_kind: Mapped[_IMEventIngressKind] = mapped_column(
        EnumText(_IMEventIngressKind),
        nullable=False,
        kw_only=True,
        comment="Ingress contract used to construct the Provider payload snapshot.",
    )
    payload: Mapped[str] = mapped_column(
        LongText, nullable=False, kw_only=True, comment="Authenticated Provider-native payload."
    )
    status: Mapped[InboxProcessingStatus] = mapped_column(
        EnumText(InboxProcessingStatus),
        nullable=False,
        default=InboxProcessingStatus.PENDING,
        kw_only=True,
        comment="Current processing lifecycle state.",
    )
    attempt_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, kw_only=True, comment="Number of acquired processing leases."
    )
    claim_token: Mapped[str | None] = mapped_column(
        sa.String(64), nullable=True, default=None, kw_only=True, comment="Opaque current lease fencing token."
    )
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime, nullable=True, default=None, kw_only=True, comment="Current processing lease expiry."
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime, nullable=True, default=None, kw_only=True, comment="Terminal transition timestamp."
    )


class HumanInputEmailProvider(DefaultFieldsDCMixin, TypeBase):
    """Single workspace-level email provider used for Human Input delivery."""

    __tablename__ = "human_input_email_providers"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", name="human_input_email_providers_tenant_uq"),
        {"comment": "Workspace-level Human Input email delivery configuration."},
    )

    provider: Mapped[_EmailProviderType] = mapped_column(
        EnumText(_EmailProviderType), nullable=False, comment="Configured email provider discriminator."
    )
    sender_email: Mapped[str] = mapped_column(
        sa.String(320), nullable=False, comment="Configured sender email address."
    )
    encrypted_credentials: Mapped[ResendEmailProviderEncryptedCredentials] = mapped_column(
        FrozenPydanticModelColumn(ResendEmailProviderEncryptedCredentials),
        nullable=False,
        comment="Encrypted Resend credential Pydantic model stored as JSON.",
    )
    tenant_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to tenants.id.",
    )
    config_version: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        default=1,
        comment="Monotonic Email configuration revision used for compare-and-swap.",
    )
    sender_name: Mapped[str] = mapped_column(
        sa.String(255), nullable=False, default="", comment="Optional sender display name."
    )
    configured_by_account_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to accounts.id for the latest configuration write.",
    )


class HumanInputIMChannel(DefaultFieldsDCMixin, TypeBase):
    """One current IM Channel in a repository-generated owner slot.

    ``owner_key`` deliberately replaces a polymorphic database foreign key.
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
        sa.CheckConstraint(
            "config_version > 0",
            name=sa.schema.conv("human_input_im_channels_config_version_positive_ck"),
        ),
        {
            "comment": (
                "Current owner-scoped Human Input IM Channel configuration. "
                "Directory, Binding, Sync, and inbox records remain separately owned."
            )
        },
    )

    owner_key: Mapped[str] = mapped_column(
        sa.String(50),
        nullable=False,
        comment="Canonical owner slot: workspace:<tenant_id> or deployment.",
    )
    provider: Mapped[_IMProvider] = mapped_column(
        EnumText(_IMProvider),
        nullable=False,
        comment="Configured IM provider discriminator.",
    )
    provider_tenant_id: Mapped[str] = mapped_column(
        sa.String(255),
        nullable=False,
        comment="Confirmed provider-side organization, tenant, or workspace identifier.",
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
    config_version: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        default=1,
        comment="Monotonic numeric version paired with the Channel ID for CAS.",
    )
    configured_by_account_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Latest configuring Dify Account; null for deployment-owned writes.",
    )
    status_reason: Mapped[str | None] = mapped_column(
        LongText,
        nullable=True,
        default=None,
        comment="Operator-safe status explanation without provider payload or credentials.",
    )


class HumanInputIMIdentity(DefaultFieldsDCMixin, TypeBase):
    """Durable provider identity discovered by manual directory synchronization.

    Searchable and match-critical fields are stored in columns. ``raw_payload``
    retains the provider response for diagnostics without making it query state.
    An identity absent from the current provider directory is deleted after its
    last-known snapshot is written to the synchronization result.
    """

    __tablename__ = "human_input_im_identities"
    __table_args__ = (
        sa.UniqueConstraint(
            "integration_id",
            "provider",
            "provider_user_id",
            name="human_input_im_identities_integration_provider_user_uq",
        ),
        sa.CheckConstraint(
            "email IS NOT NULL OR normalized_email IS NULL",
            name="email_normalization_pair",
        ),
        sa.Index("hiimi_integration_provider_email_idx", "integration_id", "provider", "normalized_email"),
        sa.Index("hiimi_integration_provider_name_idx", "integration_id", "provider", "normalized_name"),
        sa.Index("hiimi_integration_last_seen_run_idx", "integration_id", "last_seen_sync_run_id"),
        {"comment": "Synchronized IM directory identities available for contact binding."},
    )

    integration_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_im_integrations.id.",
    )
    provider: Mapped[_IMProvider] = mapped_column(
        EnumText(_IMProvider), nullable=False, comment="Provider that owns the external identity."
    )
    provider_user_id: Mapped[str] = mapped_column(
        sa.String(255),
        nullable=False,
        comment="External provider user identifier used for first-pass matching; not a logical foreign key.",
    )
    display_name: Mapped[str | None] = mapped_column(
        sa.String(255), nullable=True, default=None, comment="Latest provider display name."
    )
    normalized_name: Mapped[str | None] = mapped_column(
        sa.String(255), nullable=True, default=None, comment="Lower-cased provider display name for prefix search."
    )
    email: Mapped[str | None] = mapped_column(
        sa.String(320), nullable=True, default=None, comment="Latest provider email, when available."
    )
    normalized_email: Mapped[str | None] = mapped_column(
        sa.String(320),
        nullable=True,
        default=None,
        comment="Full lower-cased provider email used for fallback matching.",
    )
    raw_payload: Mapped[IMIdentityRawPayload] = mapped_column(
        FrozenPydanticModelColumn(IMIdentityRawPayload),
        nullable=False,
        default_factory=lambda: IMIdentityRawPayload({}),
        comment="Latest provider payload Pydantic model retained as non-query diagnostic data.",
    )
    last_seen_sync_run_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to human_input_im_sync_runs.id for the run that last observed this identity.",
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime, nullable=True, default=None, comment="Timestamp when the identity was last observed."
    )

    bindings: Mapped[list[HumanInputIMBinding]] = relationship(
        lambda: HumanInputIMBinding,
        primaryjoin=lambda: HumanInputIMIdentity.id == orm.foreign(HumanInputIMBinding.im_identity_id),
        back_populates="identity",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputIMBinding(DefaultFieldsDCMixin, TypeBase):
    """Current association between a contact and a synchronized IM identity.

    ``scope_id`` is always non-null: it references the owning IM integration for
    an organization binding and the target tenant for a workspace override. This
    avoids relying on dialect-specific uniqueness semantics for nullable columns.
    """

    __tablename__ = "human_input_im_bindings"
    __table_args__ = (
        sa.UniqueConstraint(
            "scope",
            "scope_id",
            "contact_id",
            "provider",
            name="human_input_im_bindings_scope_contact_provider_uq",
        ),
        sa.UniqueConstraint("scope", "scope_id", "im_identity_id", name="human_input_im_bindings_scope_identity_uq"),
        sa.CheckConstraint(
            "scope <> 'organization' OR scope_id = integration_id",
            name="organization_scope_owner",
        ),
        sa.Index(
            "hiimb_integration_contact_provider_scope_idx",
            "integration_id",
            "contact_id",
            "provider",
            "scope",
            "scope_id",
        ),
        sa.Index("hiimb_identity_scope_idx", "im_identity_id", "scope", "scope_id"),
        {"comment": "Current organization binding or workspace override for a contact IM identity."},
    )

    integration_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment=(
            "Logical foreign key to human_input_im_integrations.id; "
            "must match the integration that owns im_identity_id."
        ),
    )
    scope: Mapped[_IMBindingScope] = mapped_column(
        EnumText(_IMBindingScope), nullable=False, comment="Organization binding or workspace override."
    )
    scope_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment=(
            "Polymorphic logical foreign key selected by scope: human_input_im_integrations.id for ORGANIZATION; "
            "tenants.id for WORKSPACE."
        ),
    )
    contact_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_contact_identities.id."
    )
    im_identity_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_im_identities.id."
    )
    provider: Mapped[_IMProvider] = mapped_column(
        EnumText(_IMProvider), nullable=False, comment="Denormalized provider used by effective-binding queries."
    )
    bound_by_account_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to accounts.id for the administrator who created the override.",
    )

    identity: Mapped[HumanInputIMIdentity] = relationship(
        lambda: HumanInputIMIdentity,
        primaryjoin=lambda: orm.foreign(HumanInputIMBinding.im_identity_id) == HumanInputIMIdentity.id,
        back_populates="bindings",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputIMSyncRun(DefaultFieldsDCMixin, TypeBase):
    """One manually triggered organization IM directory synchronization.

    Preventing parallel queued or running rows is a service transaction invariant:
    lock the owning integration row before creating a run. A portable partial
    unique index is deliberately not used. A worker may apply current identities
    and bindings only while ``integration_config_version`` still matches the
    owning integration.
    """

    __tablename__ = "human_input_im_sync_runs"
    __table_args__ = (
        sa.CheckConstraint("integration_config_version > 0", name="captured_version_positive"),
        sa.CheckConstraint(
            "added_count >= 0 AND not_matched_count >= 0 AND failed_count >= 0 AND removed_count >= 0 "
            "AND skipped_count >= 0",
            name="result_counts_nonnegative",
        ),
        sa.Index("hiimsr_integration_created_idx", "integration_id", "created_at", "id"),
        sa.Index("hiimsr_integration_status_created_idx", "integration_id", "status", "created_at"),
        {"comment": "Manual IM directory synchronization lifecycle and aggregate counts."},
    )

    integration_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_im_integrations.id."
    )
    integration_config_version: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        comment="Integration configuration revision captured when this synchronization was created.",
    )
    provider: Mapped[_IMProvider] = mapped_column(
        EnumText(_IMProvider), nullable=False, comment="Provider snapshot used by this synchronization."
    )
    status: Mapped[_IMSyncRunStatus] = mapped_column(
        EnumText(_IMSyncRunStatus), nullable=False, comment="Current synchronization lifecycle state."
    )
    added_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, comment="Number of entries newly matched and bound."
    )
    not_matched_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, comment="Number of entries requiring later manual handling."
    )
    failed_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, comment="Number of entries that failed reconciliation."
    )
    removed_count: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        default=0,
        comment="Number of removed binding facts, including one unbound-identity fact when applicable.",
    )
    skipped_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, comment="Number of entries intentionally skipped."
    )
    started_by_account_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to accounts.id for the administrator who started this run.",
    )
    started_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime, nullable=True, default=None, comment="Timestamp when a worker started processing the run."
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime, nullable=True, default=None, comment="Terminal completion timestamp."
    )
    error_code: Mapped[str | None] = mapped_column(
        sa.String(100), nullable=True, default=None, comment="Machine-readable terminal failure code."
    )
    error_message: Mapped[str | None] = mapped_column(
        LongText, nullable=True, default=None, comment="Operator-safe terminal failure summary."
    )

    results: Mapped[list[HumanInputIMSyncResult]] = relationship(
        lambda: HumanInputIMSyncResult,
        primaryjoin=lambda: HumanInputIMSyncRun.id == orm.foreign(HumanInputIMSyncResult.sync_run_id),
        back_populates="sync_run",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputIMSyncResult(DefaultFieldsDCMixin, TypeBase):
    """Immutable reconciliation result for one entry, removed binding, or diagnostic.

    Provider identifiers and normalized email remain queryable columns. JSON is
    limited to the raw provider input and immutable display snapshots.
    """

    __tablename__ = "human_input_im_sync_results"
    __table_args__ = (
        sa.UniqueConstraint(
            "sync_run_id",
            "operation_key",
            name="human_input_im_sync_results_run_operation_uq",
        ),
        sa.Index("hiimsres_run_type_created_idx", "sync_run_id", "result_type", "created_at", "id"),
        sa.Index("hiimsres_integration_contact_created_idx", "integration_id", "contact_id", "created_at"),
        sa.Index("hiimsres_integration_identity_created_idx", "integration_id", "im_identity_id", "created_at"),
        {"comment": "Append-only per-entry, removed-binding, and diagnostic IM synchronization outcomes."},
    )

    integration_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment=(
            "Denormalized logical foreign key to human_input_im_integrations.id; "
            "must match the integration referenced by sync_run_id."
        ),
    )
    sync_run_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_im_sync_runs.id."
    )
    result_type: Mapped[_IMSyncResultType] = mapped_column(
        EnumText(_IMSyncResultType), nullable=False, comment="Stable result bucket used by pagination."
    )
    operation_key: Mapped[str | None] = mapped_column(
        sa.String(255),
        nullable=True,
        default=None,
        comment="Deterministic run-local idempotency key; null only for historical results.",
    )
    provider_user_id: Mapped[str | None] = mapped_column(
        sa.String(255),
        nullable=True,
        default=None,
        comment="External provider user identifier observed for this result; not a logical foreign key.",
    )
    display_name: Mapped[str | None] = mapped_column(
        sa.String(255), nullable=True, default=None, comment="Provider display name observed for this result."
    )
    email: Mapped[str | None] = mapped_column(
        sa.String(320), nullable=True, default=None, comment="Provider email observed for this result."
    )
    normalized_email: Mapped[str | None] = mapped_column(
        sa.String(320), nullable=True, default=None, comment="Lower-cased provider email used during matching."
    )
    contact_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to human_input_contact_identities.id, when a contact was matched.",
    )
    im_identity_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment=(
            "Historical logical foreign key to human_input_im_identities.id; the target row may be deleted after sync."
        ),
    )
    im_binding_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment=(
            "Historical logical foreign key to human_input_im_bindings.id; the target row may be deleted or replaced."
        ),
    )
    removal_reason: Mapped[_IMSyncRemovalReason | None] = mapped_column(
        EnumText(_IMSyncRemovalReason),
        nullable=True,
        default=None,
        comment="Stable removal reason for removed results only.",
    )
    reason_code: Mapped[str | None] = mapped_column(
        sa.String(100), nullable=True, default=None, comment="Machine-readable failure, skip, or mismatch reason."
    )
    reason_message: Mapped[str | None] = mapped_column(
        LongText, nullable=True, default=None, comment="Operator-safe detail for diagnostics."
    )
    directory_entry_payload: Mapped[IMSyncDirectoryEntryPayload | None] = mapped_column(
        FrozenPydanticModelColumn(IMSyncDirectoryEntryPayload),
        nullable=True,
        default=None,
        comment="Immutable provider entry payload Pydantic model observed during this run.",
    )
    contact_snapshot: Mapped[IMSyncContactSnapshot | None] = mapped_column(
        FrozenPydanticModelColumn(IMSyncContactSnapshot),
        nullable=True,
        default=None,
        comment="Immutable contact snapshot Pydantic model used for historical display.",
    )
    identity_snapshot: Mapped[IMSyncIdentitySnapshot | None] = mapped_column(
        FrozenPydanticModelColumn(IMSyncIdentitySnapshot),
        nullable=True,
        default=None,
        comment="Immutable last-known IM identity Pydantic model for removed results.",
    )

    sync_run: Mapped[HumanInputIMSyncRun] = relationship(
        lambda: HumanInputIMSyncRun,
        primaryjoin=lambda: orm.foreign(HumanInputIMSyncResult.sync_run_id) == HumanInputIMSyncRun.id,
        back_populates="results",
        viewonly=True,
        lazy="raise",
        init=False,
    )
    identity: Mapped[HumanInputIMIdentity | None] = relationship(
        lambda: HumanInputIMIdentity,
        primaryjoin=lambda: orm.foreign(HumanInputIMSyncResult.im_identity_id) == HumanInputIMIdentity.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    binding: Mapped[HumanInputIMBinding | None] = relationship(
        lambda: HumanInputIMBinding,
        primaryjoin=lambda: orm.foreign(HumanInputIMSyncResult.im_binding_id) == HumanInputIMBinding.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputIMReconciliationChange(DefaultFieldsDCMixin, TypeBase):
    """Append-only before/after fact for one committed identity or IM binding mutation."""

    __tablename__ = "human_input_im_reconciliation_changes"
    __table_args__ = (
        sa.UniqueConstraint(
            "sync_run_id",
            "operation_key",
            name="human_input_im_reconciliation_changes_run_operation_uq",
        ),
        sa.CheckConstraint(
            "before_snapshot IS NOT NULL OR after_snapshot IS NOT NULL",
            name="snapshot_present",
        ),
        sa.CheckConstraint(
            "(operation = 'create' AND before_snapshot IS NULL AND after_snapshot IS NOT NULL) OR "
            "(operation = 'delete' AND before_snapshot IS NOT NULL AND after_snapshot IS NULL) OR "
            "(operation NOT IN ('create', 'delete') AND before_snapshot IS NOT NULL AND after_snapshot IS NOT NULL)",
            name="snapshot_operation_shape",
        ),
        sa.CheckConstraint(
            "(subject_kind = 'identity' AND im_binding_id IS NULL) OR "
            "(subject_kind = 'binding' AND im_binding_id IS NOT NULL)",
            name="subject_identifier_shape",
        ),
        sa.Index("hiimrc_run_subject_committed_idx", "sync_run_id", "subject_kind", "committed_at", "id"),
        sa.Index("hiimrc_integration_committed_idx", "integration_id", "committed_at", "id"),
        {"comment": "Append-only IM identity and IM binding reconciliation mutation history."},
    )

    integration_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_im_integrations.id."
    )
    sync_run_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_im_sync_runs.id."
    )
    operation_key: Mapped[str] = mapped_column(
        sa.String(255), nullable=False, comment="Deterministic run-local idempotency key."
    )
    subject_kind: Mapped[_IMReconciliationSubjectKind] = mapped_column(
        EnumText(_IMReconciliationSubjectKind), nullable=False
    )
    operation: Mapped[_IMReconciliationOperation] = mapped_column(EnumText(_IMReconciliationOperation), nullable=False)
    reason_code: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    im_identity_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    committed_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False)
    im_binding_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    contact_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    before_snapshot: Mapped[IMReconciliationChangeSnapshot | None] = mapped_column(
        FrozenPydanticModelColumn(
            _IM_RECONCILIATION_SNAPSHOT_ADAPTER,
            model_types=(IMIdentityReconciliationSnapshot, IMBindingReconciliationSnapshot),
        ),
        nullable=True,
        default=None,
    )
    after_snapshot: Mapped[IMReconciliationChangeSnapshot | None] = mapped_column(
        FrozenPydanticModelColumn(
            _IM_RECONCILIATION_SNAPSHOT_ADAPTER,
            model_types=(IMIdentityReconciliationSnapshot, IMBindingReconciliationSnapshot),
        ),
        nullable=True,
        default=None,
    )


__all__ = [
    "ContactSubjectType",
    "HumanInputContactIdentity",
    "HumanInputEmailProvider",
    "HumanInputExternalContactProfile",
    "HumanInputIMBinding",
    "HumanInputIMChannel",
    "HumanInputIMIdentity",
    "HumanInputIMReconciliationChange",
    "HumanInputIMSyncResult",
    "HumanInputIMSyncRun",
    "HumanInputPlatformContactWorkspaceEntry",
    "IMBindingReconciliationSnapshot",
    "IMEncryptedCredentials",
    "IMIdentityRawPayload",
    "IMIdentityReconciliationSnapshot",
    "IMMessageInbox",
    "IMReconciliationChangeSnapshot",
    "IMSyncContactSnapshot",
    "IMSyncDirectoryEntryPayload",
    "IMSyncIdentitySnapshot",
    "ResendEmailProviderEncryptedCredentials",
]
