from enum import StrEnum
from typing import NewType


class HumanInputContactType(StrEnum):
    """Concrete contact classification resolved in one workspace."""

    WORKSPACE = "workspace"
    PLATFORM = "platform"
    EXTERNAL = "external"


class HumanInputApproverGrantSubjectType(StrEnum):
    """Business subject receiving approval authority for one Human Input form."""

    CONTACT = "contact"
    END_USER = "end_user"
    EMAIL_ADDRESS = "email_address"


class HumanInputSubmissionActorType(StrEnum):
    """Business identity that completed one Human Input form submission."""

    ACCOUNT = "account"
    END_USER = "end_user"
    EMAIL_ADDRESS = "email_address"


class HumanInputAuthorizationProofType(StrEnum):
    """Verified evidence type retained for a Human Input authorization audit event."""

    ACCOUNT_SESSION = "account_session"
    EMAIL_OTP = "email_otp"
    IM_IDENTITY = "im_identity"
    TRUSTED_END_USER = "trusted_end_user"


class HumanInputDeliveryChannel(StrEnum):
    """Notification or interaction channel frozen for one form endpoint."""

    EMAIL = "email"
    IM = "im"
    WEB = "web"
    CONSOLE = "console"


class HumanInputDeliveryAttemptStatus(StrEnum):
    """Delivery lifecycle kept separate from the form state machine."""

    QUEUED = "queued"
    SENDING = "sending"
    SENT = "sent"
    FAILED = "failed"


class HumanInputOTPChallengeStatus(StrEnum):
    """Current usability of an email proof challenge."""

    PENDING = "pending"
    VERIFIED = "verified"
    INVALIDATED = "invalidated"
    EXPIRED = "expired"


class IMProvider(StrEnum):
    """IM provider supported by Human Input contact and delivery flows."""

    FEISHU = "feishu"
    SLACK = "slack"
    DING_TALK = "ding_talk"
    MS_TEAMS = "ms_teams"
    WE_COM = "we_com"
    LARK = "lark"


class IMBindingScope(StrEnum):
    """Resolution scope of a contact-to-IM-identity binding."""

    WORKSPACE = "workspace"
    ORGANIZATION = "organization"


class IMIntegrationStatus(StrEnum):
    """Connectivity state of an organization-level IM integration."""

    NOT_CONFIGURED = "not_configured"
    CONFIGURED = "configured"
    CONNECTED = "connected"
    PERMISSION_ISSUE = "permission_issue"
    CALLBACK_ERROR = "callback_error"
    CONNECTION_ERROR = "connection_error"


class IMIdentityBindingStatus(StrEnum):
    """Whether a synchronized IM identity is currently bound."""

    UNBOUND = "unbound"
    BOUND = "bound"


class IMSyncRunStatus(StrEnum):
    """Lifecycle state of a manual IM directory synchronization."""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class IMSyncResultType(StrEnum):
    """Stable reconciliation bucket for one synchronized directory entry."""

    ADDED = "added"
    NOT_MATCHED = "not_matched"
    FAILED = "failed"
    REMOVED = "removed"
    SKIPPED = "skipped"


class IMSyncRemovalReason(StrEnum):
    """Stable reason for removing or replacing a current IM binding."""

    NOT_PRESENT_IN_DIRECTORY = "not_present_in_directory"
    BINDING_INVALIDATED = "binding_invalidated"
    BINDING_REPLACED = "binding_replaced"


class EmailProviderType(StrEnum):
    """Email provider supported by organization-level Human Input delivery."""

    RESEND = "resend"


# Identifiers for organization candidates and contacts.
OrganizationCandidateId = NewType("OrganizationCandidateId", str)

# Identifiers for contacts.
ContactId = NewType("ContactId", str)

# Identifiers for synced IM identiies. This is not the same as user_id or account_id
# on the IM provier side. It is the identifier for the synced IM user record in Dify.
IMIdentityId = NewType("IMIdentityId", str)

# Identifiers for a full IM user synchorization.
IMSyncRunId = NewType("IMSyncRunId", str)

# Identifier for an IM binding, an association between an IM identity and a Dify contact.
IMBindingId = NewType("IMBindingId", str)


__all__ = [
    "ContactId",
    "EmailProviderType",
    "HumanInputApproverGrantSubjectType",
    "HumanInputAuthorizationProofType",
    "HumanInputContactType",
    "HumanInputDeliveryAttemptStatus",
    "HumanInputDeliveryChannel",
    "HumanInputOTPChallengeStatus",
    "HumanInputSubmissionActorType",
    "IMBindingId",
    "IMBindingScope",
    "IMIdentityBindingStatus",
    "IMIdentityId",
    "IMIntegrationStatus",
    "IMProvider",
    "IMSyncRemovalReason",
    "IMSyncResultType",
    "IMSyncRunId",
    "IMSyncRunStatus",
    "OrganizationCandidateId",
]
