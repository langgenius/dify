"""Shared Human Input v2 transport contracts."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from core.workflow.nodes.human_input.entities import FormInputConfig, UserActionConfig
from core.workflow.nodes.human_input_v2.entities import DebugChannel, IMProvider
from fields.base import ResponseModel


class _StrictModel(BaseModel):
    """Base request/query model that forbids unknown fields."""

    model_config = ConfigDict(extra="forbid")


class HumanInputContactType(StrEnum):
    """Concrete contact types exposed by workspace contact APIs."""

    WORKSPACE = "workspace"
    PLATFORM = "platform"
    EXTERNAL = "external"


class ContactListQuery(_StrictModel):
    """Query params for listing contacts in the workspace directory."""

    group: HumanInputContactType | None = Field(
        default=None,
        description="Optional contact type filter. None means all contacts.",
    )
    keyword: str | None = Field(default=None, description="Free-text search against contact name or email.")
    page: int = Field(default=1, ge=1, description="1-based page number.")
    limit: int = Field(default=20, ge=1, le=100, description="Maximum number of records returned per page.")


class OrganizationCandidatesQuery(_StrictModel):
    """Query params for searching organization member candidates."""

    keyword: str | None = Field(default=None, description="Free-text search against candidate name or email.")
    page: int = Field(default=1, ge=1, description="1-based page number.")
    limit: int = Field(default=20, ge=1, le=100, description="Maximum number of records returned per page.")


class ExternalContactRequest(_StrictModel):
    """Request body for creating or updating one external contact."""

    name: str = Field(..., min_length=1, max_length=255, description="Display name shown in the contact directory.")
    email: str = Field(..., description="Primary email used for delivery and identity verification.")
    avatar: str | None = Field(
        default=None,
        description=(
            "Optional avatar file ID. Upload the avatar image first via "
            "`POST /console/api/files/upload`, then use the returned file id here."
        ),
    )


class HumanInputContact(ResponseModel):
    """One contact entity returned by contact-related APIs."""

    id: str = Field(description="Unique contact identifier.")
    type: HumanInputContactType = Field(description="Resolved contact type in the current workspace scope.")
    name: str = Field(description="Display name shown in the contact directory.")
    email: str | None = Field(default=None, description="Primary contact email if one exists.")


class ContactResponse(ResponseModel):
    """Response body carrying one contact entity."""

    contact: HumanInputContact = Field(description="Contact returned by the current mutation or lookup.")


class OrganizationCandidate(ResponseModel):
    """One organization member candidate that may become a platform contact."""

    id: str = Field(description="Organization member identifier.")
    name: str = Field(description="Display name shown in the candidate list.")
    email: str = Field(description="Primary organization email used for matching.")
    avatar_url: str | None = Field(default=None, description="Signed avatar URL if one is available.")


class ListContactsResponse(ResponseModel):
    """Paginated response body for contact list APIs."""

    data: list[HumanInputContact] = Field(description="Contacts returned for the current page.")
    has_more: bool = Field(description="Whether more pages are available after this one.")
    limit: int = Field(description="Page size used for the current query.")
    total: int = Field(description="Total number of contacts matching the current query.")
    page: int = Field(description="Current 1-based page number.")


class ListOrganizationCandidatesResponse(ResponseModel):
    """Paginated response body for organization candidate search."""

    data: list[OrganizationCandidate] = Field(description="Organization member candidates returned for the current page.")
    has_more: bool = Field(description="Whether more pages are available after this one.")
    limit: int = Field(description="Page size used for the current query.")
    total: int = Field(description="Total number of candidates matching the current query.")
    page: int = Field(description="Current 1-based page number.")


class AddPlatformContactsRequest(_StrictModel):
    """Request body for adding one or more organization members as platform contacts."""

    member_ids: list[str] = Field(
        ...,
        min_length=1,
        description="Organization member identifiers to project into the current workspace as platform contacts.",
    )


class AddPlatformContactsResponse(ResponseModel):
    """Response body for adding platform contacts."""

    data: list[HumanInputContact] = Field(description="Contacts created by the current add operation.")
    total: int = Field(description="Number of platform contacts added by the current operation.")


class RemoveContactsRequest(_StrictModel):
    """Request body for batch-removing platform or external contacts."""

    contact_ids: list[str] = Field(
        ...,
        min_length=1,
        description="Contact identifiers selected for removal from the contact directory surface.",
    )


class RemoveContactsResponse(ResponseModel):
    """Response body returned after batch-removing contacts."""

    removed_contact_ids: list[str] = Field(description="Contact identifiers removed by the current operation.")


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

    provider: Literal[IMProvider.MS_TEAMS] = Field(description="Discriminator for Microsoft Teams integration credentials.")
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
    callback_url: str | None = Field(default=None, description="Callback URL expected by the provider.")
    permission_hint: str | None = Field(default=None, description="Operator-facing hint about permission issues.")
    configured_at: int | None = Field(default=None, description="Unix timestamp when the integration was created.")
    updated_at: int | None = Field(default=None, description="Unix timestamp when the integration was last updated.")


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


class IMSyncRun(ResponseModel):
    """One IM sync run snapshot."""

    id: str = Field(description="Unique sync run identifier.")
    status: IMSyncRunStatus = Field(description="Current lifecycle state of the sync run.")
    started_at: int | None = Field(default=None, description="Unix timestamp when the sync run started.")
    finished_at: int | None = Field(default=None, description="Unix timestamp when the sync run finished, if any.")
    triggered_by: str | None = Field(default=None, description="Operator or system actor that triggered the sync.")
    error_message: str | None = Field(
        default=None,
        description="Terminal error message. Present only when the sync run status is `failed`.",
    )


class CreateIMSyncRunResponse(ResponseModel):
    """Response body returned after creating one sync run."""

    run: IMSyncRun = Field(description="Newly created sync run snapshot.")


class ListIMSyncRunsQuery(_StrictModel):
    """Query params for listing IM sync runs."""

    page: int = Field(default=1, ge=1, description="1-based page number.")
    limit: int = Field(default=20, ge=1, le=100, description="Maximum number of runs returned per page.")


class ListIMSyncRunsResponse(ResponseModel):
    """Paginated response body for IM sync run list APIs."""

    data: list[IMSyncRun] = Field(description="Sync runs returned for the current page.")
    has_more: bool = Field(description="Whether more pages are available after this one.")
    limit: int = Field(description="Page size used for the current query.")
    total: int = Field(description="Total number of sync runs matching the current query.")
    page: int = Field(description="Current 1-based page number.")


class IMSyncItem(ResponseModel):
    """One reconciliation item inside a sync run detail."""

    provider_user_id: str = Field(description="Provider-side user identifier returned by the IM platform.")
    display_name: str | None = Field(default=None, description="Display name returned by the IM platform.")
    email: str | None = Field(default=None, description="Provider email used for matching.")
    contact_id: str | None = Field(default=None, description="Matched Dify contact identifier, if any.")
    reason: IMSyncReason | None = Field(default=None, description="Stable reconciliation reason exposed to API clients.")


class GetIMSyncRunResponse(ResponseModel):
    """Detailed response body for one IM sync run."""

    run: IMSyncRun = Field(description="Sync run snapshot.")
    added: list[IMSyncItem] = Field(default_factory=list, description="Items newly matched and bound.")
    not_matched: list[IMSyncItem] = Field(default_factory=list, description="Items that could not be matched.")
    failed: list[IMSyncItem] = Field(default_factory=list, description="Items that failed to reconcile.")
    removed: list[IMSyncItem] = Field(default_factory=list, description="Items whose prior binding was removed.")
    skipped: list[IMSyncItem] = Field(default_factory=list, description="Items intentionally skipped.")


class ListIMIdentitiesQuery(_StrictModel):
    """Query params for searching synced IM identities."""

    keyword: str | None = Field(default=None, description="Free-text search against identity display name or email.")
    provider: IMProvider | None = Field(default=None, description="Optional IM provider filter.")
    page: int = Field(default=1, ge=1, description="1-based page number.")
    limit: int = Field(default=20, ge=1, le=100, description="Maximum number of records returned per page.")


class IMIdentity(ResponseModel):
    """One synced IM identity that may be bound or overridden."""

    id: str = Field(description="Internal IM identity record identifier.")
    provider: IMProvider = Field(description="IM provider that owns this identity.")
    provider_user_id: str = Field(description="Provider-side user identifier.")
    display_name: str | None = Field(default=None, description="Display name returned by the provider.")
    email: str | None = Field(default=None, description="Email returned by the provider, if any.")
    binding_status: IMIdentityBindingStatus = Field(description="Whether this IM identity is currently bound to a contact.")


class ListIMIdentitiesResponse(ResponseModel):
    """Paginated response body for synced IM identity search."""

    data: list[IMIdentity] = Field(description="IM identities returned for the current page.")
    has_more: bool = Field(description="Whether more pages are available after this one.")
    limit: int = Field(description="Page size used for the current query.")
    total: int = Field(description="Total number of IM identities matching the current query.")
    page: int = Field(description="Current 1-based page number.")


class SetContactIMOverrideRequest(_StrictModel):
    """Request body for setting one workspace-scoped IM override."""

    identity_id: str = Field(description="Synced IM identity identifier selected as the workspace override.")


class SetContactIMOverrideResponse(ResponseModel):
    """Response body returned after setting one contact IM override."""

    contact: HumanInputContact = Field(description="Contact snapshot after the override is applied.")


class ResetContactIMOverrideResponse(ResponseModel):
    """Response body returned after resetting one contact IM override."""

    contact: HumanInputContact = Field(description="Contact snapshot after the override is cleared.")


class MessageTemplateTestRequest(_StrictModel):
    """Request body for sending one message-template test notification."""

    channel: DebugChannel = Field(description="Target debug delivery channel used for the test send.")
    inputs: dict[str, JsonValue] = Field(
        default_factory=dict,
        description="Variable values used when rendering the message template preview.",
    )


class MessageTemplateTestResponse(ResponseModel):
    """Response body returned after one message-template test send."""


class FormPreviewRequest(_StrictModel):
    """Request body for previewing one draft human-input form."""

    inputs: dict[str, JsonValue] = Field(
        default_factory=dict,
        description="Values used to fill missing upstream variables referenced in the form template.",
    )


class FormPreviewResponse(ResponseModel):
    """Response body returned by draft human-input preview APIs."""

    form_id: str = Field(description="Preview form identifier.")
    node_id: str = Field(description="Workflow node identifier.")
    node_title: str = Field(description="Workflow node title shown in the editor.")
    form_content: str = Field(description="Rendered preview form body.")
    inputs: list[FormInputConfig] = Field(default_factory=list, description="Resolved preview input definitions.")
    actions: list[UserActionConfig] = Field(default_factory=list, description="Available preview action buttons.")
    display_in_ui: bool | None = Field(default=None, description="Whether the form is configured to display in UI.")
    form_token: str | None = Field(default=None, description="Preview form token if one is generated.")
    resolved_default_values: dict[str, JsonValue] = Field(
        default_factory=dict,
        description="Default values after variable resolution for the preview run.",
    )
    expiration_time: int | None = Field(default=None, description="Unix timestamp when the preview form expires.")


class FormSubmitRequest(_StrictModel):
    """Request body for submitting one human-input form."""

    form_inputs: dict[str, JsonValue] = Field(description="Values provided for the form's own fields.")
    inputs: dict[str, JsonValue] = Field(
        description="Values used to fill missing upstream variables referenced in the form template.",
    )
    action: str = Field(description="Identifier of the selected action button.")


class FormSubmitResponse(ResponseModel):
    """Response body returned after one form submit succeeds."""


class FormAccessRequestResponse(ResponseModel):
    """Response body returned after creating one OTP challenge."""

    resend_after_seconds: int = Field(description="Seconds until the caller may request another OTP.")
    expires_in_seconds: int = Field(description="Seconds until the current OTP challenge expires.")


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


class WebFormSubmitRequest(_StrictModel):
    """Request body for submitting one public web human-input form."""

    inputs: dict[str, JsonValue] = Field(description="Submitted form values keyed by output variable name.")
    action: str = Field(description="Identifier of the selected action button.")
    otp_code: str = Field(description="OTP code required by the public web submit flow.")


class UploadTokenRequest(_StrictModel):
    """Request body for issuing one upload token."""


class UploadTokenResponse(ResponseModel):
    """Response body returned after issuing one upload token."""

    upload_token: str = Field(description="Temporary token used by subsequent human-input file upload requests.")
    expires_at: int = Field(description="Unix timestamp when the upload token expires.")


class ServiceFormQuery(_StrictModel):
    """Query params for reading one service-api human-input form."""

    user: str = Field(description="End-user identifier used to scope the service API request.")


class ServiceFormSubmitRequest(_StrictModel):
    """Request body for submitting one service-api human-input form."""

    user: str = Field(description="End-user identifier used to scope the service API request.")
    inputs: dict[str, JsonValue] = Field(description="Submitted form values keyed by output variable name.")
    action: str = Field(description="Identifier of the selected action button.")


__all__ = [
    "AddPlatformContactsRequest",
    "AddPlatformContactsResponse",
    "ContactListQuery",
    "ContactResponse",
    "DebugChannel",
    "DingTalkIMIntegrationCredentials",
    "ExternalContactRequest",
    "FeishuIMIntegrationCredentials",
    "FormAccessRequestResponse",
    "FormDefinitionResponse",
    "FormPreviewRequest",
    "FormPreviewResponse",
    "FormSubmitRequest",
    "FormSubmitResponse",
    "GetIMIntegrationResponse",
    "GetIMSyncRunResponse",
    "HumanInputContact",
    "HumanInputContactType",
    "IMIdentity",
    "IMIdentityBindingStatus",
    "IMIntegration",
    "IMIntegrationCredentials",
    "IMIntegrationStatus",
    "IMProvider",
    "IMSyncItem",
    "IMSyncReason",
    "IMSyncRun",
    "IMSyncRunStatus",
    "LarkIMIntegrationCredentials",
    "ListContactsResponse",
    "ListIMIdentitiesQuery",
    "ListIMIdentitiesResponse",
    "ListIMSyncRunsQuery",
    "ListIMSyncRunsResponse",
    "ListOrganizationCandidatesResponse",
    "MessageTemplateTestRequest",
    "MessageTemplateTestResponse",
    "MSTeamsIMIntegrationCredentials",
    "OrganizationCandidate",
    "OrganizationCandidatesQuery",
    "RemoveContactsRequest",
    "RemoveContactsResponse",
    "ResetContactIMOverrideResponse",
    "ServiceFormQuery",
    "ServiceFormSubmitRequest",
    "SetContactIMOverrideRequest",
    "SetContactIMOverrideResponse",
    "SlackIMIntegrationCredentials",
    "TestIMIntegrationRequest",
    "TestIMIntegrationResponse",
    "UpdateIMIntegrationRequest",
    "UpdateIMIntegrationResponse",
    "UploadTokenRequest",
    "UploadTokenResponse",
    "WebFormSubmitRequest",
    "WeComIMIntegrationCredentials",
    "CreateIMSyncRunResponse",
]
