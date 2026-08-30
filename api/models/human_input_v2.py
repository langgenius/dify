"""Persistence models for Human Input v2 IM intake, delivery, and approval runtime.

The models intentionally use logical references instead of database foreign keys.
Every relationship therefore requires an explicit eager-loading strategy, and
authorization code must scope queries by the owning directory or tenant. Column
comments name the referenced ``table.column`` for every logical foreign key.
Human Input v2 forms and every form-scoped child use a dedicated table namespace;
they never reference the legacy ``human_input_forms`` aggregate. Runtime forms
bind to the shared workflow pause infrastructure through ``workflow_pause_id``.
IM child rows use their integration as the concrete persistence boundary.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, Field, JsonValue, NaiveDatetime, RootModel, TypeAdapter
from sqlalchemy import orm
from sqlalchemy.orm import Mapped, MappedAsDataclass, mapped_column, relationship

from core.human_input import ButtonStyle
from core.human_input_v2.approval.recipient_plan import RecipientSourceKind as _RecipientSourceKind
from core.human_input_v2.entities import (
    EmailProviderType as _EmailProviderType,
)
from core.human_input_v2.entities import (
    HumanInputApproverGrantSubjectType as _HumanInputApproverGrantSubjectType,
)
from core.human_input_v2.entities import (
    HumanInputAuthorizationProofType as _HumanInputAuthorizationProofType,
)
from core.human_input_v2.entities import (
    HumanInputDeliveryAttemptStatus as _HumanInputDeliveryAttemptStatus,
)
from core.human_input_v2.entities import (
    HumanInputDeliveryChannel as _HumanInputDeliveryChannel,
)
from core.human_input_v2.entities import (
    HumanInputOTPChallengeStatus as _HumanInputOTPChallengeStatus,
)
from core.human_input_v2.entities import (
    HumanInputSubmissionActorType as _HumanInputSubmissionActorType,
)
from core.human_input_v2.entities import (
    HumanInputV2FormKind as _HumanInputV2FormKind,
)
from core.human_input_v2.entities import (
    HumanInputV2FormStatus as _HumanInputV2FormStatus,
)
from core.human_input_v2.entities import (
    IMBindingScope as _IMBindingScope,
)
from core.human_input_v2.entities import (
    IMIntegrationStatus as _IMIntegrationStatus,
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
from graphon.file.enums import FileTransferMethod, FileType
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7

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


class FormApproverGrantMatchedSource(_ImmutableJSONModel):
    """One ordered recipient source retained by a historical grant."""

    kind: _RecipientSourceKind = Field(strict=False, description="Stable recipient source discriminator.")
    position: int = Field(ge=0, description="Original recipient configuration position.")
    reference: str | None = Field(default=None, description="Saved source reference when one existed.")


class FormApproverGrantMatchedSources(_ImmutableJSONModel):
    """Immutable recipient sources merged into one form approver grant."""

    sources: tuple[FormApproverGrantMatchedSource, ...] = Field(
        default_factory=tuple,
        strict=False,
        description="Ordered recipient source snapshots merged into this approver grant.",
    )


class FormApproverGrantSubjectSnapshot(_ImmutableJSONModel):
    """Minimal subject values retained after the current identity changes or is deleted."""

    display_name: str | None = Field(default=None, description="Subject display name resolved when the grant was made.")
    email: str | None = Field(default=None, description="Subject email resolved when the grant was made.")


class AccountSessionAuthorizationProof(_ImmutableJSONModel):
    """Successful account-session verification without retaining reusable session credentials."""

    type: Literal[_HumanInputAuthorizationProofType.ACCOUNT_SESSION] = Field(
        default=_HumanInputAuthorizationProofType.ACCOUNT_SESSION,
        description="Discriminator for account-session authorization evidence.",
    )
    account_id: str = Field(description="Current Dify Account authenticated by the verified session.")


class EmailOTPAuthorizationProof(_ImmutableJSONModel):
    """Successful Email verification retained without plaintext or hash material."""

    type: Literal[_HumanInputAuthorizationProofType.EMAIL_OTP] = Field(
        default=_HumanInputAuthorizationProofType.EMAIL_OTP,
        description="Discriminator for email OTP authorization evidence.",
    )
    otp_challenge_id: str = Field(description="Historical Human Input OTP challenge identifier.")
    tenant_id: str = Field(description="Dify Tenant owner captured by the verified challenge form reference.")
    form_id: str = Field(description="Human Input v2 form identifier scoped by the verified challenge.")
    approver_grant_id: str = Field(description="Approver grant identifier scoped by the verified challenge.")
    subject_type: _HumanInputApproverGrantSubjectType = Field(
        strict=False,
        description="Contact or standalone Email subject verified by the challenge.",
    )
    contact_id: str | None = Field(
        default=None,
        description="Contact incarnation captured for a contact-backed proof.",
    )
    verified_email: str = Field(description="Normalized Email address verified by the challenge.")
    verified_at: datetime = Field(description="Timestamp at which the challenge verified the Email address.")


class IMIdentityAuthorizationProof(_ImmutableJSONModel):
    """Resolved IM identity and binding evidence that survives deletion of current IM rows."""

    type: Literal[_HumanInputAuthorizationProofType.IM_IDENTITY] = Field(
        default=_HumanInputAuthorizationProofType.IM_IDENTITY,
        description="Discriminator for IM identity authorization evidence.",
    )
    integration_id: str = Field(description="Historical Human Input IM integration identifier.")
    im_identity_id: str = Field(description="Historical Human Input IM identity identifier.")
    im_binding_id: str | None = Field(
        default=None,
        description="Current effective binding identifier, or null for Email fallback.",
    )
    provider: _IMProvider = Field(strict=False, description="IM provider that authenticated the external identity.")
    provider_tenant_id: str = Field(description="Provider organization or workspace identifier.")
    provider_user_id: str = Field(description="Provider user identifier verified by the IM interaction.")
    display_name: str | None = Field(default=None, description="Provider display name captured at authorization time.")
    email: str | None = Field(default=None, description="Provider email captured at authorization time.")


class TrustedEndUserAuthorizationProof(_ImmutableJSONModel):
    """Trusted app-token context used to authenticate one request-scoped end user."""

    type: Literal[_HumanInputAuthorizationProofType.TRUSTED_END_USER] = Field(
        default=_HumanInputAuthorizationProofType.TRUSTED_END_USER,
        description="Discriminator for trusted end-user authorization evidence.",
    )
    app_id: str = Field(description="Application whose trusted context authenticated the end user.")
    end_user_id: str = Field(description="Current EndUser authenticated by the trusted app context.")


type FormAuthorizationProof = Annotated[
    AccountSessionAuthorizationProof
    | EmailOTPAuthorizationProof
    | IMIdentityAuthorizationProof
    | TrustedEndUserAuthorizationProof,
    Field(discriminator="type"),
]


_FORM_AUTHORIZATION_PROOF_ADAPTER: TypeAdapter[FormAuthorizationProof] = TypeAdapter(FormAuthorizationProof)


class FormDeliveryProviderResponse(_ImmutableJSONObject):
    """Opaque provider delivery response retained only for diagnostics."""


class ResolvedFormMarkdownText(_ImmutableJSONModel):
    type: Literal["markdown"] = "markdown"
    text: str


class ResolvedFormParagraphInput(_ImmutableJSONModel):
    type: Literal["paragraph"] = "paragraph"
    output_variable_name: str
    # Populated only when a default value is configured; otherwise None.
    default_value: str | None = None


class ResolvedFormSelectInput(_ImmutableJSONModel):
    type: Literal["select"] = "select"
    output_variable_name: str
    options: tuple[str, ...] = ()
    # Populated only when a default value is configured; otherwise None.
    default_value: str | None = None


class ResolvedFormFileInput(_ImmutableJSONModel):
    type: Literal["file"] = "file"
    output_variable_name: str
    allowed_file_types: tuple[FileType, ...] = ()
    allowed_file_extensions: tuple[str, ...] = ()
    allowed_file_upload_methods: tuple[FileTransferMethod, ...] = ()


class ResolvedFormFileListInput(_ImmutableJSONModel):
    type: Literal["file-list"] = "file-list"
    output_variable_name: str
    allowed_file_types: tuple[FileType, ...] = ()
    allowed_file_extensions: tuple[str, ...] = ()
    allowed_file_upload_methods: tuple[FileTransferMethod, ...] = ()
    number_limits: int


type ResolvedFormBlock = Annotated[
    ResolvedFormMarkdownText
    | ResolvedFormParagraphInput
    | ResolvedFormSelectInput
    | ResolvedFormFileInput
    | ResolvedFormFileListInput,
    Field(discriminator="type"),
]


class ResolvedFormAction(_ImmutableJSONModel):
    id: str
    title: str
    button_style: ButtonStyle


class HumanInputV2FormDefinition(_ImmutableJSONModel):
    """Resolved presentation snapshot stored in the existing form_definition column."""

    title: str | None = None
    blocks: tuple[ResolvedFormBlock, ...] = ()
    user_actions: tuple[ResolvedFormAction, ...] = ()
    display_in_ui: bool | None = Field(
        default=None,
        description="Whether runtime surfaces should expose the form in their UI.",
    )


class FormInputSnapshot(_ImmutableJSONObject):
    """Unvalidated raw values from the request ``inputs`` object only."""


class FormCanonicalValues(_ImmutableJSONObject):
    """Validated runtime values persisted using current Segment serialization."""


class FormAuditEventPayload(_ImmutableJSONObject):
    """Event-specific immutable audit context not used for primary queries."""


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


class HumanInputIMIntegration(DefaultFieldsDCMixin, TypeBase):
    """Single organization-level IM control-plane configuration.

    The complete credential payload must be protected as one versioned opaque
    envelope before persistence. CE/SaaS rows are tenant-scoped. EE uses a null
    ``tenant_id`` because the deployment is the conceptual Organization boundary;
    creation must lock the stable ``DifySetup`` owner before checking for an
    existing null-owned row. Configuration writes use ``config_version`` for
    explicit compare-and-swap; connectivity diagnostics do not advance that
    revision. Asynchronous work must capture the revision that produced it and
    reject stale current-state writes.
    """

    __tablename__ = "human_input_im_integrations"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", name="human_input_im_integrations_tenant_uq"),
        sa.CheckConstraint("config_version > 0", name="config_version_positive"),
        {"comment": "Organization-level Human Input IM integration configuration."},
    )

    provider: Mapped[_IMProvider] = mapped_column(
        EnumText(_IMProvider), nullable=False, comment="Configured IM provider discriminator."
    )
    encrypted_credentials: Mapped[IMEncryptedCredentials] = mapped_column(
        FrozenPydanticModelColumn(IMEncryptedCredentials),
        nullable=False,
        comment="Versioned opaque encrypted IM credential envelope stored as JSON.",
    )
    tenant_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to tenants.id in CE/SaaS; null for the EE deployment-wide integration.",
    )
    provider_tenant_id: Mapped[str] = mapped_column(
        sa.String(255),
        nullable=False,
        kw_only=True,
        comment=(
            "Provider-side Organization or workspace identity. Credential rotation preserves current identities and "
            "bindings only when the provider adapter confirms this value is unchanged."
        ),
    )
    app_identifier: Mapped[str] = mapped_column(
        sa.String(255),
        nullable=False,
        kw_only=True,
        comment="Safe provider application identifier used by credential-free channel projections.",
    )
    status: Mapped[_IMIntegrationStatus] = mapped_column(
        EnumText(_IMIntegrationStatus),
        nullable=False,
        default=_IMIntegrationStatus.CONFIGURED,
        comment="Last persisted provider connectivity result.",
    )
    config_version: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        default=1,
        comment="Monotonic integration configuration revision used for compare-and-swap and stale-work rejection.",
    )
    configured_by_account_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to accounts.id for the latest configuration write.",
    )
    callback_url: Mapped[str | None] = mapped_column(
        sa.String(1024), nullable=True, default=None, comment="Provider callback URL, when callback delivery is used."
    )
    safe_status_reason: Mapped[str | None] = mapped_column(
        LongText, nullable=True, default=None, comment="Operator-safe connection or permission diagnostic."
    )
    last_checked_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime, nullable=True, default=None, comment="Timestamp of the latest connection validation."
    )

    identities: Mapped[list[HumanInputIMIdentity]] = relationship(
        lambda: HumanInputIMIdentity,
        primaryjoin=lambda: HumanInputIMIntegration.id == orm.foreign(HumanInputIMIdentity.integration_id),
        back_populates="integration",
        viewonly=True,
        lazy="raise",
        init=False,
    )
    sync_runs: Mapped[list[HumanInputIMSyncRun]] = relationship(
        lambda: HumanInputIMSyncRun,
        primaryjoin=lambda: HumanInputIMIntegration.id == orm.foreign(HumanInputIMSyncRun.integration_id),
        back_populates="integration",
        viewonly=True,
        lazy="raise",
        init=False,
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

    integration: Mapped[HumanInputIMIntegration] = relationship(
        lambda: HumanInputIMIntegration,
        primaryjoin=lambda: orm.foreign(HumanInputIMIdentity.integration_id) == HumanInputIMIntegration.id,
        back_populates="identities",
        viewonly=True,
        lazy="raise",
        init=False,
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
    integration: Mapped[HumanInputIMIntegration] = relationship(
        lambda: HumanInputIMIntegration,
        primaryjoin=lambda: orm.foreign(HumanInputIMBinding.integration_id) == HumanInputIMIntegration.id,
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

    integration: Mapped[HumanInputIMIntegration] = relationship(
        lambda: HumanInputIMIntegration,
        primaryjoin=lambda: orm.foreign(HumanInputIMSyncRun.integration_id) == HumanInputIMIntegration.id,
        back_populates="sync_runs",
        viewonly=True,
        lazy="raise",
        init=False,
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


class HumanInputV2Form(DefaultFieldsDCMixin, TypeBase):
    """Independent Human Input v2 form root.

    Runtime forms bind one shared workflow pause to the exact owning
    ``workflow_node_executions`` row. ``node_execution_id`` intentionally names
    the business role while referencing that table's primary key ``id`` rather
    than its separate runtime ``node_execution_id`` column. ``rendered_content``
    stores only the partially resolved v1 compatibility text; ``form_definition``
    stores the authoritative typed v2 presentation snapshot.
    """

    __tablename__ = "human_input_v2_forms"
    __table_args__ = (
        sa.UniqueConstraint("workflow_pause_id", name="hiv2_forms_workflow_pause_uq"),
        sa.UniqueConstraint("node_execution_id", name="hiv2_forms_node_execution_uq"),
        sa.CheckConstraint(
            "form_kind <> 'runtime' OR (workflow_pause_id IS NOT NULL AND node_execution_id IS NOT NULL)",
            name="runtime_owner",
        ),
        sa.Index("hiv2_forms_tenant_status_node_timeout_idx", "tenant_id", "status", "node_timeout_at"),
        sa.Index("hiv2_forms_tenant_status_global_expiry_idx", "tenant_id", "status", "global_expires_at"),
        {"comment": "Independent Human Input v2 form roots bound only to shared workflow pause infrastructure."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to apps.id.")
    form_definition: Mapped[HumanInputV2FormDefinition] = mapped_column(
        FrozenPydanticModelColumn(HumanInputV2FormDefinition),
        nullable=False,
        comment="Resolved Human Input v2 presentation snapshot used for display and submission validation.",
    )
    rendered_content: Mapped[str] = mapped_column(
        LongText,
        nullable=False,
        comment="Partially resolved content retained only for Human Input v1 compatibility.",
    )
    node_timeout_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        comment="Frozen node-level timeout timestamp used to resume through the timeout branch.",
    )
    global_expires_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        comment="Frozen global expiration timestamp after which the form cannot be submitted.",
    )
    form_kind: Mapped[_HumanInputV2FormKind] = mapped_column(
        EnumText(_HumanInputV2FormKind),
        nullable=False,
        default=_HumanInputV2FormKind.RUNTIME,
        comment="Human Input v2 form ownership kind.",
    )
    status: Mapped[_HumanInputV2FormStatus] = mapped_column(
        EnumText(_HumanInputV2FormStatus),
        nullable=False,
        default=_HumanInputV2FormStatus.WAITING,
        comment="Current Human Input v2 form lifecycle state.",
    )
    workflow_pause_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to workflow_pauses.id for the owning shared workflow pause.",
    )
    node_execution_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment=(
            "Logical foreign key to workflow_node_executions.id for the owning node-execution row. "
            "This intentionally does not reference workflow_node_executions.node_execution_id."
        ),
    )

    grants: Mapped[list[HumanInputV2FormApproverGrant]] = relationship(
        lambda: HumanInputV2FormApproverGrant,
        primaryjoin=lambda: HumanInputV2Form.id == orm.foreign(HumanInputV2FormApproverGrant.form_id),
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputV2FormApproverGrant(DefaultFieldsDCMixin, TypeBase):
    """Form-scoped approval authority granted to one canonical business subject.

    Contact-backed grants are revalidated through the current Contact lifecycle.
    End-user and email-address grants cover subjects that intentionally do not
    reference a Contact identity. ``subject_snapshot`` is display-only and
    never substitutes for current-state authorization checks.
    """

    __tablename__ = "human_input_v2_form_approver_grants"
    __table_args__ = (
        sa.UniqueConstraint("form_id", "subject_key", name="hiv2_form_grants_form_subject_uq"),
        sa.CheckConstraint(
            "(subject_type = 'contact' AND contact_id IS NOT NULL AND end_user_id IS NULL "
            "AND normalized_email IS NULL) OR "
            "(subject_type = 'end_user' AND contact_id IS NULL AND end_user_id IS NOT NULL "
            "AND normalized_email IS NULL) OR "
            "(subject_type = 'email_address' AND contact_id IS NULL AND end_user_id IS NULL "
            "AND normalized_email IS NOT NULL)",
            name="subject_identity",
        ),
        sa.Index("hiv2_form_grants_form_contact_idx", "form_id", "contact_id"),
        sa.Index("hiv2_form_grants_form_end_user_idx", "form_id", "end_user_id"),
        sa.Index("hiv2_form_grants_form_email_idx", "form_id", "normalized_email"),
        {"comment": "Frozen Human Input v2 form approval grants resolved from runtime recipients."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_v2_forms.id."
    )
    subject_type: Mapped[_HumanInputApproverGrantSubjectType] = mapped_column(
        EnumText(_HumanInputApproverGrantSubjectType),
        nullable=False,
        comment="Discriminator for the business subject receiving approval authority.",
    )
    subject_key: Mapped[str] = mapped_column(
        sa.String(255),
        nullable=False,
        comment=(
            "Portable deduplication key: contact:<id>, end_user:<id>, or email_address:<sha256(normalized_email)>."
        ),
    )
    matched_sources: Mapped[FormApproverGrantMatchedSources] = mapped_column(
        FrozenPydanticModelColumn(FormApproverGrantMatchedSources),
        nullable=False,
        default_factory=FormApproverGrantMatchedSources,
        comment="Immutable recipient sources merged into this approver grant.",
    )
    subject_snapshot: Mapped[FormApproverGrantSubjectSnapshot] = mapped_column(
        FrozenPydanticModelColumn(FormApproverGrantSubjectSnapshot),
        nullable=False,
        default_factory=FormApproverGrantSubjectSnapshot,
        comment="Minimal display-only subject values captured when the grant was created.",
    )
    contact_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to human_input_contact_identities.id for a contact-backed grant.",
    )
    end_user_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to end_users.id for an app-scoped end-user grant.",
    )
    normalized_email: Mapped[str | None] = mapped_column(
        sa.String(320),
        nullable=True,
        default=None,
        comment="Lower-cased mailbox identity for a one-time email-address grant.",
    )

    form: Mapped[HumanInputV2Form] = relationship(
        lambda: HumanInputV2Form,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormApproverGrant.form_id) == HumanInputV2Form.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    endpoints: Mapped[list[HumanInputV2FormDeliveryEndpoint]] = relationship(
        lambda: HumanInputV2FormDeliveryEndpoint,
        primaryjoin=lambda: (
            HumanInputV2FormApproverGrant.id == orm.foreign(HumanInputV2FormDeliveryEndpoint.approver_grant_id)
        ),
        back_populates="approver_grant",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputV2FormDeliveryEndpoint(DefaultFieldsDCMixin, TypeBase):
    """Immutable delivery or interaction endpoint belonging to one approver grant.

    ``address_hash`` supports portable uniqueness without indexing long recipient
    addresses. Its canonical input must include the channel namespace and, for
    IM endpoints, ``integration_id`` so equal provider user IDs from different
    integrations remain distinct. IM endpoints retain the integration that owns
    their provider identity so later retries cannot resolve through a replacement
    integration. The task-creation application service owns the channel shape:
    Email endpoints set only ``email_address``; IM endpoints set
    ``integration_id``, ``provider``, ``provider_user_id``, and
    ``im_identity_id``. Web and Console endpoints set none of those fields. The
    database intentionally does not duplicate this discriminated-union rule;
    the repository mapper rejects missing or cross-channel persisted fields on
    load. Opaque public form tokens are persisted only as hashes.
    """

    __tablename__ = "human_input_v2_form_delivery_endpoints"
    __table_args__ = (
        sa.UniqueConstraint(
            "form_id",
            "approver_grant_id",
            "channel",
            "address_hash",
            name="hiv2_form_endpoints_grant_channel_address_uq",
        ),
        sa.UniqueConstraint("access_token_hash", name="hiv2_form_endpoints_token_uq"),
        sa.Index("hiv2_form_endpoints_identity_form_idx", "im_identity_id", "form_id"),
        {"comment": "Immutable notification and interaction endpoints for Human Input v2 approver grants."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_v2_forms.id."
    )
    approver_grant_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_v2_form_approver_grants.id.",
    )
    channel: Mapped[_HumanInputDeliveryChannel] = mapped_column(
        EnumText(_HumanInputDeliveryChannel), nullable=False, comment="Delivery or interaction channel."
    )
    address_hash: Mapped[str] = mapped_column(
        sa.String(64), nullable=False, comment="SHA-256 of the canonical channel address used for uniqueness."
    )
    email_address: Mapped[str | None] = mapped_column(
        sa.String(320),
        nullable=True,
        default=None,
        comment="Frozen recipient email address for Email endpoints; null otherwise.",
    )
    integration_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to human_input_im_integrations.id for IM endpoints; null otherwise.",
    )
    provider: Mapped[_IMProvider | None] = mapped_column(
        EnumText(_IMProvider), nullable=True, default=None, comment="IM provider for IM endpoints only."
    )
    provider_user_id: Mapped[str | None] = mapped_column(
        sa.String(255),
        nullable=True,
        default=None,
        comment="Frozen provider-side user identifier for IM endpoints; null otherwise.",
    )
    provider_tenant_id: Mapped[str | None] = mapped_column(
        sa.String(255),
        nullable=True,
        default=None,
        comment="Frozen provider-side tenant identity for IM endpoints; null otherwise.",
    )
    im_identity_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to human_input_im_identities.id.",
    )
    im_binding_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Historical logical foreign key to human_input_im_bindings.id for IM endpoints.",
    )
    access_token_hash: Mapped[str | None] = mapped_column(
        sa.String(64), nullable=True, default=None, comment="SHA-256 hash of an opaque form access token."
    )

    form: Mapped[HumanInputV2Form] = relationship(
        lambda: HumanInputV2Form,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormDeliveryEndpoint.form_id) == HumanInputV2Form.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    approver_grant: Mapped[HumanInputV2FormApproverGrant] = relationship(
        lambda: HumanInputV2FormApproverGrant,
        primaryjoin=lambda: (
            orm.foreign(HumanInputV2FormDeliveryEndpoint.approver_grant_id) == HumanInputV2FormApproverGrant.id
        ),
        back_populates="endpoints",
        viewonly=True,
        lazy="raise",
        init=False,
    )
    attempts: Mapped[list[HumanInputV2FormDeliveryAttempt]] = relationship(
        lambda: HumanInputV2FormDeliveryAttempt,
        primaryjoin=lambda: (
            HumanInputV2FormDeliveryEndpoint.id == orm.foreign(HumanInputV2FormDeliveryAttempt.endpoint_id)
        ),
        back_populates="endpoint",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputV2FormDeliveryAttempt(DefaultFieldsDCMixin, TypeBase):
    """One delivery attempt whose failure never mutates the form status directly."""

    __tablename__ = "human_input_v2_form_delivery_attempts"
    __table_args__ = (
        sa.UniqueConstraint("endpoint_id", "attempt_number", name="hiv2_form_attempts_endpoint_number_uq"),
        sa.Index("hiv2_form_attempts_form_status_created_idx", "form_id", "status", "created_at", "id"),
        sa.Index("hiv2_form_attempts_status_scheduled_idx", "status", "scheduled_at", "id"),
        {"comment": "Append-oriented delivery attempts for Human Input v2 form endpoints."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Denormalized logical foreign key to human_input_v2_forms.id.",
    )
    endpoint_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_v2_form_delivery_endpoints.id."
    )
    attempt_number: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, comment="One-based retry sequence within an endpoint."
    )
    status: Mapped[_HumanInputDeliveryAttemptStatus] = mapped_column(
        EnumText(_HumanInputDeliveryAttemptStatus), nullable=False, comment="Current delivery lifecycle state."
    )
    scheduled_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, comment="Timestamp at which the attempt becomes eligible for processing."
    )
    started_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime, nullable=True, default=None, comment="Timestamp when provider delivery started."
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime, nullable=True, default=None, comment="Terminal delivery timestamp."
    )
    provider_message_id: Mapped[str | None] = mapped_column(
        sa.String(255),
        nullable=True,
        default=None,
        comment="External provider message identifier; not a logical foreign key to a local table.",
    )
    failure_code: Mapped[str | None] = mapped_column(
        sa.String(100), nullable=True, default=None, comment="Machine-readable terminal delivery failure code."
    )
    failure_reason: Mapped[str | None] = mapped_column(
        LongText, nullable=True, default=None, comment="Operator-safe terminal delivery failure detail."
    )
    provider_response: Mapped[FormDeliveryProviderResponse | None] = mapped_column(
        FrozenPydanticModelColumn(FormDeliveryProviderResponse),
        nullable=True,
        default=None,
        comment="Immutable provider response Pydantic model retained for diagnostics.",
    )

    form: Mapped[HumanInputV2Form] = relationship(
        lambda: HumanInputV2Form,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormDeliveryAttempt.form_id) == HumanInputV2Form.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    endpoint: Mapped[HumanInputV2FormDeliveryEndpoint] = relationship(
        lambda: HumanInputV2FormDeliveryEndpoint,
        primaryjoin=lambda: (
            orm.foreign(HumanInputV2FormDeliveryAttempt.endpoint_id) == HumanInputV2FormDeliveryEndpoint.id
        ),
        back_populates="attempts",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputV2FormOTPChallenge(DefaultFieldsDCMixin, TypeBase):
    """Hashed Email proof session scoped to one form and approver grant.

    Resend locks the stable grant row, invalidates the previous current session,
    inserts its replacement, and calls a transaction-scoped audit port. The
    Submission Runtime persistence layer owns the concrete shared audit record.
    ``contact_id`` captures the Contact incarnation so deleting and recreating
    the same Email cannot make historical proof current. Plaintext code and
    challenge tokens never enter this record. Domain reconstruction requires
    ``resend_after`` and ``expires_at`` to retain their issuance-time durations.
    """

    __tablename__ = "human_input_v2_form_otp_challenges"
    __table_args__ = (
        sa.UniqueConstraint("challenge_token_hash", name="hiv2_form_otp_challenges_token_uq"),
        sa.CheckConstraint(
            "(subject_type = 'contact' AND contact_id IS NOT NULL) OR "
            "(subject_type = 'email_address' AND contact_id IS NULL)",
            name=sa.schema.conv("hiv2_form_otp_challenges_subject_identity_ck"),
        ),
        sa.CheckConstraint(
            "send_count >= 1 AND send_count <= 5",
            name=sa.schema.conv("hiv2_form_otp_challenges_send_count_ck"),
        ),
        sa.CheckConstraint(
            "attempt_count >= 0 AND attempt_count <= 5",
            name=sa.schema.conv("hiv2_form_otp_challenges_attempt_count_ck"),
        ),
        sa.CheckConstraint(
            "(status = 'verified' AND verified_at IS NOT NULL AND invalidated_at IS NULL) OR "
            "(status = 'invalidated' AND verified_at IS NULL AND invalidated_at IS NOT NULL) OR "
            "(status IN ('pending', 'expired') AND verified_at IS NULL AND invalidated_at IS NULL)",
            name=sa.schema.conv("hiv2_form_otp_challenges_terminal_timestamps_ck"),
        ),
        sa.Index(
            "hiv2_form_otp_scope_created_idx",
            "tenant_id",
            "form_id",
            "approver_grant_id",
            "created_at",
            "id",
        ),
        {"comment": "Hashed OTP proof sessions for email-based Human Input v2 approval."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_v2_forms.id."
    )
    approver_grant_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_v2_form_approver_grants.id.",
    )
    subject_type: Mapped[_HumanInputApproverGrantSubjectType] = mapped_column(
        EnumText(_HumanInputApproverGrantSubjectType),
        nullable=False,
        comment="Contact or standalone Email identity verified by this proof session.",
    )
    challenge_token_hash: Mapped[str] = mapped_column(
        sa.String(64), nullable=False, comment="SHA-256 hash of the ephemeral challenge token."
    )
    code_hash: Mapped[str] = mapped_column(
        sa.String(255), nullable=False, comment="Slow password hash of the one-time verification code."
    )
    code_hash_algorithm: Mapped[str] = mapped_column(
        sa.String(50), nullable=False, comment="Verifier algorithm discriminator for code_hash."
    )
    email_hash: Mapped[str] = mapped_column(
        sa.String(64), nullable=False, comment="SHA-256 of the normalized destination email."
    )
    email: Mapped[str] = mapped_column(
        sa.String(320), nullable=False, comment="Destination email used by this OTP challenge."
    )
    status: Mapped[_HumanInputOTPChallengeStatus] = mapped_column(
        EnumText(_HumanInputOTPChallengeStatus), nullable=False, comment="Current proof-session usability."
    )
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, comment="Challenge expiration timestamp.")
    resend_after: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, comment="Earliest timestamp at which a replacement may be issued."
    )
    contact_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to human_input_contact_identities.id for the captured Contact incarnation.",
    )
    send_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=1, comment="Number of OTP emails issued for this form approver grant."
    )
    attempt_count: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, default=0, comment="Number of failed or completed verification attempts."
    )
    verified_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime, nullable=True, default=None, comment="Timestamp of successful OTP verification."
    )
    invalidated_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime, nullable=True, default=None, comment="Timestamp when resend or identity change invalidated it."
    )

    form: Mapped[HumanInputV2Form] = relationship(
        lambda: HumanInputV2Form,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormOTPChallenge.form_id) == HumanInputV2Form.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    approver_grant: Mapped[HumanInputV2FormApproverGrant] = relationship(
        lambda: HumanInputV2FormApproverGrant,
        primaryjoin=lambda: (
            orm.foreign(HumanInputV2FormOTPChallenge.approver_grant_id) == HumanInputV2FormApproverGrant.id
        ),
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputV2FormSubmission(DefaultFieldsDCMixin, TypeBase):
    """Immutable winning submission for a Human Input form.

    The unique ``form_id`` constraint is the database-level first-success-wins
    guard. Insert this row and transition ``HumanInputV2Form.status`` in one transaction.
    The referenced audit event must be ``submission_authorized`` and must describe
    the same form, approver grant, and optional endpoint; the application service
    creates both records in that transaction.
    ``input_snapshot`` contains only the unvalidated request ``inputs`` object;
    it never stores the whole request, action, OTP, token, session, or proof data.
    ``canonical_values`` contains the validated execution-time source of truth,
    currently persisted using Segment serialization.
    """

    __tablename__ = "human_input_v2_form_submissions"
    __table_args__ = (
        sa.UniqueConstraint("form_id", name="hiv2_form_submissions_form_uq"),
        sa.UniqueConstraint(
            "authorization_audit_event_id",
            name="hiv2_submission_authorization_audit_event_uq",
        ),
        sa.CheckConstraint(
            "(actor_type = 'account' AND actor_account_id IS NOT NULL AND actor_end_user_id IS NULL "
            "AND actor_normalized_email IS NULL) OR "
            "(actor_type = 'end_user' AND actor_account_id IS NULL AND actor_end_user_id IS NOT NULL "
            "AND actor_normalized_email IS NULL) OR "
            "(actor_type = 'email_address' AND actor_account_id IS NULL AND actor_end_user_id IS NULL "
            "AND actor_normalized_email IS NOT NULL)",
            name=sa.schema.conv("hiv2_form_submissions_actor_identity_ck"),
        ),
        sa.Index("hiv2_form_submissions_tenant_submitted_idx", "tenant_id", "submitted_at", "id"),
        {"comment": "Immutable first successful Human Input v2 submission and its business actor."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_v2_forms.id."
    )
    approver_grant_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_v2_form_approver_grants.id for the exercised grant.",
    )
    actor_type: Mapped[_HumanInputSubmissionActorType] = mapped_column(
        EnumText(_HumanInputSubmissionActorType),
        nullable=False,
        comment="Discriminator for the business identity that completed the submission.",
    )
    authorization_audit_event_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to the submission_authorized human_input_v2_form_audit_events.id.",
    )
    selected_action_id: Mapped[str] = mapped_column(
        sa.String(200),
        nullable=False,
        comment="Action identifier from the frozen form configuration; not a logical foreign key to a table.",
    )
    input_snapshot: Mapped[FormInputSnapshot] = mapped_column(
        FrozenPydanticModelColumn(FormInputSnapshot),
        nullable=False,
        comment="Unvalidated raw form values from request.inputs only; this is not the complete HTTP request.",
    )
    canonical_values: Mapped[FormCanonicalValues] = mapped_column(
        FrozenPydanticModelColumn(FormCanonicalValues),
        nullable=False,
        comment="Validated canonical runtime values persisted using Segment serialization; execution source of truth.",
    )
    submitted_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, comment="Timestamp when the first successful submission committed."
    )
    actor_account_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to accounts.id for an account actor.",
    )
    actor_end_user_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to end_users.id for an end-user actor.",
    )
    actor_normalized_email: Mapped[str | None] = mapped_column(
        sa.String(320),
        nullable=True,
        default=None,
        comment="Lower-cased mailbox identity for an email-address actor.",
    )
    endpoint_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to human_input_v2_form_delivery_endpoints.id, when submitted through an endpoint.",
    )

    form: Mapped[HumanInputV2Form] = relationship(
        lambda: HumanInputV2Form,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormSubmission.form_id) == HumanInputV2Form.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    approver_grant: Mapped[HumanInputV2FormApproverGrant] = relationship(
        lambda: HumanInputV2FormApproverGrant,
        primaryjoin=lambda: (
            orm.foreign(HumanInputV2FormSubmission.approver_grant_id) == HumanInputV2FormApproverGrant.id
        ),
        viewonly=True,
        lazy="raise",
        init=False,
    )
    endpoint: Mapped[HumanInputV2FormDeliveryEndpoint | None] = relationship(
        lambda: HumanInputV2FormDeliveryEndpoint,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormSubmission.endpoint_id) == HumanInputV2FormDeliveryEndpoint.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    authorization_audit_event: Mapped[HumanInputV2FormAuditEvent] = relationship(
        lambda: HumanInputV2FormAuditEvent,
        primaryjoin=lambda: (
            orm.foreign(HumanInputV2FormSubmission.authorization_audit_event_id) == HumanInputV2FormAuditEvent.id
        ),
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputV2FormAuditEvent(DefaultFieldsDCMixin, TypeBase):
    """Append-only audit fact for resolution, access, delivery, or submission.

    A successful submission references its ``submission_authorized`` event, whose
    ``authorization_proof`` retains verified evidence without reusable secrets.
    Its business actor remains exclusively on ``HumanInputV2FormSubmission``;
    rejected attempts remain audit-only facts because they produce no Submission.
    """

    __tablename__ = "human_input_v2_form_audit_events"
    __table_args__ = (
        sa.Index("hiv2_form_audit_form_occurred_idx", "form_id", "occurred_at", "id"),
        sa.Index("hiv2_form_audit_tenant_occurred_idx", "tenant_id", "occurred_at", "id"),
        sa.CheckConstraint(
            "event_type <> 'submission_authorized' OR "
            "(approver_grant_id IS NOT NULL AND authorization_proof IS NOT NULL)",
            name=sa.schema.conv("hiv2_form_audit_authorized_proof_ck"),
        ),
        sa.CheckConstraint(
            "event_type <> 'submission_rejected' OR reason_code IS NOT NULL",
            name=sa.schema.conv("hiv2_form_audit_rejection_reason_ck"),
        ),
        {"comment": "Append-only Human Input v2 audit facts for security and operational queries."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_v2_forms.id."
    )
    event_type: Mapped[str] = mapped_column(
        sa.String(64), nullable=False, comment="Stable event name such as access_checked or submission_rejected."
    )
    occurred_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, comment="Business timestamp at which the audited fact occurred."
    )
    approver_grant_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to human_input_v2_form_approver_grants.id, when a grant was resolved.",
    )
    endpoint_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to human_input_v2_form_delivery_endpoints.id, when an endpoint was involved.",
    )
    channel: Mapped[_HumanInputDeliveryChannel | None] = mapped_column(
        EnumText(_HumanInputDeliveryChannel),
        nullable=True,
        default=None,
        comment="Channel from which the event originated.",
    )
    reason_code: Mapped[str | None] = mapped_column(
        sa.String(100), nullable=True, default=None, comment="Machine-readable authorization or delivery reason."
    )
    reason_message: Mapped[str | None] = mapped_column(
        LongText, nullable=True, default=None, comment="Operator-safe diagnostic detail."
    )
    authorization_proof: Mapped[FormAuthorizationProof | None] = mapped_column(
        FrozenPydanticModelColumn(
            _FORM_AUTHORIZATION_PROOF_ADAPTER,
            model_types=(
                AccountSessionAuthorizationProof,
                EmailOTPAuthorizationProof,
                IMIdentityAuthorizationProof,
                TrustedEndUserAuthorizationProof,
            ),
        ),
        nullable=True,
        default=None,
        comment="Verified authorization evidence; raw OTP codes, tokens, and signatures are never persisted.",
    )
    event_payload: Mapped[FormAuditEventPayload | None] = mapped_column(
        FrozenPydanticModelColumn(FormAuditEventPayload),
        nullable=True,
        default=None,
        comment="Immutable event-specific Pydantic model not used as a primary query predicate.",
    )

    form: Mapped[HumanInputV2Form] = relationship(
        lambda: HumanInputV2Form,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormAuditEvent.form_id) == HumanInputV2Form.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    approver_grant: Mapped[HumanInputV2FormApproverGrant | None] = relationship(
        lambda: HumanInputV2FormApproverGrant,
        primaryjoin=lambda: (
            orm.foreign(HumanInputV2FormAuditEvent.approver_grant_id) == HumanInputV2FormApproverGrant.id
        ),
        viewonly=True,
        lazy="raise",
        init=False,
    )
    endpoint: Mapped[HumanInputV2FormDeliveryEndpoint | None] = relationship(
        lambda: HumanInputV2FormDeliveryEndpoint,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormAuditEvent.endpoint_id) == HumanInputV2FormDeliveryEndpoint.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputV2FormUploadToken(DefaultFieldsDCMixin, TypeBase):
    """Hashed upload capability scoped to one Human Input v2 delivery endpoint.

    The opaque token is returned only at creation time. Persistence retains its
    SHA-256 hash so an upload credential cannot be recovered from the database.
    Endpoint scoping keeps public upload access within the same form surface that
    issued the capability.
    """

    __tablename__ = "human_input_v2_form_upload_tokens"
    __table_args__ = (
        sa.UniqueConstraint("upload_token_hash", name="hiv2_form_upload_tokens_hash_uq"),
        sa.Index("hiv2_form_upload_tokens_form_endpoint_idx", "form_id", "endpoint_id"),
        {"comment": "Hashed endpoint-scoped upload capabilities for Human Input v2 forms."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to apps.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_v2_forms.id.",
    )
    endpoint_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_v2_form_delivery_endpoints.id.",
    )
    upload_token_hash: Mapped[str] = mapped_column(
        sa.String(64),
        nullable=False,
        comment="SHA-256 hash of the opaque upload token; plaintext tokens are never persisted.",
    )

    form: Mapped[HumanInputV2Form] = relationship(
        lambda: HumanInputV2Form,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormUploadToken.form_id) == HumanInputV2Form.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    endpoint: Mapped[HumanInputV2FormDeliveryEndpoint] = relationship(
        lambda: HumanInputV2FormDeliveryEndpoint,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormUploadToken.endpoint_id) == HumanInputV2FormDeliveryEndpoint.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputV2FormUploadFile(DefaultFieldsDCMixin, TypeBase):
    """Durable association between one endpoint-scoped upload capability and file."""

    __tablename__ = "human_input_v2_form_upload_files"
    __table_args__ = (
        sa.UniqueConstraint("upload_file_id", name="hiv2_form_upload_files_file_uq"),
        sa.Index("hiv2_form_upload_files_form_endpoint_idx", "form_id", "endpoint_id"),
        sa.Index("hiv2_form_upload_files_token_idx", "upload_token_id"),
        {"comment": "Durable Human Input v2 form, endpoint, upload-token, and file associations."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to apps.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_v2_forms.id.",
    )
    endpoint_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_v2_form_delivery_endpoints.id.",
    )
    upload_file_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to upload_files.id.",
    )
    upload_token_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_v2_form_upload_tokens.id.",
    )

    form: Mapped[HumanInputV2Form] = relationship(
        lambda: HumanInputV2Form,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormUploadFile.form_id) == HumanInputV2Form.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    upload_token: Mapped[HumanInputV2FormUploadToken] = relationship(
        lambda: HumanInputV2FormUploadToken,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormUploadFile.upload_token_id) == HumanInputV2FormUploadToken.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    endpoint: Mapped[HumanInputV2FormDeliveryEndpoint] = relationship(
        lambda: HumanInputV2FormDeliveryEndpoint,
        primaryjoin=lambda: orm.foreign(HumanInputV2FormUploadFile.endpoint_id) == HumanInputV2FormDeliveryEndpoint.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )


__all__ = [
    "AccountSessionAuthorizationProof",
    "ContactSubjectType",
    "EmailOTPAuthorizationProof",
    "FormApproverGrantMatchedSource",
    "FormApproverGrantMatchedSources",
    "FormApproverGrantSubjectSnapshot",
    "FormAuditEventPayload",
    "FormAuthorizationProof",
    "FormCanonicalValues",
    "FormDeliveryProviderResponse",
    "FormInputSnapshot",
    "HumanInputContactIdentity",
    "HumanInputEmailProvider",
    "HumanInputExternalContactProfile",
    "HumanInputIMBinding",
    "HumanInputIMIdentity",
    "HumanInputIMIntegration",
    "HumanInputIMSyncResult",
    "HumanInputIMSyncRun",
    "HumanInputPlatformContactWorkspaceEntry",
    "HumanInputV2Form",
    "HumanInputV2FormApproverGrant",
    "HumanInputV2FormAuditEvent",
    "HumanInputV2FormDefinition",
    "HumanInputV2FormDeliveryAttempt",
    "HumanInputV2FormDeliveryEndpoint",
    "HumanInputV2FormOTPChallenge",
    "HumanInputV2FormSubmission",
    "HumanInputV2FormUploadFile",
    "HumanInputV2FormUploadToken",
    "IMEncryptedCredentials",
    "IMIdentityAuthorizationProof",
    "IMIdentityRawPayload",
    "IMSyncContactSnapshot",
    "IMSyncDirectoryEntryPayload",
    "IMSyncIdentitySnapshot",
    "ResendEmailProviderEncryptedCredentials",
    "ResolvedFormAction",
    "ResolvedFormBlock",
    "ResolvedFormFileInput",
    "ResolvedFormFileListInput",
    "ResolvedFormMarkdownText",
    "ResolvedFormParagraphInput",
    "ResolvedFormSelectInput",
    "TrustedEndUserAuthorizationProof",
]
