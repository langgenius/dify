# Human Input V2 API Summary

## 1. 直接结论

这次 API 设计按四个 surface 拆开：

1. workspace console：Contact Directory、`workspace contact` / `Platform contact` / `External contact` 分组、IM integration、manual sync、workspace IM override
2. workflow draft：`form/preview`、`form/run`、`message-template/test`
3. runtime form：public web + service API
4. EE dashboard admin：Organization 级 IM integration 与 sync control-plane；EE 下 workspace console 对这组资源只做 UI adapter / proxy

统一约束如下：

- runtime noun 继续使用 `form`
- URL path 统一使用 `human-input`
- CE / SaaS API 继续用 Flask View + Pydantic model
- EE admin API 用 protobuf + `google.api.http`
- 优先复用现有枚举与 schema：`DebugChannel`、`FormInputConfig`、`UserActionConfig`、`HumanInputFormStatus`
- 不新增 notification center、task list、CLI todo、重复的 EE member / workspace CRUD

## 2. 需要先调整的 DSL

只有一处必须先改：

- `api/core/workflow/nodes/human_input_v2/entities.py` 里的 `recpients_spec` 是拼写错误，应该改成 `recipients_spec`

`humaninput_v2` 其余结构暂时够用：

- `RecipientType`
- `Contact`
- `DynamicEmail`
- `OnetimeEmail`
- `Initiator`
- `MessageTemplateConfig`
- `DebugChannel`
- `DebugModeConfig`
- `IMProvider`

`DebugChannel` 可以继续复用于 draft `message-template/test`；但 IM integration provider 应该使用 `IMProvider`，因为 `DebugChannel` 包含 `EMAIL` 且语义是 debug transport，不是 control-plane provider。

补充一条新的上位概念约束：

- `organization contact` 是上位概念
- `workspace contact` / `Platform contact` 是它的子类
- 在 CE / SaaS 中 `Organization = workspace`，因此 `Platform contact` candidate / add 在运行时没有可用对象；如果共享实现保留这些路由，允许直接报 edition-not-supported

## 3. Workspace / Runtime API

### 3.1 Shared Pydantic Models

下面这些 model 是这次设计里会新增或重定义的 transport skeleton。代码块只表达 contract，不代表最终文件布局。

```python
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
```

### 3.2 Workspace Console APIs

workspace console 下的新接口全部挂在 `/console/api/workspaces/current/human-input`。

| Method | Path | Flask View | Request | Response | 说明 |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/console/api/workspaces/current/human-input/contacts` | `WorkspaceContactsApi` | `ContactListQuery` | `ListContactsResponse` | 浏览当前 workspace Contact；支持 `workspace / platform / external` 三种显式分组，省略 `group` 时表示 all；其中 `platform` 表示非当前 workspace member 的 `Platform Contact` |
| `GET` | `/console/api/workspaces/current/human-input/organization-candidates` | `WorkspaceOrganizationCandidatesApi` | `OrganizationCandidatesQuery` | `ListOrganizationCandidatesResponse` | 在 EE 中搜索可加入当前 workspace 的 Organization member candidate；CE / SaaS 若保留实现，可直接返回 edition-not-supported |
| `POST` | `/console/api/workspaces/current/human-input/contacts/platform` | `WorkspacePlatformContactsApi` | `AddPlatformContactsRequest` | `AddPlatformContactsResponse` | 在 EE 中批量把 Organization member 加入当前 workspace Contact 并落成 `Platform Contact`；CE / SaaS 若保留实现，可直接返回 edition-not-supported |
| `POST` | `/console/api/workspaces/current/human-input/contacts/external` | `WorkspaceExternalContactsApi` | `ExternalContactRequest` | `ContactResponse` | 创建 external contact |
| `PATCH` | `/console/api/workspaces/current/human-input/contacts/external/<uuid:contact_id>` | `WorkspaceExternalContactApi` | `ExternalContactRequest` | `ContactResponse` | 更新 external contact |
| `POST` | `/console/api/workspaces/current/human-input/contacts/remove` | `WorkspaceContactsRemoveApi` | `RemoveContactsRequest` | `RemoveContactsResponse` | 批量 remove `Platform Contact` / `External Contact`；对 platform 执行 detach，对 external 执行 delete；`Workspace Contact` 不走这里，而走 membership management |
| `GET` | `/console/api/workspaces/current/human-input/im-integration` | `WorkspaceIMIntegrationApi` | none | `GetIMIntegrationResponse` | 读取当前唯一 IM channel 的配置摘要 |
| `PUT` | `/console/api/workspaces/current/human-input/im-integration` | `WorkspaceIMIntegrationApi` | `UpdateIMIntegrationRequest` | `UpdateIMIntegrationResponse` | 保存或更新 Organization 级 IM integration |
| `POST` | `/console/api/workspaces/current/human-input/im-integration/test` | `WorkspaceIMIntegrationTestApi` | `TestIMIntegrationRequest` | `TestIMIntegrationResponse` | 测试 credentials / callback / permission |
| `POST` | `/console/api/workspaces/current/human-input/im-sync-runs` | `WorkspaceIMSyncRunsApi` | none | `CreateIMSyncRunResponse` | 手动触发一次 IM sync |
| `GET` | `/console/api/workspaces/current/human-input/im-sync-runs` | `WorkspaceIMSyncRunsApi` | `ListIMSyncRunsQuery` | `ListIMSyncRunsResponse` | 分页查询 sync run |
| `GET` | `/console/api/workspaces/current/human-input/im-sync-runs/<uuid:sync_run_id>` | `WorkspaceIMSyncRunApi` | none | `GetIMSyncRunResponse` | 查看单次 sync 的五类 bucket 详情 |
| `GET` | `/console/api/workspaces/current/human-input/im-identities` | `WorkspaceIMIdentitiesApi` | `ListIMIdentitiesQuery` | `ListIMIdentitiesResponse` | 搜索可绑定 / override 的已同步 IM identity |
| `PUT` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-override` | `WorkspaceContactIMOverrideApi` | `SetContactIMOverrideRequest` | `SetContactIMOverrideResponse` | 为当前 workspace 设置 IM override |
| `DELETE` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-override` | `WorkspaceContactIMOverrideApi` | none | `ResetContactIMOverrideResponse` | Reset to global |

`organization-candidates` 与 `contacts/platform` 是 EE-only capability。CE / SaaS 若为了复用实现保留相同路由，直接返回 edition-not-supported 即可；EE 下这些路由继续消费 enterprise member / workspace APIs 来搜索并投影 `Platform Contact`。

remove API 则统一成一个批量入口，因为 UI 允许混合选择 `Platform Contact` 与 `External Contact`。`Workspace Contact` 的移除继续归属 membership management，不在这组 Human Input Contact API 中重复定义。

这些接口已经覆盖了 PRD 里的 Contact Directory、external contact、IM integration、manual sync、workspace override；不再额外扩成 task list 或 notification center API。

### 3.3 Draft Workflow / Advanced Chat APIs

preview / run 继续沿用现有 class，只改 v2 相关 request body；旧 `delivery-test` 改成 `message-template/test`。

| Method | Path | Flask View | Request | Response | 说明 |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/preview` | `WorkflowDraftFormPreviewApi` | `FormPreviewRequest` | `FormPreviewResponse` | 保留现有 preview 语义 |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/run` | `WorkflowDraftFormRunApi` | `FormSubmitRequest` | `FormSubmitResponse` | 保留现有 draft run 语义 |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/message-template/test` | `WorkflowDraftMessageTemplateTestApi` | `MessageTemplateTestRequest` | `MessageTemplateTestResponse` | 基于 `DebugChannel` 向当前编辑者发送测试消息 |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/form/preview` | `AdvancedChatDraftFormPreviewApi` | `FormPreviewRequest` | `FormPreviewResponse` | advanced-chat preview |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/form/run` | `AdvancedChatDraftFormRunApi` | `FormSubmitRequest` | `FormSubmitResponse` | advanced-chat draft run |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/message-template/test` | `AdvancedChatDraftMessageTemplateTestApi` | `MessageTemplateTestRequest` | `MessageTemplateTestResponse` | advanced-chat template test |

这里不建议继续把 v1 `delivery_method_id` 硬塞进 v2 DSL。要测试模板，就让 request 明确表达 `channel: DebugChannel`。

### 3.4 Public Web Runtime APIs

这里的 public web runtime surface 明确只描述 email-based approver 的 OTP submit 流程。`GET form` 与 `upload-token` 继续基于 `form_token` 工作，真正的审批资格只在 `submit` 时通过 OTP 校验。

| Method | Path | Flask View | Request | Response | 说明 |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/form/human-input/<string:form_token>` | `HumanInputFormApi` | none | `FormDefinitionResponse` | 直接返回 form definition；打开页面不等于获得审批提交权限 |
| `POST` | `/api/form/human-input/<string:form_token>/access-request` | `FormAccessRequestApi` | none | `FormAccessRequestResponse` | 给当前 email-based approver 发送 OTP |
| `POST` | `/api/form/human-input/<string:form_token>/upload-token` | `HumanInputFormUploadTokenApi` | `UploadTokenRequest` | `UploadTokenResponse` | 继续仅凭 `form_token` 申请 upload token |
| `POST` | `/api/form/human-input/<string:form_token>` | `HumanInputFormApi` | `WebFormSubmitRequest` | `FormSubmitResponse` | 真正的审批提交入口；提交时必须校验 `otp_code` |

这组接口满足了两个核心约束：

- `form_token` 不能单独作为提交授权凭证
- `submit` 才是审批动作；打开页面和上传文件不等于审批成功

### 3.5 Service API Runtime APIs

Service API 继续保持 trusted app-token 模型，但 GET / POST 都要显式带 `user`。

| Method | Path | Flask View | Request | Response | 说明 |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/v1/form/human-input/<string:form_token>?user=<string>` | `WorkflowHumanInputFormApi` | `ServiceFormQuery` | `FormDefinitionResponse` | 读取 form definition；没有 `user` 直接拒绝 |
| `POST` | `/v1/form/human-input/<string:form_token>` | `WorkflowHumanInputFormApi` | `ServiceFormSubmitRequest` | `FormSubmitResponse` | 继续以 request-scoped `end_user` 执行 submit |

这里不新增 service API `access-request` / dedicated upload endpoint，因为 trusted app-token caller 继续复用现有 app-scoped end-user model 和通用 file upload 流程即可。

## 4. EE 管理后台 API

这部分只覆盖 Organization 级 IM integration 和 sync control-plane。成员、workspace、基础 RBAC 继续复用 enterprise 现有 proto，不重复设计。对于 EE，这里定义的是 backend source of truth；workspace console 里的同名能力应当作为 UI-facing proxy 调到这里，而不是形成第二套独立写入口。

```proto
syntax = "proto3";

package dify.enterprise.api.enterprise;

option go_package = "github.com/langgenius/dify-enterprise/pkg/apis/enterprise/v1;v1";

import "google/api/annotations.proto";
import "google/protobuf/struct.proto";
import "google/protobuf/timestamp.proto";
import "pagination/pagination.proto";
import "validate/validate.proto";

// Supported IM providers for organization-level integration settings.
enum IMProvider {
  // Default zero value.
  IM_PROVIDER_UNSPECIFIED = 0;
  // Feishu enterprise integration.
  IM_PROVIDER_FEISHU = 1;
  // Slack integration.
  IM_PROVIDER_SLACK = 2;
  // DingTalk enterprise integration.
  IM_PROVIDER_DING_TALK = 3;
  // Microsoft Teams integration.
  IM_PROVIDER_MS_TEAMS = 4;
  // WeCom enterprise integration.
  IM_PROVIDER_WE_COM = 5;
  // Lark integration.
  IM_PROVIDER_LARK = 6;
}

// Connectivity state for one organization-level IM integration.
// Transition rules:
// - NOT_CONFIGURED -> CONFIGURED after credentials are saved.
// - CONFIGURED -> CONNECTED after connection, callback, and permission checks pass.
// - CONFIGURED or CONNECTED -> PERMISSION_ISSUE when provider permissions become invalid.
// - CONFIGURED or CONNECTED -> CALLBACK_ERROR when callback verification fails.
// - CONFIGURED or CONNECTED -> CONNECTION_ERROR when connectivity checks fail.
// - Any non-default state -> NOT_CONFIGURED after explicit deletion of the integration.
enum IMIntegrationStatus {
  // Default zero value.
  IM_INTEGRATION_STATUS_UNSPECIFIED = 0;
  // No integration has been configured yet.
  IM_INTEGRATION_STATUS_NOT_CONFIGURED = 1;
  // Credentials are saved but the connection is not fully verified yet.
  IM_INTEGRATION_STATUS_CONFIGURED = 2;
  // Integration is connected and healthy.
  IM_INTEGRATION_STATUS_CONNECTED = 3;
  // Provider permissions are missing or invalid.
  IM_INTEGRATION_STATUS_PERMISSION_ISSUE = 4;
  // Callback validation failed.
  IM_INTEGRATION_STATUS_CALLBACK_ERROR = 5;
  // General connection failure.
  IM_INTEGRATION_STATUS_CONNECTION_ERROR = 6;
}

// Lifecycle state for one IM sync run.
// Transition rules:
// - QUEUED -> RUNNING when the sync worker starts processing the run.
// - RUNNING -> SUCCEEDED when reconciliation completes without a terminal error.
// - RUNNING -> FAILED when reconciliation stops with a terminal error.
// - QUEUED -> FAILED is allowed when the run cannot be started at all.
enum IMSyncRunStatus {
  // Default zero value.
  IM_SYNC_RUN_STATUS_UNSPECIFIED = 0;
  // Sync run is queued but not started yet.
  IM_SYNC_RUN_STATUS_QUEUED = 1;
  // Sync run is currently executing.
  IM_SYNC_RUN_STATUS_RUNNING = 2;
  // Sync run completed successfully.
  IM_SYNC_RUN_STATUS_SUCCEEDED = 3;
  // Sync run completed with a terminal failure.
  IM_SYNC_RUN_STATUS_FAILED = 4;
}

// Stable reconciliation reasons exposed by IM sync detail APIs.
enum IMSyncReason {
  // Default zero value.
  IM_SYNC_REASON_UNSPECIFIED = 0;
  // Identity matched an existing binding by provider user id.
  IM_SYNC_REASON_MATCHED_BY_PROVIDER_USER_ID = 1;
  // Identity matched a contact by email.
  IM_SYNC_REASON_MATCHED_BY_EMAIL = 2;
  // Identity could not be matched to any contact.
  IM_SYNC_REASON_UNMATCHED_IDENTITY = 3;
  // Identity failed because of provider or transport errors.
  IM_SYNC_REASON_PROVIDER_ERROR = 4;
  // Identity caused an existing binding to be removed or replaced.
  IM_SYNC_REASON_BINDING_REMOVED = 5;
  // Identity was intentionally skipped by reconciliation rules.
  IM_SYNC_REASON_SKIPPED_BY_RULE = 6;
}

service EnterpriseHumanInputAdmin {
  rpc GetIMIntegration(GetIMIntegrationReq)
      returns (GetIMIntegrationRes) {
    option (google.api.http) = {
      get: "/v1/dashboard/api/human-input/im-integration",
    };
  }

  rpc UpdateIMIntegration(UpdateIMIntegrationReq)
      returns (UpdateIMIntegrationRes) {
    option (google.api.http) = {
      put: "/v1/dashboard/api/human-input/im-integration",
      body: "*",
    };
  }

  rpc DeleteIMIntegration(DeleteIMIntegrationReq)
      returns (DeleteIMIntegrationRes) {
    option (google.api.http) = {
      delete: "/v1/dashboard/api/human-input/im-integration",
    };
  }

  rpc TestIMIntegration(TestIMIntegrationReq)
      returns (TestIMIntegrationRes) {
    option (google.api.http) = {
      post: "/v1/dashboard/api/human-input/im-integration/test",
      body: "*",
    };
  }

  rpc CreateIMSyncRun(CreateIMSyncRunReq)
      returns (CreateIMSyncRunRes) {
    option (google.api.http) = {
      post: "/v1/dashboard/api/human-input/im-sync-runs",
      body: "*",
    };
  }

  rpc ListIMSyncRuns(ListIMSyncRunsReq)
      returns (ListIMSyncRunsRes) {
    option (google.api.http) = {
      get: "/v1/dashboard/api/human-input/im-sync-runs",
    };
  }

  rpc GetIMSyncRun(GetIMSyncRunReq)
      returns (GetIMSyncRunRes) {
    option (google.api.http) = {
      get: "/v1/dashboard/api/human-input/im-sync-runs/{id}",
    };
  }
}

// One organization-level IM integration snapshot.
message IMIntegration {
  // Configured IM provider.
  IMProvider channel = 1;
  // Current integration connectivity state.
  IMIntegrationStatus status = 2;
  // Callback URL expected by the provider.
  string callback_url = 3 [json_name = "callback_url"];
  // Optional operator-facing hint about missing permissions.
  string permission_hint = 4 [json_name = "permission_hint"];
  // First time the integration was configured.
  google.protobuf.Timestamp configured_at = 5 [json_name = "configured_at"];
  // Last time the integration metadata changed.
  google.protobuf.Timestamp updated_at = 6 [json_name = "updated_at"];
}

// Request for reading the current organization-level IM integration.
message GetIMIntegrationReq {}

// Response body for reading the current organization-level IM integration.
message GetIMIntegrationRes {
  // Current organization-level IM integration snapshot.
  IMIntegration integration = 1;
}

// Request for creating or updating the current organization-level IM integration.
message UpdateIMIntegrationReq {
  // IM provider being configured.
  IMProvider channel = 1;
  // Provider-specific credentials and callback settings.
  google.protobuf.Struct credentials = 2;
}

// Response body for creating or updating the current organization-level IM integration.
message UpdateIMIntegrationRes {
  // Saved integration snapshot after the update operation.
  IMIntegration integration = 1;
}

// Request for deleting the current organization-level IM integration.
message DeleteIMIntegrationReq {}

// Response body for deleting the current organization-level IM integration.
message DeleteIMIntegrationRes {}

// Request for testing one set of IM integration credentials.
message TestIMIntegrationReq {
  // IM provider being tested.
  IMProvider channel = 1;
  // Provider-specific credentials and callback settings under test.
  google.protobuf.Struct credentials = 2;
}

// Response body for testing one set of IM integration credentials.
message TestIMIntegrationRes {
  // Test result mapped onto the integration status enum.
  IMIntegrationStatus status = 1;
  // Human-readable explanation of the test result.
  string message = 2;
}

// One IM sync run snapshot.
message IMSyncRun {
  // Unique sync run identifier.
  string id = 1;
  // Current lifecycle state of the sync run.
  IMSyncRunStatus status = 2;
  // Timestamp when the sync run started.
  google.protobuf.Timestamp started_at = 3 [json_name = "started_at"];
  // Timestamp when the sync run finished, if any.
  google.protobuf.Timestamp finished_at = 4 [json_name = "finished_at"];
  // Operator or system actor that triggered the sync.
  string triggered_by = 5 [json_name = "triggered_by"];
  // Terminal error message. Present only when the sync run status is FAILED.
  string error_message = 6 [json_name = "error_message"];
}

// One reconciliation item inside a sync run detail.
message IMSyncItem {
  // Provider-side user identifier returned by the IM platform.
  string provider_user_id = 1 [json_name = "provider_user_id"];
  // Display name returned by the IM platform.
  string display_name = 2 [json_name = "display_name"];
  // Provider email used for matching.
  string email = 3;
  // Matched Dify contact identifier, if any.
  string contact_id = 4 [json_name = "contact_id"];
  // Stable reconciliation reason exposed to clients.
  IMSyncReason reason = 5;
}

// Request for creating one manual IM sync run.
message CreateIMSyncRunReq {}

// Response body for creating one manual IM sync run.
message CreateIMSyncRunRes {
  // Newly created sync run snapshot.
  IMSyncRun run = 1;
}

// Request for listing historical IM sync runs.
message ListIMSyncRunsReq {
  // 1-based page number.
  int32 page_number = 1 [(validate.rules).int32 = { gte: 1 }];
  // Maximum number of runs returned per page.
  int32 results_per_page = 2 [(validate.rules).int32 = { gte: 1, lte: 100 }];
}

// Response body for listing historical IM sync runs.
message ListIMSyncRunsRes {
  // Sync runs for the current page.
  repeated IMSyncRun data = 1;
  // Pagination metadata.
  pagination.Pagination pagination = 2;
}

// Request for reading one IM sync run in detail.
message GetIMSyncRunReq {
  // Sync run identifier.
  string id = 1 [(validate.rules).string = { min_len: 1 }];
}

// Response body for reading one IM sync run in detail.
message GetIMSyncRunRes {
  // Sync run snapshot.
  IMSyncRun run = 1;
  // Items newly matched and bound in this run.
  repeated IMSyncItem added = 2;
  // Items that could not be matched to a Dify contact.
  repeated IMSyncItem not_matched = 3 [json_name = "not_matched"];
  // Items that failed to reconcile.
  repeated IMSyncItem failed = 4;
  // Items whose prior binding was removed.
  repeated IMSyncItem removed = 5;
  // Items intentionally skipped by reconciliation rules.
  repeated IMSyncItem skipped = 6;
}
```

## 5. 不进入本期的接口

下面这些不应该借这次 API 设计顺手扩进去：

- notification center API
- member-side pending task list API
- CLI todo / approval inbox API
- 新的 `task` noun 路由
- 重复的 EE member / workspace CRUD proto
- 为 IM provider 单独发明一套和 DSL / enterprise style 脱节的 transport enum

## 6. 推荐落地顺序

1. 先修 `recipients_spec` 字段名。
2. 再落 workspace console 的 contact / IM surface。
3. 再切 public web runtime proof model。
4. 再把 Service API GET 改成强制 `user`。
5. 最后补 EE proto 和 EE console wiring。
