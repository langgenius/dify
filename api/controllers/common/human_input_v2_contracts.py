"""Shared Human Input v2 transport contracts."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue
from pydantic.networks import EmailStr

from core.human_input_v2.entities import ContactId, IMBindingId, IMIdentityId, IMSyncRunId, OrganizationCandidateId
from core.workflow.nodes.human_input.entities import FormInputConfig, UserActionConfig
from core.workflow.nodes.human_input.entities import HumanInputNodeDataFull as HITLv1NoeData
from core.workflow.nodes.human_input_v2.entities import Channel, IMProvider
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData as HITLv2NodeData
from fields.base import ResponseModel
from fields.pagination import PaginationParamsMixin, PaginationResultMixin
from fields.timestamp import Timestamp


class _StrictModel(BaseModel):
    """Base request/query model that forbids unknown fields."""

    model_config = ConfigDict(extra="forbid")


class HumanInputContactType(StrEnum):
    """Concrete contact types exposed by workspace contact APIs."""

    WORKSPACE = "workspace"
    PLATFORM = "platform"
    EXTERNAL = "external"


class ContactListQuery(PaginationParamsMixin, _StrictModel):
    """Query params for listing contacts in the workspace directory."""

    group: HumanInputContactType | None = Field(
        default=None,
        description="Optional contact type filter. None means all contacts.",
    )
    keyword: str | None = Field(default=None, description="Free-text search against contact name or email.")


class OrganizationCandidatesQuery(PaginationParamsMixin, _StrictModel):
    """Query params for searching organization member candidates."""

    keyword: str | None = Field(default=None, description="Free-text search against candidate name or email.")


ExternalContactName = Annotated[
    str,
    Field(
        min_length=1,
        max_length=255,
        description="Display name shown in the contact directory.",
    ),
]

ExternalContactEmail = Annotated[
    EmailStr,
    Field(
        description="Primary email used for delivery and identity verification.",
    ),
]

ExternalContactAvatar = Annotated[
    str,
    Field(
        description=(
            "Optional avatar file ID. Upload the avatar image first via "
            "`POST /console/api/files/upload`, then use the returned file id here."
            "Set to empty string for resetting to default avatar."
        ),
    ),
]


class ExternalContactCreateRequest(_StrictModel):
    """Request body for creating or updating one external contact."""

    name: ExternalContactName
    email: ExternalContactEmail
    avatar: ExternalContactAvatar


class ExternalContactUpdateRequest(_StrictModel):
    """Request body for creating or updating one external contact."""

    name: ExternalContactName | None = None
    email: ExternalContactEmail | None = None
    avatar: ExternalContactAvatar | None = None


class IMBindingScope(StrEnum):
    workspace = "workspace"
    organization = "organization"


class IMBinding(BaseModel):
    id: IMBindingId = Field(description="Unique IM binding identifier.")
    provider: IMProvider = Field(description="Provider of the IM binding.")
    scope: IMBindingScope = Field(description="Scope of the IM binding.")


class HumanInputContactSummary(BaseModel):
    """A trimmed version of `HumanInputContact` that only includes the fields needed for workflow orchestration."""

    id: ContactId = Field(description="Unique contact identifier.")
    name: str = Field(description="Display name shown in the contact directory.")
    avatar_url: str = Field(default="", description="URL of the contact's avatar.")
    created_at: Timestamp = Field(description="Timestamp when the contact was created.")


class HumanInputContact(BaseModel):
    """One contact entity returned by contact-related APIs."""

    id: ContactId = Field(description="Unique contact identifier.")
    type: HumanInputContactType = Field(description="Resolved contact type in the current workspace scope.")
    name: str = Field(description="Display name shown in the contact directory.")
    email: str | None = Field(default=None, description="Primary contact email if one exists.")
    avatar_url: str = Field(default="", description="URL of the contact's avatar.")
    # the `im_bindings` field is always empty for EXTERNAL contacts
    im_bindings: list[IMBinding] = Field(
        default_factory=list[IMBinding],
        description=(
            "IM bindings that are bound to this contact. "
            "Currently, only one IM binding is supported. "
            "There is at most one IM binding per IMProvidr."
        ),
    )

    created_at: Timestamp = Field(description="Timestamp when the contact was created.")


class ExternalContactCreateResponse(ResponseModel):
    contact: HumanInputContact = Field(description="The created external contact.")


class ExternalContactUpdateResponse(ResponseModel):
    contact: HumanInputContact = Field(description="The updated external contact. Fields are values after updating.")


class OrganizationCandidate(ResponseModel):
    """One organization member candidate that may become a platform contact."""

    id: OrganizationCandidateId = Field(description="Organization candidate identifier.")
    name: str = Field(description="Display name shown in the candidate list.")
    email: str = Field(description="Primary organization email used for matching.")
    avatar_url: str | None = Field(default=None, description="Signed avatar URL if one is available.")


class ListContactsResponse(PaginationResultMixin, ResponseModel):
    """Paginated response body for contact list APIs."""

    data: list[HumanInputContact] = Field(description="Contacts returned for the current page.")


class ListOrganizationCandidatesResponse(PaginationResultMixin, ResponseModel):
    """Paginated response body for organization candidate search."""

    data: list[OrganizationCandidate] = Field(
        description="Organization member candidates returned for the current page."
    )


class AddPlatformContactsRequest(_StrictModel):
    """Request body for adding one or more organization members as platform contacts."""

    candidate_ids: list[OrganizationCandidateId] = Field(
        ...,
        min_length=1,
        description="Organization candidate identifiers to project into the current workspace as platform contacts.",
    )


class AddPlatformContactsResponse(ResponseModel):
    """Response body for adding platform contacts."""

    data: list[HumanInputContact] = Field(description="Contacts created by the current add operation.")


class RemoveContactsRequest(_StrictModel):
    """Request body for batch-removing platform or external contacts."""

    contact_ids: list[ContactId] = Field(
        ...,
        min_length=1,
        description="Contact identifiers selected for removal from the contact directory surface.",
    )


class RemoveContactsResponse(ResponseModel):
    """Response body returned after batch-removing contacts."""

    removed_contact_ids: list[ContactId] = Field(description="Contact identifiers removed by the current operation.")


class IMIntegrationStatus(StrEnum):
    """Connectivity state exposed by IM integration APIs."""

    NOT_CONFIGURED = "not_configured"
    CONFIGURED = "configured"
    CONNECTED = "connected"
    PERMISSION_ISSUE = "permission_issue"
    CALLBACK_ERROR = "callback_error"
    CONNECTION_ERROR = "connection_error"


class FeishuIMIntegrationCredentials(_StrictModel):
    """Feishu integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.FEISHU] = Field(description="Discriminator for Feishu integration credentials.")
    app_id: str = Field(description="Feishu application identifier.")
    app_secret: str = Field(description="Feishu application secret.")
    verification_token: str | None = Field(default=None, description="Optional callback verification token.")
    encrypt_key: str | None = Field(default=None, description="Optional callback encrypt key.")


class SlackIMIntegrationCredentials(_StrictModel):
    """Slack integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.SLACK] = Field(description="Discriminator for Slack integration credentials.")
    client_id: str = Field(description="Slack OAuth client identifier.")
    client_secret: str = Field(description="Slack OAuth client secret.")
    signing_secret: str = Field(description="Slack signing secret used to verify callbacks.")
    bot_token: str = Field(description="Slack bot token used for API calls and message delivery.")


class DingTalkIMIntegrationCredentials(_StrictModel):
    """DingTalk integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.DING_TALK] = Field(description="Discriminator for DingTalk integration credentials.")
    client_id: str = Field(description="DingTalk application client identifier.")
    client_secret: str = Field(description="DingTalk application client secret.")


class MSTeamsIMIntegrationCredentials(_StrictModel):
    """Microsoft Teams integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.MS_TEAMS] = Field(
        description="Discriminator for Microsoft Teams integration credentials."
    )
    tenant_id: str = Field(description="Microsoft Entra tenant identifier.")
    client_id: str = Field(description="Microsoft Teams application client identifier.")
    client_secret: str = Field(description="Microsoft Teams application client secret.")


class WeComIMIntegrationCredentials(_StrictModel):
    """WeCom integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.WE_COM] = Field(description="Discriminator for WeCom integration credentials.")
    corp_id: str = Field(description="WeCom corporation identifier.")
    agent_id: str = Field(description="WeCom agent identifier.")
    secret: str = Field(description="WeCom application secret.")


class LarkIMIntegrationCredentials(_StrictModel):
    """Lark integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.LARK] = Field(description="Discriminator for Lark integration credentials.")
    app_id: str = Field(description="Lark application identifier.")
    app_secret: str = Field(description="Lark application secret.")
    verification_token: str | None = Field(default=None, description="Optional callback verification token.")
    encrypt_key: str | None = Field(default=None, description="Optional callback encrypt key.")


IMIntegrationCredentials = Annotated[
    FeishuIMIntegrationCredentials
    | SlackIMIntegrationCredentials
    | DingTalkIMIntegrationCredentials
    | MSTeamsIMIntegrationCredentials
    | WeComIMIntegrationCredentials
    | LarkIMIntegrationCredentials,
    Field(discriminator="provider"),
]


class _IMIntegrationRequest(_StrictModel):
    """Internal shared body for IM integration write/test operations."""

    credentials: IMIntegrationCredentials = Field(description="Provider-specific IM integration credentials.")


class UpdateIMIntegrationRequest(_IMIntegrationRequest):
    """Request body for creating or updating one IM integration."""


class TestIMIntegrationRequest(_IMIntegrationRequest):
    """Request body for testing one IM integration."""


class IMIntegration(ResponseModel):
    """One organization-level IM integration snapshot."""

    provider: IMProvider | None = Field(
        default=None,
        description="Configured IM provider. None is allowed when the integration is not configured.",
    )
    status: IMIntegrationStatus = Field(description="Current integration connectivity state.")
    callback_url: str | None = Field(
        default=None,
        description=(
            "Callback URL expected by the provider. "
            "None if the current deployment uses persistence connections for receive events."
        ),
    )
    permission_hint: str | None = Field(default=None, description="Operator-facing hint about permission issues.")
    configured_at: Timestamp | None = Field(
        default=None, description="Unix timestamp in milliseconds when the integration was created."
    )
    updated_at: Timestamp | None = Field(
        default=None, description="Unix timestamp in milliseconds when the integration was last updated."
    )


class GetIMIntegrationResponse(ResponseModel):
    """Response body carrying one IM integration snapshot."""

    integration: IMIntegration = Field(description="Current organization-level IM integration snapshot.")


class UpdateIMIntegrationResponse(ResponseModel):
    """Response body returned after updating one IM integration."""

    integration: IMIntegration = Field(description="Saved organization-level IM integration snapshot.")


class TestIMIntegrationResponse(ResponseModel):
    """Response body returned by IM integration test APIs."""

    status: IMIntegrationStatus = Field(description="Integration status mapped from the test result.")
    message: str = Field(description="Human-readable explanation of the test result.")


class IMSyncReason(StrEnum):
    """Stable reconciliation reasons exposed by IM sync detail APIs."""

    MATCHED_BY_PROVIDER_USER_ID = "matched_by_provider_user_id"
    MATCHED_BY_EMAIL = "matched_by_email"
    UNMATCHED_IDENTITY = "unmatched_identity"
    PROVIDER_ERROR = "provider_error"
    BINDING_REMOVED = "binding_removed"
    SKIPPED_BY_RULE = "skipped_by_rule"


class IMIdentityBindingStatus(StrEnum):
    """Binding state exposed by synced IM identity APIs."""

    UNBOUND = "unbound"
    BOUND = "bound"


class IMSyncRunStatus(StrEnum):
    """Lifecycle state exposed by IM sync run APIs."""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class IMSyncRunResultCounts(ResponseModel):
    """Aggregate result counts for one IM sync run."""

    total: int = Field(description="Total number of provider entries observed in the current run snapshot.")
    added: int = Field(description="Number of entries newly matched and bound.")
    not_matched: int = Field(description="Number of entries that could not be matched.")
    failed: int = Field(description="Number of entries that failed to reconcile.")
    removed: int = Field(description="Number of entries whose prior binding was removed.")
    skipped: int = Field(description="Number of entries intentionally skipped.")


class IMSyncRun(ResponseModel):
    """One IM sync run snapshot."""

    id: IMSyncRunId = Field(description="Unique sync run identifier.")
    status: IMSyncRunStatus = Field(description="Current lifecycle state of the sync run.")
    started_at: Timestamp | None = Field(
        default=None, description="Unix timestamp in milliseconds when the sync run started."
    )
    finished_at: Timestamp | None = Field(
        default=None, description="Unix timestamp in milliseconds when the sync run finished, if any."
    )
    error_message: str | None = Field(
        default=None,
        description="Terminal error message. Present only when the sync run status is `failed`.",
    )
    result_counts: IMSyncRunResultCounts = Field(
        description="Aggregate reconciliation counts for the current run snapshot.",
    )


class CreateIMSyncRunResponse(ResponseModel):
    """Response body returned after creating one sync run."""

    run: IMSyncRun = Field(description="Newly created sync run snapshot.")


class IMSyncResultType(StrEnum):
    """Stable bucket names exposed by IM sync result APIs."""

    ADDED = "added"
    NOT_MATCHED = "not_matched"
    FAILED = "failed"
    REMOVED = "removed"
    SKIPPED = "skipped"


class IMSyncResultItem(ResponseModel):
    """One paginated reconciliation result entry for the latest sync run."""

    result: IMSyncResultType = Field(description="Result bucket this entry belongs to.")
    provider_user_id: str = Field(description="Provider-side user identifier returned by the IM platform.")
    display_name: str | None = Field(default=None, description="Display name returned by the IM platform.")
    email: str | None = Field(default=None, description="Provider email used for matching.")
    contact_id: ContactId | None = Field(default=None, description="Matched Dify contact identifier, if any.")
    reason: IMSyncReason | None = Field(
        default=None, description="Stable reconciliation reason exposed to API clients."
    )


class GetLatestIMSyncRunResponse(ResponseModel):
    """Response body for reading the latest IM sync run summary."""

    run: IMSyncRun = Field(description="Latest sync run summary.")


class ListLatestIMSyncRunResultsQuery(PaginationParamsMixin, _StrictModel):
    """Query params for reading paginated latest-run results."""

    result: IMSyncResultType = Field(description="Result bucket to paginate from the latest sync run.")


class ListLatestIMSyncRunResultsResponse(PaginationResultMixin, ResponseModel):
    """Paginated response body for latest-run result APIs."""

    run: IMSyncRun = Field(description="Latest sync run summary associated with the current result page.")
    data: list[IMSyncResultItem] = Field(description="Result entries returned for the selected bucket and page.")


class ListIMIdentitiesQuery(PaginationParamsMixin, _StrictModel):
    """Query params for searching synced IM identities."""

    keyword: str | None = Field(default=None, description="Free-text search against identity display name or email.")


class IMIdentity(ResponseModel):
    """One synced IM identity that may be bound or overridden."""

    id: IMIdentityId = Field(description="Internal IM identity record identifier.")
    provider: IMProvider = Field(description="IM provider that owns this identity.")
    provider_user_id: str = Field(description="Provider-side user identifier.")
    display_name: str | None = Field(default=None, description="Display name returned by the provider.")
    email: str | None = Field(default=None, description="Email returned by the provider, if any.")
    binding_status: IMIdentityBindingStatus = Field(
        description="Whether this IM identity is currently bound to a contact."
    )


class ListIMIdentitiesResponse(PaginationResultMixin, ResponseModel):
    """Paginated response body for synced IM identity search."""

    data: list[IMIdentity] = Field(description="IM identities returned for the current page.")


class SetContactIMOverrideRequest(_StrictModel):
    """Request body for setting one workspace-scoped IM override."""

    identity_id: IMIdentityId = Field(description="Synced IM identity identifier selected as the workspace override.")


class SetContactIMOverrideResponse(ResponseModel):
    """Response body returned after setting one contact IM override."""

    contact: HumanInputContact = Field(description="Contact snapshot after the override is applied.")


class ResetContactIMOverrideResponse(ResponseModel):
    """Response body returned after resetting one contact IM override."""

    contact: HumanInputContact = Field(description="Contact snapshot after the override is cleared.")


class CreateIMBindingRequest(_StrictModel):
    """Request body for setting one workspace-scoped IM override."""

    identity_id: IMIdentityId = Field(description="Synced IM identity identifier selected as the workspace override.")


class CreateIMBindingResponse(ResponseModel):
    """Response body returned after binding one IM identity to the workspace."""

    contact: HumanInputContact = Field(description="Contact snapshot after the IM identity is bound.")


class DeleteIMBindingQuery(_StrictModel):
    binding_id: IMBindingId = Field(description="IM binding to unbind.")


class DeleteIMBindingResponse(ResponseModel):
    pass


class MessageTemplateTestRequest(_StrictModel):
    """Request body for sending one message-template test notification."""

    channel: Channel = Field(description="Target debug delivery channel used for the test send.")
    inputs: dict[str, JsonValue] = Field(
        default_factory=dict,
        description="Variable values used when rendering the message template preview.",
    )


class MessageTemplateTestResponse(ResponseModel):
    """Response body returned after one message-template test send."""


class FormAccessRequestResponse(ResponseModel):
    """Response body returned after creating one OTP challenge."""

    expires_in_seconds: int = Field(description="Seconds until the current OTP challenge expires.")
    challenge_token: str = Field(description="The token used to complete the OTP challenge.")


class FormDefinitionResponse(ResponseModel):
    """Response body containing a resolved human-input form definition."""

    form_content: str | None = Field(default=None, description="Rendered form body shown to the approver.")
    inputs: list[FormInputConfig] = Field(default_factory=list, description="Resolved form input definitions.")
    resolved_default_values: dict[str, str] = Field(
        default_factory=dict,
        description="Default values after variable resolution and stringification.",
    )
    user_actions: list[UserActionConfig] = Field(
        default_factory=list,
        description="Action buttons that can complete the form.",
    )
    expiration_time: int = Field(description="Unix timestamp when the current form expires.")


class ServiceFormQuery(_StrictModel):
    """Query params for reading one service-api human-input form."""

    user: str = Field(description="End-user identifier used to scope the service API request.")


class BatchGetContactsQuery(BaseModel):
    contact_ids: list[ContactId] = Field(..., description="List of contact IDs to retrieve.")


class BatchGetContactsResponse(PaginationResultMixin, ResponseModel):
    data: list[HumanInputContactSummary] = Field(..., description="List of retrieved human input contacts.")


class CreateNodeDataMigrationRequest(BaseModel):
    node_data: HITLv1NoeData


class CreateHITLMigrationResponse(ResponseModel):
    node_data: HITLv2NodeData


__all__ = [
    "AddPlatformContactsRequest",
    "AddPlatformContactsResponse",
    "ContactListQuery",
    "CreateIMSyncRunResponse",
    "DingTalkIMIntegrationCredentials",
    "ExternalContactCreateRequest",
    "ExternalContactUpdateRequest",
    "FeishuIMIntegrationCredentials",
    "FormAccessRequestResponse",
    "FormDefinitionResponse",
    "GetIMIntegrationResponse",
    "GetLatestIMSyncRunResponse",
    "HumanInputContact",
    "HumanInputContactType",
    "IMIdentity",
    "IMIdentityBindingStatus",
    "IMIntegration",
    "IMIntegrationCredentials",
    "IMIntegrationStatus",
    "IMProvider",
    "IMSyncReason",
    "IMSyncResultItem",
    "IMSyncResultType",
    "IMSyncRun",
    "IMSyncRunResultCounts",
    "IMSyncRunStatus",
    "LarkIMIntegrationCredentials",
    "ListContactsResponse",
    "ListIMIdentitiesQuery",
    "ListIMIdentitiesResponse",
    "ListLatestIMSyncRunResultsQuery",
    "ListLatestIMSyncRunResultsResponse",
    "ListOrganizationCandidatesResponse",
    "MSTeamsIMIntegrationCredentials",
    "MessageTemplateTestRequest",
    "MessageTemplateTestResponse",
    "OrganizationCandidate",
    "OrganizationCandidatesQuery",
    "RemoveContactsRequest",
    "RemoveContactsResponse",
    "ResetContactIMOverrideResponse",
    "ServiceFormQuery",
    "SetContactIMOverrideRequest",
    "SetContactIMOverrideResponse",
    "SlackIMIntegrationCredentials",
    "TestIMIntegrationRequest",
    "TestIMIntegrationResponse",
    "UpdateIMIntegrationRequest",
    "UpdateIMIntegrationResponse",
    "WeComIMIntegrationCredentials",
]
