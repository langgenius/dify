"""Persistence stubs for Human Input v2 contacts, delivery, and approval audit.

The models intentionally use logical references instead of database foreign keys.
Every relationship therefore requires an explicit eager-loading strategy, and
authorization code must scope queries by the owning directory or tenant. Column
comments name the referenced ``table.column`` for every logical foreign key.
Contacts represent the conceptual Organization boundary through ``tenant_id``:
EE Organization rows use a null value, while workspace-owned rows reference
``tenants.id``. Their immutable ``identity_source`` selects the lifecycle policy;
workspace-local Contact type remains a query projection. IM child rows use their
integration as the concrete persistence boundary.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, Field, JsonValue, RootModel, TypeAdapter
from sqlalchemy import orm
from sqlalchemy.orm import Mapped, mapped_column, relationship

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

from .base import DefaultFieldsDCMixin, TypeBase
from .human_input import HumanInputForm
from .types import EnumText, FrozenPydanticModelColumn, LongText, StringUUID


class _ImmutableJSONModel(BaseModel):
    """Strict immutable base for structured JSON persistence values."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)


class _ImmutableJSONObject(RootModel[dict[str, JsonValue]]):
    """Strict immutable base for intentionally opaque JSON object payloads."""

    model_config = ConfigDict(frozen=True, strict=True, validate_default=True)


class _FeishuLarkIMIntegrationEncryptedCredentialsBase(_ImmutableJSONModel):
    """Encrypted credential fields shared by Feishu and Lark integrations."""

    app_id: str = Field(description="Provider application identifier.")
    encrypted_app_secret: str = Field(description="Encrypted provider application secret.")
    encrypted_verification_token: str | None = Field(
        default=None,
        description="Encrypted callback verification token, when configured.",
    )
    encrypted_encrypt_key: str | None = Field(
        default=None,
        description="Encrypted callback encryption key, when configured.",
    )


class FeishuIMIntegrationEncryptedCredentials(_FeishuLarkIMIntegrationEncryptedCredentialsBase):
    """Encrypted credentials persisted for a Feishu integration."""

    provider: Literal[_IMProvider.FEISHU] = Field(
        default=_IMProvider.FEISHU,
        description="Discriminator for Feishu encrypted credentials.",
    )


class LarkIMIntegrationEncryptedCredentials(_FeishuLarkIMIntegrationEncryptedCredentialsBase):
    """Encrypted credentials persisted for a Lark integration."""

    provider: Literal[_IMProvider.LARK] = Field(
        default=_IMProvider.LARK,
        description="Discriminator for Lark encrypted credentials.",
    )


class SlackIMIntegrationEncryptedCredentials(_ImmutableJSONModel):
    """Encrypted credentials persisted for a Slack integration."""

    provider: Literal[_IMProvider.SLACK] = Field(
        default=_IMProvider.SLACK,
        description="Discriminator for Slack encrypted credentials.",
    )
    client_id: str = Field(description="Slack OAuth client identifier.")
    encrypted_client_secret: str = Field(description="Encrypted Slack OAuth client secret.")
    encrypted_signing_secret: str = Field(description="Encrypted Slack callback signing secret.")
    encrypted_bot_token: str = Field(description="Encrypted Slack bot token.")


class DingTalkIMIntegrationEncryptedCredentials(_ImmutableJSONModel):
    """Encrypted credentials persisted for a DingTalk integration."""

    provider: Literal[_IMProvider.DING_TALK] = Field(
        default=_IMProvider.DING_TALK,
        description="Discriminator for DingTalk encrypted credentials.",
    )
    client_id: str = Field(description="DingTalk application client identifier.")
    encrypted_client_secret: str = Field(description="Encrypted DingTalk application client secret.")


class MSTeamsIMIntegrationEncryptedCredentials(_ImmutableJSONModel):
    """Encrypted credentials persisted for a Microsoft Teams integration."""

    provider: Literal[_IMProvider.MS_TEAMS] = Field(
        default=_IMProvider.MS_TEAMS,
        description="Discriminator for Microsoft Teams encrypted credentials.",
    )
    tenant_id: str = Field(description="Microsoft Entra tenant identifier.")
    client_id: str = Field(description="Microsoft Teams application client identifier.")
    encrypted_client_secret: str = Field(description="Encrypted Microsoft Teams application client secret.")


class WeComIMIntegrationEncryptedCredentials(_ImmutableJSONModel):
    """Encrypted credentials persisted for a WeCom integration."""

    provider: Literal[_IMProvider.WE_COM] = Field(
        default=_IMProvider.WE_COM,
        description="Discriminator for WeCom encrypted credentials.",
    )
    corp_id: str = Field(description="WeCom corporation identifier.")
    agent_id: str = Field(description="WeCom agent identifier.")
    encrypted_secret: str = Field(description="Encrypted WeCom application secret.")


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


class FormApproverGrantMatchedSources(_ImmutableJSONModel):
    """Immutable recipient sources merged into one form approver grant."""

    sources: tuple[str, ...] = Field(
        default_factory=tuple,
        strict=False,
        description="Canonical recipient source values merged into this approver grant.",
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


class EmailOTPAuthorizationProof(_ImmutableJSONModel):
    """Successful email OTP verification retained without the plaintext code."""

    type: Literal[_HumanInputAuthorizationProofType.EMAIL_OTP] = Field(
        default=_HumanInputAuthorizationProofType.EMAIL_OTP,
        description="Discriminator for email OTP authorization evidence.",
    )
    otp_challenge_id: str = Field(description="Historical Human Input OTP challenge identifier.")
    verified_email_hash: str = Field(description="SHA-256 hash of the normalized verified email address.")


class IMIdentityAuthorizationProof(_ImmutableJSONModel):
    """Resolved IM identity and binding evidence that survives deletion of current IM rows."""

    type: Literal[_HumanInputAuthorizationProofType.IM_IDENTITY] = Field(
        default=_HumanInputAuthorizationProofType.IM_IDENTITY,
        description="Discriminator for IM identity authorization evidence.",
    )
    integration_id: str = Field(description="Historical Human Input IM integration identifier.")
    im_identity_id: str = Field(description="Historical Human Input IM identity identifier.")
    im_binding_id: str = Field(description="Historical Human Input IM binding identifier.")
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


class FormSubmittedData(_ImmutableJSONObject):
    """Validated structured form values accepted by the winning submission."""


class FormAuditEventPayload(_ImmutableJSONObject):
    """Event-specific immutable audit context not used for primary queries."""


type IMIntegrationEncryptedCredentials = Annotated[
    FeishuIMIntegrationEncryptedCredentials
    | LarkIMIntegrationEncryptedCredentials
    | SlackIMIntegrationEncryptedCredentials
    | DingTalkIMIntegrationEncryptedCredentials
    | MSTeamsIMIntegrationEncryptedCredentials
    | WeComIMIntegrationEncryptedCredentials,
    Field(discriminator="provider"),
]


_IM_INTEGRATION_ENCRYPTED_CREDENTIALS_ADAPTER: TypeAdapter[IMIntegrationEncryptedCredentials] = TypeAdapter(
    IMIntegrationEncryptedCredentials
)


class HumanInputContactIdentitySource(StrEnum):
    """Immutable persistence discriminator for Contact lifecycle ownership.

    This model-layer enum is intentionally separate from ``HumanInputContactType``.
    The identity source is persisted once and determines who owns creation and
    deletion of the Contact: an EE Organization Account, a CE/SaaS workspace
    membership, or a workspace-managed External Contact. It does not vary by
    workspace.

    ``HumanInputContactType`` is an external, workspace-relative projection. One
    ``ORGANIZATION_ACCOUNT`` Contact can resolve to ``WORKSPACE`` in one
    workspace, ``PLATFORM`` in another, and be absent elsewhere. Promote and
    Demote therefore change membership and the Platform allow-list, never this
    enum. This enum must not be serialized as the external Contact type.
    """

    ORGANIZATION_ACCOUNT = "organization_account"
    WORKSPACE_MEMBER = "workspace_member"
    EXTERNAL = "external"


class HumanInputContact(DefaultFieldsDCMixin, TypeBase):
    """Canonical contact identity shared by directory, delivery, and authorization.

    ``identity_source`` and the owner columns define the immutable lifecycle
    source of the identity. Workspace membership and Platform availability are
    external facts and never mutate this source. Because both supported
    databases allow duplicate nulls in unique constraints, EE Organization
    contact uniqueness must also be protected by a contact write transaction
    that locks a stable owner such as the IM integration.
    """

    __tablename__ = "human_input_contacts"
    __table_args__ = (
        sa.UniqueConstraint(
            "tenant_id",
            "account_id",
            name="human_input_contacts_tenant_account_uq",
        ),
        sa.UniqueConstraint(
            "tenant_id",
            "normalized_email",
            name="human_input_contacts_tenant_email_uq",
        ),
        sa.CheckConstraint(
            "(identity_source = 'organization_account' AND tenant_id IS NULL AND account_id IS NOT NULL) OR "
            "(identity_source = 'workspace_member' AND tenant_id IS NOT NULL AND account_id IS NOT NULL) OR "
            "(identity_source = 'external' AND tenant_id IS NOT NULL AND account_id IS NULL)",
            name="identity_owner",
        ),
        sa.CheckConstraint(
            "identity_source <> 'external' OR (email IS NOT NULL AND normalized_email IS NOT NULL)",
            name="external_email",
        ),
        sa.Index(None, "tenant_id", "normalized_email"),
        sa.Index(None, "tenant_id", "normalized_name"),
        {
            "comment": (
                "Canonical Human Input contact identities. EE Organization Account contacts have tenant_id IS NULL; "
                "workspace-owned contacts have tenant_id = tenants.id; CE and SaaS must not create contacts with "
                "tenant_id IS NULL."
            )
        },
    )

    name: Mapped[str] = mapped_column(sa.String(255), nullable=False, comment="Display name shown in contact surfaces.")
    normalized_name: Mapped[str] = mapped_column(
        sa.String(255), nullable=False, comment="Lower-cased search value maintained by the application."
    )
    identity_source: Mapped[HumanInputContactIdentitySource] = mapped_column(
        EnumText(HumanInputContactIdentitySource),
        nullable=False,
        comment="Immutable identity source that determines the Contact lifecycle owner.",
    )
    tenant_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment=(
            "Ownership boundary: null only for EE Organization contacts; otherwise the owning tenants.id for "
            "workspace-owned contacts. CE and SaaS must never persist a null value."
        ),
    )
    account_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to accounts.id for an account-backed contact.",
    )
    email: Mapped[str | None] = mapped_column(
        sa.String(320), nullable=True, default=None, comment="Current deliverable email address, when available."
    )
    normalized_email: Mapped[str | None] = mapped_column(
        sa.String(320), nullable=True, default=None, comment="Full lower-cased email used for equality matching."
    )
    avatar_file_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to upload_files.id for an external contact avatar.",
    )

    platform_workspace_entries: Mapped[list[HumanInputPlatformContactWorkspaceEntry]] = relationship(
        lambda: HumanInputPlatformContactWorkspaceEntry,
        primaryjoin=lambda: HumanInputContact.id == orm.foreign(HumanInputPlatformContactWorkspaceEntry.contact_id),
        back_populates="contact",
        viewonly=True,
        lazy="raise",
        init=False,
    )
    im_bindings: Mapped[list[HumanInputIMBinding]] = relationship(
        lambda: HumanInputIMBinding,
        primaryjoin=lambda: HumanInputContact.id == orm.foreign(HumanInputIMBinding.contact_id),
        back_populates="contact",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputPlatformContactWorkspaceEntry(DefaultFieldsDCMixin, TypeBase):
    """EE-only workspace allow-list entry for an Organization Account contact.

    The entry does not own the Contact and does not duplicate workspace
    membership or the externally resolved Contact type. Its existence means that
    an EE Organization Account contact without current membership is explicitly
    available in one workspace. The Contact Directory service must ensure the
    referenced Contact has ``ORGANIZATION_ACCOUNT`` as its identity source and
    serialize Promote/Demote with the corresponding membership mutation.
    """

    __tablename__ = "human_input_platform_contact_workspace_entries"
    __table_args__ = (
        sa.UniqueConstraint(
            "tenant_id",
            "contact_id",
            name="hipcwe_tenant_contact_uq",
        ),
        sa.Index(None, "tenant_id", "created_at", "id"),
        sa.Index(None, "contact_id"),
        {
            "comment": (
                "EE-only workspace allow-list for Organization Account contacts. Workspace membership and External "
                "contact ownership must not create rows in this table."
            )
        },
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    contact_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_contacts.id."
    )
    added_by_account_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to accounts.id for the administrator who added this directory entry.",
    )

    contact: Mapped[HumanInputContact] = relationship(
        lambda: HumanInputContact,
        primaryjoin=lambda: orm.foreign(HumanInputPlatformContactWorkspaceEntry.contact_id) == HumanInputContact.id,
        back_populates="platform_workspace_entries",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputIMIntegration(DefaultFieldsDCMixin, TypeBase):
    """Single organization-level IM control-plane configuration.

    Credential values must be encrypted before persistence. CE/SaaS rows are
    tenant-scoped. EE uses a null ``tenant_id`` because the deployment is the
    conceptual Organization boundary; the service must serialize creation to
    preserve the first-release singleton rule. Configuration writes use
    ``config_version`` for explicit compare-and-swap; connectivity diagnostics
    do not advance that revision. Asynchronous work must capture the revision
    that produced it and reject stale current-state writes.
    """

    __tablename__ = "human_input_im_integrations"
    __table_args__ = (
        sa.UniqueConstraint("tenant_id", name="human_input_im_integrations_tenant_uq"),
        {"comment": "Organization-level Human Input IM integration configuration."},
    )

    provider: Mapped[_IMProvider] = mapped_column(
        EnumText(_IMProvider), nullable=False, comment="Configured IM provider discriminator."
    )
    encrypted_credentials: Mapped[IMIntegrationEncryptedCredentials] = mapped_column(
        FrozenPydanticModelColumn(
            _IM_INTEGRATION_ENCRYPTED_CREDENTIALS_ADAPTER,
            model_types=(
                FeishuIMIntegrationEncryptedCredentials,
                LarkIMIntegrationEncryptedCredentials,
                SlackIMIntegrationEncryptedCredentials,
                DingTalkIMIntegrationEncryptedCredentials,
                MSTeamsIMIntegrationEncryptedCredentials,
                WeComIMIntegrationEncryptedCredentials,
            ),
        ),
        nullable=False,
        comment=(
            "Provider-specific encrypted credential Pydantic model stored as JSON; "
            "its provider discriminator must match the provider column."
        ),
    )
    tenant_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to tenants.id in CE/SaaS; null for the EE deployment-wide integration.",
    )
    provider_tenant_id: Mapped[str | None] = mapped_column(
        sa.String(255),
        nullable=True,
        default=None,
        comment=(
            "Provider-side Organization or workspace identity. Credential rotation preserves current identities and "
            "bindings only when the provider adapter confirms this value is unchanged."
        ),
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
        sa.Index(None, "integration_id", "provider", "normalized_email"),
        sa.Index(None, "integration_id", "provider", "normalized_name"),
        sa.Index(None, "integration_id", "last_seen_sync_run_id"),
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
        sa.Index(
            None,
            "integration_id",
            "contact_id",
            "provider",
            "scope",
            "scope_id",
        ),
        sa.Index(None, "im_identity_id", "scope", "scope_id"),
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
        StringUUID, nullable=False, comment="Logical foreign key to human_input_contacts.id."
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

    contact: Mapped[HumanInputContact] = relationship(
        lambda: HumanInputContact,
        primaryjoin=lambda: orm.foreign(HumanInputIMBinding.contact_id) == HumanInputContact.id,
        back_populates="im_bindings",
        viewonly=True,
        lazy="raise",
        init=False,
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
        sa.Index(None, "integration_id", "created_at", "id"),
        sa.Index(None, "integration_id", "status", "created_at"),
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
        sa.Integer, nullable=False, default=0, comment="Number of prior bindings removed by reconciliation."
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
    """Immutable reconciliation result for one provider directory entry.

    Provider identifiers and normalized email remain queryable columns. JSON is
    limited to the raw provider input and immutable display snapshots.
    """

    __tablename__ = "human_input_im_sync_results"
    __table_args__ = (
        sa.Index(None, "sync_run_id", "result_type", "created_at", "id"),
        sa.Index(None, "integration_id", "contact_id", "created_at"),
        sa.Index(None, "integration_id", "im_identity_id", "created_at"),
        {"comment": "Immutable per-entry outcome of a manual IM directory synchronization."},
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
        comment="Logical foreign key to human_input_contacts.id, when a contact was matched.",
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
    contact: Mapped[HumanInputContact | None] = relationship(
        lambda: HumanInputContact,
        primaryjoin=lambda: orm.foreign(HumanInputIMSyncResult.contact_id) == HumanInputContact.id,
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


class HumanInputFormApproverGrant(DefaultFieldsDCMixin, TypeBase):
    """Form-scoped approval authority granted to one canonical business subject.

    Contact-backed grants are revalidated through the current Contact lifecycle.
    End-user and email-address grants cover subjects that intentionally do not
    belong to the Contact Directory. ``subject_snapshot`` is display-only and
    never substitutes for current-state authorization checks.
    """

    __tablename__ = "human_input_form_approver_grants"
    __table_args__ = (
        sa.UniqueConstraint("form_id", "subject_key", name="human_input_form_grants_form_subject_uq"),
        sa.CheckConstraint(
            "(subject_type = 'contact' AND contact_id IS NOT NULL AND end_user_id IS NULL "
            "AND normalized_email IS NULL) OR "
            "(subject_type = 'end_user' AND contact_id IS NULL AND end_user_id IS NOT NULL "
            "AND normalized_email IS NULL) OR "
            "(subject_type = 'email_address' AND contact_id IS NULL AND end_user_id IS NULL "
            "AND normalized_email IS NOT NULL)",
            name="subject_identity",
        ),
        sa.Index(None, "form_id", "contact_id"),
        sa.Index(None, "form_id", "end_user_id"),
        sa.Index(None, "form_id", "normalized_email"),
        {"comment": "Frozen form-scoped approval grants resolved from runtime recipient specifications."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_forms.id."
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
        comment="Logical foreign key to human_input_contacts.id for a contact-backed grant.",
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

    form: Mapped[HumanInputForm] = relationship(
        lambda: HumanInputForm,
        primaryjoin=lambda: orm.foreign(HumanInputFormApproverGrant.form_id) == HumanInputForm.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    contact: Mapped[HumanInputContact | None] = relationship(
        lambda: HumanInputContact,
        primaryjoin=lambda: orm.foreign(HumanInputFormApproverGrant.contact_id) == HumanInputContact.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    endpoints: Mapped[list[HumanInputFormDeliveryEndpoint]] = relationship(
        lambda: HumanInputFormDeliveryEndpoint,
        primaryjoin=lambda: (
            HumanInputFormApproverGrant.id == orm.foreign(HumanInputFormDeliveryEndpoint.approver_grant_id)
        ),
        back_populates="approver_grant",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputFormDeliveryEndpoint(DefaultFieldsDCMixin, TypeBase):
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
    database intentionally does not duplicate this discriminated-union rule.
    Opaque public form tokens are persisted only as hashes.
    """

    __tablename__ = "human_input_form_delivery_endpoints"
    __table_args__ = (
        sa.UniqueConstraint(
            "form_id",
            "approver_grant_id",
            "channel",
            "address_hash",
            name="human_input_form_endpoints_form_grant_channel_address_uq",
        ),
        sa.UniqueConstraint("access_token_hash", name="human_input_form_endpoints_token_uq"),
        sa.Index(None, "form_id", "approver_grant_id", "channel"),
        sa.Index(None, "im_identity_id", "form_id"),
        {"comment": "Immutable notification and interaction endpoints for Human Input approver grants."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_forms.id."
    )
    approver_grant_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_form_approver_grants.id.",
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
    im_identity_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to human_input_im_identities.id.",
    )
    access_token_hash: Mapped[str | None] = mapped_column(
        sa.String(64), nullable=True, default=None, comment="SHA-256 hash of an opaque form access token."
    )

    form: Mapped[HumanInputForm] = relationship(
        lambda: HumanInputForm,
        primaryjoin=lambda: orm.foreign(HumanInputFormDeliveryEndpoint.form_id) == HumanInputForm.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    approver_grant: Mapped[HumanInputFormApproverGrant] = relationship(
        lambda: HumanInputFormApproverGrant,
        primaryjoin=lambda: (
            orm.foreign(HumanInputFormDeliveryEndpoint.approver_grant_id) == HumanInputFormApproverGrant.id
        ),
        back_populates="endpoints",
        viewonly=True,
        lazy="raise",
        init=False,
    )
    attempts: Mapped[list[HumanInputFormDeliveryAttempt]] = relationship(
        lambda: HumanInputFormDeliveryAttempt,
        primaryjoin=lambda: HumanInputFormDeliveryEndpoint.id == orm.foreign(HumanInputFormDeliveryAttempt.endpoint_id),
        back_populates="endpoint",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputFormDeliveryAttempt(DefaultFieldsDCMixin, TypeBase):
    """One delivery attempt whose failure never mutates the form status directly."""

    __tablename__ = "human_input_form_delivery_attempts"
    __table_args__ = (
        sa.UniqueConstraint("endpoint_id", "attempt_number", name="human_input_form_attempts_endpoint_number_uq"),
        sa.Index(None, "form_id", "status", "created_at", "id"),
        sa.Index(None, "status", "scheduled_at", "id"),
        {"comment": "Append-oriented delivery attempts for Human Input form endpoints."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Denormalized logical foreign key to human_input_forms.id.",
    )
    endpoint_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_form_delivery_endpoints.id."
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

    endpoint: Mapped[HumanInputFormDeliveryEndpoint] = relationship(
        lambda: HumanInputFormDeliveryEndpoint,
        primaryjoin=lambda: orm.foreign(HumanInputFormDeliveryAttempt.endpoint_id) == HumanInputFormDeliveryEndpoint.id,
        back_populates="attempts",
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputFormOTPChallenge(DefaultFieldsDCMixin, TypeBase):
    """Hashed email proof challenge scoped to one form and approver grant.

    Resend replaces the current challenge. The service must lock the grant
    before issuing a replacement so only one pending challenge remains usable.
    """

    __tablename__ = "human_input_form_otp_challenges"
    __table_args__ = (
        sa.UniqueConstraint("challenge_token_hash", name="human_input_form_otp_challenges_token_uq"),
        sa.Index(None, "form_id", "approver_grant_id", "status", "created_at"),
        {"comment": "Hashed OTP proof sessions for email-based Human Input approval."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_forms.id."
    )
    approver_grant_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_form_approver_grants.id.",
    )
    challenge_token_hash: Mapped[str] = mapped_column(
        sa.String(64), nullable=False, comment="SHA-256 hash of the ephemeral challenge token."
    )
    code_hash: Mapped[str] = mapped_column(
        sa.String(255), nullable=False, comment="Slow password hash of the one-time verification code."
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

    form: Mapped[HumanInputForm] = relationship(
        lambda: HumanInputForm,
        primaryjoin=lambda: orm.foreign(HumanInputFormOTPChallenge.form_id) == HumanInputForm.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    approver_grant: Mapped[HumanInputFormApproverGrant] = relationship(
        lambda: HumanInputFormApproverGrant,
        primaryjoin=lambda: orm.foreign(HumanInputFormOTPChallenge.approver_grant_id) == HumanInputFormApproverGrant.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputFormSubmission(DefaultFieldsDCMixin, TypeBase):
    """Immutable winning submission for a Human Input form.

    The unique ``form_id`` constraint is the database-level first-success-wins
    guard. Insert this row and transition ``HumanInputForm.status`` in one transaction.
    The referenced audit event must be ``submission_authorized`` and must describe
    the same form, approver grant, and optional endpoint; the application service
    creates both records in that transaction.
    """

    __tablename__ = "human_input_form_submissions"
    __table_args__ = (
        sa.UniqueConstraint("form_id", name="human_input_form_submissions_form_uq"),
        sa.UniqueConstraint(
            "authorization_audit_event_id",
            name="hif_submission_authorization_audit_event_uq",
        ),
        sa.CheckConstraint(
            "(actor_type = 'account' AND actor_account_id IS NOT NULL AND actor_end_user_id IS NULL "
            "AND actor_normalized_email IS NULL) OR "
            "(actor_type = 'end_user' AND actor_account_id IS NULL AND actor_end_user_id IS NOT NULL "
            "AND actor_normalized_email IS NULL) OR "
            "(actor_type = 'email_address' AND actor_account_id IS NULL AND actor_end_user_id IS NULL "
            "AND actor_normalized_email IS NOT NULL)",
            name="actor_identity",
        ),
        sa.Index(None, "tenant_id", "submitted_at", "id"),
        {"comment": "Immutable first successful Human Input submission and its business actor."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_forms.id."
    )
    approver_grant_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to human_input_form_approver_grants.id for the exercised grant.",
    )
    actor_type: Mapped[_HumanInputSubmissionActorType] = mapped_column(
        EnumText(_HumanInputSubmissionActorType),
        nullable=False,
        comment="Discriminator for the business identity that completed the submission.",
    )
    authorization_audit_event_id: Mapped[str] = mapped_column(
        StringUUID,
        nullable=False,
        comment="Logical foreign key to the submission_authorized human_input_form_audit_events.id.",
    )
    selected_action_id: Mapped[str] = mapped_column(
        sa.String(200),
        nullable=False,
        comment="Action identifier from the frozen form configuration; not a logical foreign key to a table.",
    )
    submitted_data: Mapped[FormSubmittedData] = mapped_column(
        FrozenPydanticModelColumn(FormSubmittedData),
        nullable=False,
        comment="Immutable validated submission-data Pydantic model.",
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
        comment="Logical foreign key to human_input_form_delivery_endpoints.id, when submitted through an endpoint.",
    )

    form: Mapped[HumanInputForm] = relationship(
        lambda: HumanInputForm,
        primaryjoin=lambda: orm.foreign(HumanInputFormSubmission.form_id) == HumanInputForm.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    approver_grant: Mapped[HumanInputFormApproverGrant] = relationship(
        lambda: HumanInputFormApproverGrant,
        primaryjoin=lambda: orm.foreign(HumanInputFormSubmission.approver_grant_id) == HumanInputFormApproverGrant.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    endpoint: Mapped[HumanInputFormDeliveryEndpoint | None] = relationship(
        lambda: HumanInputFormDeliveryEndpoint,
        primaryjoin=lambda: orm.foreign(HumanInputFormSubmission.endpoint_id) == HumanInputFormDeliveryEndpoint.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    authorization_audit_event: Mapped[HumanInputFormAuditEvent] = relationship(
        lambda: HumanInputFormAuditEvent,
        primaryjoin=lambda: (
            orm.foreign(HumanInputFormSubmission.authorization_audit_event_id) == HumanInputFormAuditEvent.id
        ),
        viewonly=True,
        lazy="raise",
        init=False,
    )


class HumanInputFormAuditEvent(DefaultFieldsDCMixin, TypeBase):
    """Append-only audit fact for resolution, access, delivery, or submission.

    A successful submission references its ``submission_authorized`` event, whose
    ``authorization_proof`` retains verified evidence without reusable secrets.
    Its business actor remains exclusively on ``HumanInputFormSubmission``;
    rejected attempts remain audit-only facts because they produce no Submission.
    """

    __tablename__ = "human_input_form_audit_events"
    __table_args__ = (
        sa.Index(None, "form_id", "occurred_at", "id"),
        sa.Index(None, "tenant_id", "occurred_at", "id"),
        sa.CheckConstraint(
            "event_type <> 'submission_authorized' OR "
            "(approver_grant_id IS NOT NULL AND authorization_proof IS NOT NULL)",
            name="submission_authorized_proof",
        ),
        {"comment": "Append-only Human Input audit facts for security and operational queries."},
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False, comment="Logical foreign key to tenants.id.")
    form_id: Mapped[str] = mapped_column(
        StringUUID, nullable=False, comment="Logical foreign key to human_input_forms.id."
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
        comment="Logical foreign key to human_input_form_approver_grants.id, when a grant was resolved.",
    )
    endpoint_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
        comment="Logical foreign key to human_input_form_delivery_endpoints.id, when an endpoint was involved.",
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

    form: Mapped[HumanInputForm] = relationship(
        lambda: HumanInputForm,
        primaryjoin=lambda: orm.foreign(HumanInputFormAuditEvent.form_id) == HumanInputForm.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    approver_grant: Mapped[HumanInputFormApproverGrant | None] = relationship(
        lambda: HumanInputFormApproverGrant,
        primaryjoin=lambda: orm.foreign(HumanInputFormAuditEvent.approver_grant_id) == HumanInputFormApproverGrant.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )
    endpoint: Mapped[HumanInputFormDeliveryEndpoint | None] = relationship(
        lambda: HumanInputFormDeliveryEndpoint,
        primaryjoin=lambda: orm.foreign(HumanInputFormAuditEvent.endpoint_id) == HumanInputFormDeliveryEndpoint.id,
        viewonly=True,
        lazy="raise",
        init=False,
    )


__all__ = [
    "AccountSessionAuthorizationProof",
    "DingTalkIMIntegrationEncryptedCredentials",
    "EmailOTPAuthorizationProof",
    "FeishuIMIntegrationEncryptedCredentials",
    "FormApproverGrantMatchedSources",
    "FormApproverGrantSubjectSnapshot",
    "FormAuditEventPayload",
    "FormAuthorizationProof",
    "FormDeliveryProviderResponse",
    "FormSubmittedData",
    "HumanInputContact",
    "HumanInputContactIdentitySource",
    "HumanInputEmailProvider",
    "HumanInputFormApproverGrant",
    "HumanInputFormAuditEvent",
    "HumanInputFormDeliveryAttempt",
    "HumanInputFormDeliveryEndpoint",
    "HumanInputFormOTPChallenge",
    "HumanInputFormSubmission",
    "HumanInputIMBinding",
    "HumanInputIMIdentity",
    "HumanInputIMIntegration",
    "HumanInputIMSyncResult",
    "HumanInputIMSyncRun",
    "HumanInputPlatformContactWorkspaceEntry",
    "IMIdentityAuthorizationProof",
    "IMIdentityRawPayload",
    "IMIntegrationEncryptedCredentials",
    "IMSyncContactSnapshot",
    "IMSyncDirectoryEntryPayload",
    "IMSyncIdentitySnapshot",
    "LarkIMIntegrationEncryptedCredentials",
    "MSTeamsIMIntegrationEncryptedCredentials",
    "ResendEmailProviderEncryptedCredentials",
    "SlackIMIntegrationEncryptedCredentials",
    "TrustedEndUserAuthorizationProof",
    "WeComIMIntegrationEncryptedCredentials",
]
