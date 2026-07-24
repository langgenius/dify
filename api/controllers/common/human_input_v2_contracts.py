"""Shared Human Input v2 transport contracts.

Request DTOs use normal Pydantic coercion and forbid unknown fields. Migration
input is the sole compatibility exception: it ignores unknown legacy fields,
defaults a missing version to ``"1"``, rejects any other explicit version, and
rejects duplicate node IDs. Its transport shape mirrors the frontend migration
adapter so the generated client can replace the temporary mock without changing
frontend orchestration.
Public v2, trusted Service API v2, and legacy v1 submit DTOs stay independent.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Annotated, Literal, Self, Union

from pydantic import BaseModel, ConfigDict, Discriminator, Field, JsonValue, model_validator

from core.human_input_v2.entities import (
    ContactId,
    EmailProviderType,
    HumanInputContactType,
    IMBindingId,
    IMBindingScope,
    IMIdentityBindingStatus,
    IMIdentityId,
    IMIntegrationStatus,
    IMProvider,
    IMSyncRemovalReason,
    IMSyncResultType,
    IMSyncRunId,
    IMSyncRunStatus,
    OrganizationCandidateId,
)
from core.workflow.nodes.human_input.entities import FormInputConfig, UserActionConfig
from core.workflow.nodes.human_input.entities import HumanInputNodeDataFull as HITLv1NodeData
from core.workflow.nodes.human_input_v2.entities import Channel
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData as HITLv2NodeData
from fields.base import ResponseModel
from fields.pagination import PaginationParamsMixin, PaginationResultMixin
from fields.timestamp import Timestamp
from libs.helper import EmailStr


class _NoExtraModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _RequestModel(BaseModel):
    """Base request model that forbids unknown fields while accepting JSON-native values."""

    model_config = ConfigDict(extra="forbid")


class _MigrationInputModel(BaseModel):
    """Forward-compatible migration input that ignores fields unknown to this backend version."""

    model_config = ConfigDict(extra="ignore")


class ContactListQuery(PaginationParamsMixin, _NoExtraModel):
    """Query params for listing contacts in the workspace directory."""

    group: HumanInputContactType | None = Field(
        default=None,
        description="Optional contact type filter. None means all contacts.",
    )
    keyword: str | None = Field(default=None, description="Free-text search against contact name or email.")


class ContactOptionsQuery(PaginationParamsMixin, _NoExtraModel):
    """Query params for selecting contacts in workflow editors."""

    keyword: str | None = Field(default=None, description="Free-text search against selectable contact names.")


class OrganizationCandidatesQuery(PaginationParamsMixin, _NoExtraModel):
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
            " Set to empty string for resetting to default avatar."
        ),
    ),
]


class ExternalContactCreateRequest(_RequestModel):
    """Request body for creating or updating one external contact."""

    name: ExternalContactName
    email: ExternalContactEmail
    avatar: ExternalContactAvatar | None = None


class ExternalContactUpdateRequest(_RequestModel):
    """Request body for creating or updating one external contact."""

    name: ExternalContactName | None = None
    email: ExternalContactEmail | None = None
    avatar: ExternalContactAvatar | None = None


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
            "There is at most one IM binding per IM provider."
        ),
    )

    created_at: Timestamp = Field(description="Timestamp when the contact was created.")


class ContactOption(ResponseModel):
    """Least-privilege contact projection returned to workflow editors."""

    id: ContactId = Field(description="Unique contact identifier persisted in workflow recipient configuration.")
    type: HumanInputContactType = Field(description="Resolved contact type in the current workspace scope.")
    name: str = Field(description="Display name shown in the contact picker.")
    avatar_url: str | None = Field(default=None, description="Signed avatar URL if one is available.")


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


class ListContactOptionsResponse(PaginationResultMixin, ResponseModel):
    """Paginated editor-safe contact picker response."""

    data: list[ContactOption] = Field(description="Selectable contacts returned for the current page.")


class GetContactResponse(ResponseModel):
    """Response body for one contact resolved in the current workspace scope."""

    contact: HumanInputContact = Field(description="Contact resolved as workspace, platform, or external.")


class ListOrganizationCandidatesResponse(PaginationResultMixin, ResponseModel):
    """Paginated response body for organization candidate search."""

    data: list[OrganizationCandidate] = Field(
        description="Organization member candidates returned for the current page."
    )


class AddPlatformContactsRequest(_RequestModel):
    """Request body for adding one or more organization members as platform contacts."""

    candidate_ids: list[OrganizationCandidateId] = Field(
        ...,
        min_length=1,
        description="Organization candidate identifiers to project into the current workspace as platform contacts.",
    )


class AddPlatformContactsResponse(ResponseModel):
    """Response body for adding platform contacts."""

    data: list[HumanInputContact] = Field(description="Contacts created by the current add operation.")


class RemoveContactsRequest(_RequestModel):
    """Request body for batch-removing platform or external contacts."""

    contact_ids: list[ContactId] = Field(
        ...,
        min_length=1,
        description="Contact identifiers selected for removal from the contact directory surface.",
    )


class RemoveContactsResponse(ResponseModel):
    """Response body returned after batch-removing contacts."""

    removed_contact_ids: list[ContactId] = Field(description="Contact identifiers removed by the current operation.")


class _FeishuLarkIMIntegrationCredentialsBase(_RequestModel):
    """Shared credential fields for Feishu and Lark integrations."""

    app_id: str = Field(description="Feishu or Lark application identifier.")
    app_secret: str | PreserveOriginalValue = Field(description="Feishu or Lark application secret.")
    verification_token: str | PreserveOriginalValue | None = Field(
        default=None, description="Optional callback verification token."
    )
    encrypt_key: str | PreserveOriginalValue | None = Field(default=None, description="Optional callback encrypt key.")


class FeishuIMIntegrationCredentials(_FeishuLarkIMIntegrationCredentialsBase):
    """Feishu integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.FEISHU] = Field(description="Discriminator for Feishu integration credentials.")


class LarkIMIntegrationCredentials(_FeishuLarkIMIntegrationCredentialsBase):
    """Lark integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.LARK] = Field(description="Discriminator for Lark integration credentials.")


class SlackIMIntegrationCredentials(_RequestModel):
    """Slack integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.SLACK] = Field(description="Discriminator for Slack integration credentials.")
    client_id: str = Field(description="Slack OAuth client identifier.")
    client_secret: str | PreserveOriginalValue = Field(description="Slack OAuth client secret.")
    signing_secret: str | PreserveOriginalValue = Field(description="Slack signing secret used to verify callbacks.")
    bot_token: str | PreserveOriginalValue = Field(
        description="Slack bot token used for API calls and message delivery."
    )


class DingTalkIMIntegrationCredentials(_RequestModel):
    """DingTalk integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.DING_TALK] = Field(description="Discriminator for DingTalk integration credentials.")
    client_id: str = Field(description="DingTalk application client identifier.")
    client_secret: str | PreserveOriginalValue = Field(
        description="DingTalk application client secret. This field will be masked in response."
    )


class MSTeamsIMIntegrationCredentials(_RequestModel):
    """Microsoft Teams integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.MS_TEAMS] = Field(
        description="Discriminator for Microsoft Teams integration credentials."
    )
    tenant_id: str = Field(description="Microsoft Entra tenant identifier.")
    client_id: str = Field(description="Microsoft Teams application client identifier.")
    client_secret: str | PreserveOriginalValue = Field(
        description="Microsoft Teams application client secret. This field will be masked in response"
    )


class WeComIMIntegrationCredentials(_RequestModel):
    """WeCom integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.WE_COM] = Field(description="Discriminator for WeCom integration credentials.")
    corp_id: str = Field(description="WeCom corporation identifier.")
    agent_id: str = Field(description="WeCom agent identifier.")
    secret: str | PreserveOriginalValue = Field(
        description="WeCom application secret. This field will be masked in response"
    )


IMIntegrationCredentials = Annotated[
    FeishuIMIntegrationCredentials
    | LarkIMIntegrationCredentials
    | SlackIMIntegrationCredentials
    | DingTalkIMIntegrationCredentials
    | MSTeamsIMIntegrationCredentials
    | WeComIMIntegrationCredentials,
    Field(discriminator="provider"),
]


class _IMIntegrationRequest(_RequestModel):
    """Internal shared body for IM integration write/test operations."""

    credentials: IMIntegrationCredentials = Field(description="Provider-specific IM integration credentials.")


class UpdateIMIntegrationRequest(_IMIntegrationRequest):
    """Request body for creating or updating one IM integration."""

    expected_integration_id: str | None = Field(
        default=None,
        min_length=1,
        description="Current integration identifier used with expected_config_version for compare-and-swap.",
    )
    expected_config_version: int | None = Field(
        default=None,
        ge=1,
        description="Current integration revision used with expected_integration_id for compare-and-swap.",
    )

    @model_validator(mode="after")
    def validate_complete_cas_token(self) -> Self:
        has_integration_id = self.expected_integration_id is not None
        has_config_version = self.expected_config_version is not None
        if has_integration_id != has_config_version:
            raise ValueError("expected_integration_id and expected_config_version must be provided together")
        return self


class DeleteIMIntegrationQuery(_NoExtraModel):
    """CAS token required when deleting the current IM integration."""

    expected_integration_id: str = Field(min_length=1, description="Current integration identifier.")
    expected_config_version: int = Field(ge=1, description="Current integration revision.")


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
    integration_id: str | None = Field(
        default=None,
        description="Stable integration identifier. None when no integration is configured.",
    )
    config_version: int | None = Field(
        default=None,
        ge=1,
        description="Monotonic configuration revision. None when no integration is configured.",
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


class IMSyncRunResultCounts(ResponseModel):
    """Aggregate result counts for one IM sync run."""

    added: int = Field(description="Number of entries newly matched and bound.")
    not_matched: int = Field(description="Number of entries that could not be matched.")
    failed: int = Field(description="Number of entries that failed to reconcile.")
    removed: int = Field(description="Number of entries whose prior binding was removed.")
    skipped: int = Field(description="Number of entries intentionally skipped.")


class IMSyncRun(ResponseModel):
    """One IM sync run snapshot.

    The latest-only UI displays ``finished_at`` as the explicit sync time. The
    transport contract intentionally does not expose a ``started_by`` actor.
    """

    id: IMSyncRunId = Field(description="Unique sync run identifier.")
    status: IMSyncRunStatus = Field(description="Current lifecycle state of the sync run.")
    started_at: Timestamp | None = Field(
        default=None, description="Unix timestamp in milliseconds when the sync run started."
    )
    finished_at: Timestamp | None = Field(
        default=None,
        description=(
            "Unix timestamp in milliseconds when the sync run finished. "
            "This is the sync time displayed by the latest-only UI and is None while the run is unfinished."
        ),
    )
    error_message: str | None = Field(
        default=None,
        description="Terminal error message. Present only when the sync run status is `failed`.",
    )
    result_counts: IMSyncRunResultCounts = Field(
        description="Aggregate reconciliation counts for the current run snapshot.",
    )
    provider: IMProvider = Field(description="IM provider associated with the sync run.")
    integration_id: str = Field(description="Integration identifier captured when the sync run was created.")
    integration_config_version: int = Field(
        ge=1,
        description="Integration configuration revision captured when the sync run was created.",
    )


class CreateIMSyncRunResponse(ResponseModel):
    """Response body returned after creating one sync run."""

    run: IMSyncRun = Field(description="Newly created sync run snapshot.")


class IMDirectoryEntry(_RequestModel):
    """Normalized provider-side account observed during an IM sync run.

    The entry is run-scoped input to identity and binding reconciliation. It does
    not represent a stable Dify identity and must not be referenced by bindings
    or runtime authorization. Sync results may retain a snapshot for display,
    diagnostics, and audit; durable references use IMIdentity or IMBinding IDs.
    """

    provider_user_id: str
    display_name: str | None = None
    email: str | None = None


class IMIdentitySnapshot(_RequestModel):
    """Last known persistent IM identity state retained by a sync result."""

    identity_id: IMIdentityId
    provider_user_id: str
    display_name: str | None = None
    email: str | None = None


class IMSyncResultAdded(BaseModel):
    type: Literal[IMSyncResultType.ADDED] = IMSyncResultType.ADDED

    contact: HumanInputContactSummary = Field(description="The contact that associated with this sync result.")
    entry: IMDirectoryEntry = Field(description="Provider directory entry observed during the current sync run.")


class IMSyncResultRemoved(BaseModel):
    type: Literal[IMSyncResultType.REMOVED] = IMSyncResultType.REMOVED

    contact: HumanInputContactSummary = Field(description="The contact that associated with this sync result.")
    last_known_identity: IMIdentitySnapshot = Field(
        description="Last known persistent IM identity state before its binding was removed."
    )
    reason: IMSyncRemovalReason = Field(description="Reason the existing IM binding was removed.")


class IMSyncResultFailed(BaseModel):
    type: Literal[IMSyncResultType.FAILED] = IMSyncResultType.FAILED

    entry: IMDirectoryEntry | None = Field(
        None, description="Provider directory entry observed before this reconciliation failure, if available."
    )
    reason: str = Field(description="Reason the binding failed to sync.")


class IMSyncResultSkipped(BaseModel):
    type: Literal[IMSyncResultType.SKIPPED] = IMSyncResultType.SKIPPED

    entry: IMDirectoryEntry | None = Field(
        None, description="Provider directory entry observed before reconciliation was skipped, if available."
    )
    contact: HumanInputContactSummary = Field(description="The contact that associated with this sync result.")


class IMSyncResultNotMatched(BaseModel):
    type: Literal[IMSyncResultType.NOT_MATCHED] = IMSyncResultType.NOT_MATCHED

    entry: IMDirectoryEntry | None = Field(
        None, description="Provider directory entry that could not be matched, if available."
    )


IMSyncResult = Annotated[
    Union[
        IMSyncResultAdded,
        IMSyncResultRemoved,
        IMSyncResultFailed,
        IMSyncResultNotMatched,
        IMSyncResultSkipped,
    ],
    Discriminator("type"),
]


class IMSyncResultItem(ResponseModel):
    """One paginated reconciliation result entry for the latest sync run."""

    # The current implementation does not return IM binding status for other IM providers.
    # According to the design, we should return IM binding status for all configured IM providers.
    # However, this version allows only one configured IM provider, so this model excludes
    # the IM binding status for other IM providers.

    id: str = Field(description="Unique synchronization result identifier.")
    result: IMSyncResult = Field(description="Result bucket this entry belongs to.")


class GetLatestIMSyncRunResponse(ResponseModel):
    """Response body for reading the latest IM sync run summary."""

    run: IMSyncRun = Field(description="Latest sync run summary.")


class ListLatestIMSyncRunResultsQuery(PaginationParamsMixin, _NoExtraModel):
    """Query params for reading paginated latest-run results."""

    result: IMSyncResultType = Field(
        ...,
        description=(
            "Required result bucket to paginate from the latest sync run. "
            "There is no `all` bucket or unfiltered results mode."
        ),
    )


class ListLatestIMSyncRunResultsResponse(PaginationResultMixin, ResponseModel):
    """Page-based latest-run results without cursor state or a repeated run summary."""

    data: list[IMSyncResultItem] = Field(
        description="Result entries returned with page, limit, and total metadata for the selected bucket."
    )


class ListIMIdentitiesQuery(PaginationParamsMixin, _NoExtraModel):
    """Query params for searching synced IM identities."""

    keyword: str | None = Field(
        default=None,
        description="Free-text search against identity display name, email, or provider user ID.",
    )


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


class SetContactIMOverrideRequest(_RequestModel):
    """Request body for setting one workspace-scoped IM override."""

    identity_id: IMIdentityId = Field(description="Synced IM identity identifier selected as the workspace override.")


class SetContactIMOverrideResponse(ResponseModel):
    """Response body returned after setting one contact IM override."""

    contact: HumanInputContact = Field(description="Contact snapshot after the override is applied.")


class ResetContactIMOverrideResponse(ResponseModel):
    """Response body returned after resetting one contact IM override."""

    contact: HumanInputContact = Field(description="Contact snapshot after the override is cleared.")


class CreateIMBindingRequest(_RequestModel):
    """Request body for setting one workspace-scoped IM override."""

    identity_id: IMIdentityId = Field(description="Synced IM identity identifier selected as the workspace override.")


class CreateIMBindingResponse(ResponseModel):
    """Response body returned after binding one IM identity to the workspace."""

    contact: HumanInputContact = Field(description="Contact snapshot after the IM identity is bound.")


class DeleteIMBindingQuery(_RequestModel):
    binding_id: IMBindingId = Field(description="IM binding to unbind.")


class DeleteIMBindingResponse(ResponseModel):
    pass


class MessageTemplateTestRequest(_RequestModel):
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
    resend_after_seconds: int = Field(description="Seconds until another OTP challenge may be requested.")
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


class ServiceFormQuery(_NoExtraModel):
    """Query params for reading one service-api human-input form."""

    user: str = Field(min_length=1, description="End-user identifier used to scope the service API request.")


class BatchGetContactsQuery(_NoExtraModel):
    contact_ids: list[ContactId] = Field(..., description="List of contact IDs to retrieve.")


class BatchGetContactsResponse(ResponseModel):
    data: list[HumanInputContactSummary] = Field(..., description="List of retrieved human input contacts.")


class BatchGetContactOptionsQuery(_NoExtraModel):
    contact_ids: list[ContactId] = Field(..., description="Contact IDs persisted in workflow recipient configuration.")


class BatchGetContactOptionsResponse(ResponseModel):
    data: list[ContactOption] = Field(..., description="Selectable contacts resolved in request order.")


class HumanInputV2FormSubmitRequest(_RequestModel):
    """Public Human Input v2 submit payload, independent from the v1 form contract."""

    inputs: dict[str, JsonValue] = Field(description="Submitted form values keyed by output variable name.")
    action: str = Field(description="Identifier of the selected Human Input v2 action.")
    challenge_token: str | None = Field(
        default=None,
        description="OTP challenge token returned by the Human Input v2 access-request endpoint.",
    )
    otp_code: str | None = Field(
        default=None,
        description="OTP code required when the current Human Input v2 approver uses email proof.",
    )

    @model_validator(mode="after")
    def validate_complete_email_proof(self) -> Self:
        has_challenge_token = self.challenge_token is not None
        has_otp_code = self.otp_code is not None
        if has_challenge_token != has_otp_code:
            raise ValueError("challenge_token and otp_code must be provided together")
        return self


class HumanInputV2ServiceFormSubmitRequest(_RequestModel):
    """Trusted Service API submit payload without public-web OTP proof fields."""

    inputs: dict[str, JsonValue] = Field(description="Submitted form values keyed by output variable name.")
    action: str = Field(description="Identifier of the selected Human Input v2 action.")
    user: str = Field(min_length=1, description="End-user identifier scoped to the current app token.")


class FormUploadTokenResponse(ResponseModel):
    """Response body returned when issuing a Human Input v2 upload token."""

    upload_token: str
    expires_at: int


class FormSubmitResponse(ResponseModel):
    """Empty response body returned after a Human Input v2 form submission."""


# =================== Node migration related entities ===================


class LegacyHITLv1NodeData(HITLv1NodeData):
    """Legacy Human Input node data accepted by the v1-to-v2 migration helper.

    Missing versions use the historical v1 default. Any explicit value other
    than the string ``"1"`` is rejected before migration.
    """

    model_config = ConfigDict(extra="ignore")

    version: Literal["1"] = Field(
        default="1",
        description=(
            'Legacy Human Input node version. Missing values default to "1"; '
            'any explicit value other than the string "1" is rejected.'
        ),
    )


class NodeDataMigrationInput(_MigrationInputModel):
    """One legacy node submitted through the frontend migration adapter boundary."""

    node_id: str = Field(
        ..., description="The identifier of node to migrate. Used to associate between request and response"
    )
    node_data: LegacyHITLv1NodeData = Field(..., description="The legacy Human Input node data to migrate.")


class NodeDataMigrationPayload(_MigrationInputModel):
    """Complete legacy-node batch submitted for one migration attempt."""

    nodes: list[NodeDataMigrationInput] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_node_ids(self) -> Self:
        node_ids = [node.node_id for node in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("node_id must be unique within one migration request")
        return self


class NodeDataMigrationResult(ResponseModel):
    """One converted node returned with its frontend correlation identifier."""

    node_id: str = Field(description="The identifier of the migrated node.")
    node_data: HITLv2NodeData = Field(description="The complete converted Human Input v2 node data.")


class NodeDataMigrationResponse(ResponseModel):
    """Successful all-node conversion response."""

    data: list[NodeDataMigrationResult]


NodeDataMigrationBlockerCode = Literal[
    "unsupported-version",
    "configured-disabled-method",
    "unsupported-delivery-method",
    "invalid-email-configuration",
    "invalid-email",
    "unresolved-member",
    "conflicting-email-templates",
    "missing-recipients",
]


class NodeDataMigrationBlocker(ResponseModel):
    """Stable node-scoped reason why the backend cannot produce lossless v2 data."""

    node_id: str = Field(description="The identifier of the node that failed migration.")
    node_title: str = Field(description="The node title used for actionable frontend feedback.")
    code: NodeDataMigrationBlockerCode = Field(description="Machine-readable migration blocker code.")
    method_id: str | None = Field(default=None, description="Legacy delivery method related to the blocker.")
    value: str | None = Field(default=None, description="Safe legacy value related to the blocker.")


class NodeDataMigrationFailureResponse(ResponseModel):
    """Whole-batch failure response without partial converted node data."""

    code: Literal["hitl_node_data_migration_failure"] = "hitl_node_data_migration_failure"
    message: str = Field(..., description="overall error messages")
    status: Literal[HTTPStatus.BAD_REQUEST] = HTTPStatus.BAD_REQUEST
    blockers: list[NodeDataMigrationBlocker] = Field(
        ..., description="Node-scoped blockers that caused the whole batch to fail."
    )


# =================== EmailProvider related entities ===================


class PreserveOriginalValue(_RequestModel):
    tag: Literal["preserve_original_value"] = "preserve_original_value"


class ResendProviderUpdateConfig(_RequestModel):
    type: Literal[EmailProviderType.RESEND] = EmailProviderType.RESEND

    api_key: str | PreserveOriginalValue = Field(
        ...,
        description=(
            "Resend API key. "
            "Setting this to `PreserveOriginalValue` while updating will preserve the previously set credential."
        ),
    )
    sender_email: str = Field(
        ..., description="The email address shown as the sender. Its domain must be verified in Resend."
    )

    sender_name: str = Field("", description="The sender's name displayed in the recipient's inbox.")


class ResendProviderConfigResponse(ResponseModel):
    type: Literal[EmailProviderType.RESEND] = EmailProviderType.RESEND
    api_key_configured: bool = Field(description="Whether a Resend API key has been configured.")
    sender_email: str = Field(description="The email address shown as the sender.")
    sender_name: str = Field("", description="The sender's name displayed in the recipient's inbox.")


EmailProviderUpdateConfig = ResendProviderUpdateConfig
EmailProviderConfigResponse = ResendProviderConfigResponse


class GetEmailProviderResponse(ResponseModel):
    provider_config: EmailProviderConfigResponse | None = Field(
        ...,
        description="The current email provider configuration. `None` if not set.",
    )


class SetEmailProviderRequest(_RequestModel):
    provider_config: EmailProviderUpdateConfig = Field(..., description="Email provider configuration update.")


class SetEmailProviderResponse(ResponseModel):
    pass


class TestEmailProviderConfigRequest(_RequestModel):
    pass


class TestEmailProviderConfigResponse(ResponseModel):
    pass


__all__ = [
    "AddPlatformContactsRequest",
    "AddPlatformContactsResponse",
    "BatchGetContactOptionsQuery",
    "BatchGetContactOptionsResponse",
    "ContactListQuery",
    "ContactOption",
    "ContactOptionsQuery",
    "CreateIMSyncRunResponse",
    "DeleteIMIntegrationQuery",
    "DingTalkIMIntegrationCredentials",
    "EmailProviderConfigResponse",
    "EmailProviderType",
    "EmailProviderUpdateConfig",
    "ExternalContactCreateRequest",
    "ExternalContactUpdateRequest",
    "FeishuIMIntegrationCredentials",
    "FormAccessRequestResponse",
    "FormDefinitionResponse",
    "FormSubmitResponse",
    "FormUploadTokenResponse",
    "GetContactResponse",
    "GetEmailProviderResponse",
    "GetIMIntegrationResponse",
    "GetLatestIMSyncRunResponse",
    "HumanInputContact",
    "HumanInputContactType",
    "HumanInputV2FormSubmitRequest",
    "HumanInputV2ServiceFormSubmitRequest",
    "IMIdentity",
    "IMIdentityBindingStatus",
    "IMIntegration",
    "IMIntegrationCredentials",
    "IMIntegrationStatus",
    "IMProvider",
    "IMSyncRemovalReason",
    "IMSyncResultItem",
    "IMSyncResultType",
    "IMSyncRun",
    "IMSyncRunResultCounts",
    "IMSyncRunStatus",
    "LarkIMIntegrationCredentials",
    "ListContactOptionsResponse",
    "ListContactsResponse",
    "ListIMIdentitiesQuery",
    "ListIMIdentitiesResponse",
    "ListLatestIMSyncRunResultsQuery",
    "ListLatestIMSyncRunResultsResponse",
    "ListOrganizationCandidatesResponse",
    "MSTeamsIMIntegrationCredentials",
    "MessageTemplateTestRequest",
    "MessageTemplateTestResponse",
    "NodeDataMigrationFailureResponse",
    "NodeDataMigrationPayload",
    "NodeDataMigrationResponse",
    "OrganizationCandidate",
    "OrganizationCandidatesQuery",
    "PreserveOriginalValue",
    "RemoveContactsRequest",
    "RemoveContactsResponse",
    "ResendProviderConfigResponse",
    "ResendProviderUpdateConfig",
    "ResetContactIMOverrideResponse",
    "ServiceFormQuery",
    "SetContactIMOverrideRequest",
    "SetContactIMOverrideResponse",
    "SetEmailProviderRequest",
    "SetEmailProviderResponse",
    "SlackIMIntegrationCredentials",
    "TestIMIntegrationRequest",
    "TestIMIntegrationResponse",
    "UpdateIMIntegrationRequest",
    "UpdateIMIntegrationResponse",
    "WeComIMIntegrationCredentials",
]
