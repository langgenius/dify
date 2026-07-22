# Human Input V2 API Summary

## 1. 直接结论

这次 API 设计按四个 surface 拆开：

1. workspace console：Contact Directory、`workspace contact` / `Platform contact` / `External contact` 分组、IM integration、manual sync、workspace IM override，以及用户确认后使用的无副作用 node-data migration helper
2. workflow draft：`form/preview`、`form/run`、`message-template/test`
3. runtime form：public web + service API
4. EE dashboard admin：Organization 级 IM integration 与 sync control-plane；EE 下 workspace console 对这组资源只做 UI adapter / proxy

统一约束如下：

- runtime noun 继续使用 `form`
- URL path 统一使用 `human-input`
- CE / SaaS API 继续用 Flask View + Pydantic model
- EE admin API 用 protobuf + `google.api.http`
- 优先复用现有枚举与 schema：`Channel`、`FormInputConfig`、`UserActionConfig`、`HumanInputFormStatus`
- node-data migration helper 只负责 tenant-scoped 批量转换与 blocker 校验，不持久化 workflow；仅当所有节点的新 schema 都生成成功时返回完整结果，任一节点失败则整批返回错误且不返回部分结果；节点集合选择和原子 draft mutation 仍由前端负责
- 不新增 notification center、task list、CLI todo、重复的 EE member / workspace CRUD

## 2. 现有 DSL 复用约束

`humaninput_v2` 当前结构可以直接复用：

- `RecipientType`
- `Contact`
- `DynamicEmail`
- `OnetimeEmail`
- `Initiator`
- `MessageTemplateConfig`
- `Channel`
- `DebugModeConfig`
- `IMProvider`

`Channel` 可以继续复用于 draft `message-template/test`；但 IM integration provider 应该使用 `IMProvider`，因为 `Channel` 同时覆盖 `EMAIL` 与 IM 渠道，而 `IMProvider` 只表示 organization-level integration provider。

补充一条新的上位概念约束：

- `organization contact` 是上位概念
- `workspace contact` / `Platform contact` 是它的子类
- 在 CE / SaaS 中 `Organization = workspace`，因此 `Platform contact` candidate / add 在运行时没有可用对象；如果共享实现保留这些路由，允许直接报 edition-not-supported

## 3. Workspace / Runtime API

### 3.1 Shared Pydantic Models

下面这段先对应当前 shared contract，也就是 `api/controllers/common/human_input_v2_contracts.py`。  
draft / public web / service API 里仍然存在 controller-local DTO，后面单独列当前 stub 字段。

```python
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue
from pydantic.networks import EmailStr

from core.human_input_v2.entities import ContactId, IMIdentityId, IMSyncRunId, OrganizationCandidateId
from core.workflow.nodes.human_input.entities import FormInputConfig, HumanInputNodeDataFull, UserActionConfig
from core.workflow.nodes.human_input_v2.entities import Channel, HumanInputNodeData, IMProvider
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
    """Request body for creating one external contact."""

    name: ExternalContactName
    email: ExternalContactEmail
    avatar: ExternalContactAvatar


class ExternalContactUpdateRequest(_StrictModel):
    """Request body for updating one external contact."""

    name: ExternalContactName | None = None
    email: ExternalContactEmail | None = None
    avatar: ExternalContactAvatar | None = None


class HumanInputContact(ResponseModel):
    """One contact entity returned by contact-related APIs."""

    id: str = Field(description="Unique contact identifier.")
    type: HumanInputContactType = Field(description="Resolved contact type in the current workspace scope.")
    name: str = Field(description="Display name shown in the contact directory.")
    email: str | None = Field(default=None, description="Primary contact email if one exists.")
    bounded_im_providers: list[IMProvider] = Field(
        default_factory=list[IMProvider], description="IM channels that are bound to this contact."
    )
    created_at: Timestamp


class ExternalContactCreateResponse(ResponseModel):
    """Response body carrying the created external contact."""

    contact: HumanInputContact = Field(description="The created external contact.")


class ExternalContactUpdateResponse(ResponseModel):
    """Response body carrying the updated external contact."""

    contact: HumanInputContact = Field(description="The updated external contact. Fields are values after updating.")


class OrganizationCandidate(ResponseModel):
    """One organization member candidate that may become a platform contact."""

    id: OrganizationCandidateId = Field(description="Organization member identifier.")
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


class PreserveOriginalValue(_StrictModel):
    tag: Literal["preserve_original_value"] = "preserve_original_value"


class FeishuLarkIMIntegrationCredentials(_StrictModel):
    """Shared Feishu and Lark credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.FEISHU, IMProvider.LARK] = Field(
        description="Discriminator for Feishu or Lark integration credentials."
    )
    app_id: str = Field(description="Feishu or Lark application identifier.")
    app_secret: str | PreserveOriginalValue = Field(description="Feishu or Lark application secret.")
    verification_token: str | PreserveOriginalValue | None = Field(
        default=None, description="Optional callback verification token."
    )
    encrypt_key: str | PreserveOriginalValue | None = Field(default=None, description="Optional callback encrypt key.")


class SlackIMIntegrationCredentials(_StrictModel):
    """Slack integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.SLACK] = Field(description="Discriminator for Slack integration credentials.")
    client_id: str = Field(description="Slack OAuth client identifier.")
    client_secret: str | PreserveOriginalValue = Field(description="Slack OAuth client secret.")
    signing_secret: str | PreserveOriginalValue = Field(description="Slack signing secret used to verify callbacks.")
    bot_token: str | PreserveOriginalValue = Field(
        description="Slack bot token used for API calls and message delivery."
    )


class DingTalkIMIntegrationCredentials(_StrictModel):
    """DingTalk integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.DING_TALK] = Field(description="Discriminator for DingTalk integration credentials.")
    client_id: str = Field(description="DingTalk application client identifier.")
    client_secret: str | PreserveOriginalValue = Field(description="DingTalk application client secret.")


class MSTeamsIMIntegrationCredentials(_StrictModel):
    """Microsoft Teams integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.MS_TEAMS] = Field(description="Discriminator for Microsoft Teams integration credentials.")
    tenant_id: str = Field(description="Microsoft Entra tenant identifier.")
    client_id: str = Field(description="Microsoft Teams application client identifier.")
    client_secret: str | PreserveOriginalValue = Field(description="Microsoft Teams application client secret.")


class WeComIMIntegrationCredentials(_StrictModel):
    """WeCom integration credentials used by organization-level IM setup."""

    provider: Literal[IMProvider.WE_COM] = Field(description="Discriminator for WeCom integration credentials.")
    corp_id: str = Field(description="WeCom corporation identifier.")
    agent_id: str = Field(description="WeCom agent identifier.")
    secret: str | PreserveOriginalValue = Field(description="WeCom application secret.")


IMIntegrationCredentials = Annotated[
    FeishuLarkIMIntegrationCredentials
    | SlackIMIntegrationCredentials
    | DingTalkIMIntegrationCredentials
    | MSTeamsIMIntegrationCredentials
    | WeComIMIntegrationCredentials,
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
    triggered_by: str | None = Field(default=None, description="Operator or system actor that triggered the sync.")
    error_message: str | None = Field(
        default=None,
        description="Terminal error message. Present only when the sync run status is `failed`.",
    )
    result_counts: "IMSyncRunResultCounts" = Field(
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


class IMSyncRunResultCounts(ResponseModel):
    """Aggregate result counts for one IM sync run."""

    added: int = Field(description="Number of entries newly matched and bound.")
    not_matched: int = Field(description="Number of entries that could not be matched.")
    failed: int = Field(description="Number of entries that failed to reconcile.")
    removed: int = Field(description="Number of entries whose prior binding was removed.")
    skipped: int = Field(description="Number of entries intentionally skipped.")


class IMSyncResultItem(ResponseModel):
    """One paginated reconciliation result entry for the latest sync run."""

    result: IMSyncResultType = Field(description="Result bucket this entry belongs to.")
    provider_user_id: str = Field(description="Provider-side user identifier returned by the IM platform.")
    display_name: str | None = Field(default=None, description="Display name returned by the IM platform.")
    email: str | None = Field(default=None, description="Provider email used for matching.")
    contact_id: ContactId | None = Field(default=None, description="Matched Dify contact identifier, if any.")
    reason: IMSyncReason | None = Field(default=None, description="Stable reconciliation reason exposed to API clients.")


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
    provider: IMProvider | None = Field(default=None, description="Optional IM provider filter.")


class IMIdentity(ResponseModel):
    """One synced IM identity that may be bound or overridden."""

    id: IMIdentityId = Field(description="Internal IM identity record identifier.")
    provider: IMProvider = Field(description="IM provider that owns this identity.")
    provider_user_id: str = Field(description="Provider-side user identifier.")
    display_name: str | None = Field(default=None, description="Display name returned by the provider.")
    email: str | None = Field(default=None, description="Email returned by the provider, if any.")
    binding_status: IMIdentityBindingStatus = Field(description="Whether this IM identity is currently bound to a contact.")


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
```

手动 migration helper 使用独立 DTO：

```python
class NodedataWithId[T](_StrictModel):
    node_id: str
    data: T


class CreateNodeDataMigrationRequest(_StrictModel):
    node_data: list[NodedataWithId[HITLv1NodeData]]


class CreateHITLMigrationResponse(ResponseModel):
    node_data: list[NodedataWithId[HITLv2NodeData]]


class NodeDataMigrationFailureReason(ResponseModel):
    node_id: str


class NodeMigrationFailure(ResponseModel):
    code: Literal["hitl_node_data_migration_failure"]
    message: str
    status: Literal[HTTPStatus.BAD_REQUEST]
    reasons: list[NodeDataMigrationFailureReason]
```

endpoint 只在所有输入节点都成功生成完整 v2 schema 时返回 `CreateHITLMigrationResponse`，并保持 `node_id` 关联与输入顺序。只要任一节点生成失败，整个 request 使用 `NodeMigrationFailure` 返回 `400 Bad Request`；`reasons` 标识失败节点及其 blocker，上述错误响应不返回任何成功节点的部分 v2 node data。初始 taxonomy 为 `unsupported-version`、`configured-disabled-method`、`unsupported-delivery-method`、`invalid-email-configuration`、`invalid-email`、`unresolved-member`、`conflicting-email-templates`、`missing-recipients`。

唯一允许的受控有损例外是 legacy Email `whole_workspace: true`：由于 v2 没有等价的动态“all workspace member” recipient，helper 需要把它物化为迁移当下当前 workspace contact / member resolution snapshot 的静态 recipient 列表。这个场景返回转换后的 node data，而不是 blocker。

这个 helper 的职责需要和前端 migration flow 严格分开：

- frontend owns：取得用户显式确认并选择待迁移的 legacy node 集合、维护 legacy guidance / gating、展示 node-scoped blocker，并且仅在整批 schema 生成成功后执行一次 graph/history transaction replacement、draft sync、rollback、history / collaboration orchestration。
- backend helper owns：batch request 校验、request-scoped tenant recipient snapshot、整批转换（默认要求无损，唯一允许的受控有损例外是 `whole_workspace: true` 的静态快照化迁移）、稳定 blocker taxonomy，以及 all-or-error、deterministic、idempotent、side-effect-free 的返回语义。
- 因此 `node-data-migration` 是 frontend migration flow 必须使用的唯一 converter / validator API，但它不是完整 migration orchestrator，也不是 workflow draft mutation API；前端只校验 batch response 完整性和 `node_id` 关联，然后原样应用返回的节点定义。

这几类 runtime / draft 接口继续沿用现有 controller DTO，而不是在 shared contract 中重复定义一份：

- draft `form/preview`：`HumanInputFormPreviewPayload` / `HumanInputFormPreviewResponse`
- draft `form/run`：`HumanInputFormSubmitPayload` / `HumanInputFormSubmitResponse`
- public web submit：继续复用 `HumanInputFormSubmitPayload`，其中 `challenge_token` 与 `otp_code` 是仅 public web OTP flow 使用的可选字段，其他 surface 省略
- public web `/upload-token`：无 request body，response 继续用 `HumanInputUploadTokenResponse`
- service API submit：继续用 `expect_with_user(HumanInputFormSubmitPayload)` 暴露 `user`，不再新增 `ServiceFormSubmitRequest`

注意：当前 stub 中有两个同名 `HumanInputFormSubmitPayload`，字段并不相同：

- `api/controllers/console/app/workflow.py` 里的 draft-local payload：`form_inputs`、`inputs`、`action`
- `api/controllers/common/human_input.py` 里的 runtime-common payload：`inputs`、`action`、`challenge_token?`、`otp_code?`

当前 stub 字段如下。

```python
# api/controllers/console/app/workflow.py
class HumanInputFormPreviewPayload(BaseModel):
    inputs: dict[str, Any] = Field(
        default_factory=dict,
        description="Values used to fill missing upstream variables referenced in form_content",
    )


class HumanInputFormPreviewResponse(ResponseModel):
    form_id: str
    node_id: str
    node_title: str
    form_content: str
    inputs: list[dict[str, Any]] = Field(default_factory=list)
    actions: list[dict[str, Any]] = Field(default_factory=list)
    display_in_ui: bool | None = None
    form_token: str | None = None
    resolved_default_values: dict[str, Any] = Field(default_factory=dict)
    expiration_time: int | None = None


class HumanInputFormSubmitPayload(BaseModel):
    form_inputs: dict[str, Any] = Field(
        ...,
        description="Values the user provides for the form's own fields",
    )
    inputs: dict[str, Any] = Field(
        ...,
        description="Values used to fill missing upstream variables referenced in form_content",
    )
    action: str = Field(..., description="Selected action ID")


class HumanInputFormSubmitResponse(RootModel[dict[str, Any]]):
    root: dict[str, Any]
```

```python
# api/controllers/common/human_input.py
class HumanInputFormSubmitPayload(BaseModel):
    inputs: dict[str, JsonValue] = Field(
        description=(
            "Submitted human input values keyed by output variable name. "
            "Use a string for paragraph or select input values, a file mapping for file inputs, "
            "and a list of file mappings for file-list inputs. Local file mappings use "
            "`transfer_method=local_file` with `upload_file_id`; remote file mappings use "
            "`transfer_method=remote_url` with `url` or `remote_url`."
        ),
    )
    action: str = Field(
        description=(
            "ID of the action button the recipient selected. Must match one of the `id` values from the form's "
            "`user_actions` list."
        )
    )
    challenge_token: str | None = Field(
        default=None,
        description=(
            "Optional OTP challenge token used only by the public web submit flow. "
            "Obtain it from the web access-request endpoint, and omit it on console, service API, and OpenAPI "
            "submissions."
        ),
    )
    otp_code: str | None = Field(
        default=None,
        description=(
            "Optional OTP code used only by the public web submit flow. "
            "Provide it together with `challenge_token` when the public web form requires OTP verification, "
            "and omit it on other surfaces."
        ),
    )
```

```python
# api/controllers/web/human_input_form.py
class HumanInputUploadTokenResponse(ResponseModel):
    upload_token: str
    expires_at: int


class HumanInputFormDefinitionResponse(ResponseModel):
    form_content: str
    inputs: list[FormInputConfig]
    resolved_default_values: dict[str, str]
    user_actions: list[UserActionConfig]
    expiration_time: int
    site: WebAppSiteResponse | None = None


class HumanInputFormSubmitResponse(ResponseModel):
    pass
```

```python
# api/controllers/service_api/app/human_input_form.py
class HumanInputFormDefinitionResponse(ResponseModel):
    form_content: str
    inputs: list[dict[str, Any]] = Field(default_factory=list)
    resolved_default_values: dict[str, str]
    user_actions: list[dict[str, Any]] = Field(default_factory=list)
    expiration_time: int | None = None


class HumanInputFormSubmitResponse(ResponseModel):
    model_config = ConfigDict(extra="forbid")
```

### 3.2 Workspace Console APIs

workspace console 下的新接口全部挂在 `/console/api/workspaces/current/human-input`。

| Method | Path | Flask View | Request | Response | 说明 |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/console/api/workspaces/current/human-input/contacts` | `WorkspaceContactsApi` | `ContactListQuery` | `ListContactsResponse` | 浏览当前 workspace Contact；支持 `workspace / platform / external` 三种显式分组，省略 `group` 时表示 all；其中 `platform` 表示非当前 workspace member 的 `Platform Contact` |
| `GET` | `/console/api/workspaces/current/human-input/organization-candidates` | `WorkspaceOrganizationCandidatesApi` | `OrganizationCandidatesQuery` | `ListOrganizationCandidatesResponse` | 在 EE 中搜索可加入当前 workspace 的 Organization member candidate；CE / SaaS 若保留实现，可直接返回 edition-not-supported |
| `POST` | `/console/api/workspaces/current/human-input/contacts/platform` | `WorkspacePlatformContactsApi` | `AddPlatformContactsRequest` | `AddPlatformContactsResponse` | 在 EE 中批量把 Organization member 加入当前 workspace Contact 并落成 `Platform Contact`；CE / SaaS 若保留实现，可直接返回 edition-not-supported |
| `POST` | `/console/api/workspaces/current/human-input/contacts/external` | `WorkspaceExternalContactsApi` | `ExternalContactCreateRequest` | `ExternalContactCreateResponse` | 创建 external contact |
| `PATCH` | `/console/api/workspaces/current/human-input/contacts/external/<uuid:contact_id>` | `WorkspaceExternalContactApi` | `ExternalContactUpdateRequest` | `ExternalContactUpdateResponse` | 更新 external contact |
| `POST` | `/console/api/workspaces/current/human-input/contacts/remove` | `WorkspaceContactsRemoveApi` | `RemoveContactsRequest` | `RemoveContactsResponse` | 批量 remove `Platform Contact` / `External Contact`；对 platform 执行 detach，对 external 执行 delete；`Workspace Contact` 不走这里，而走 membership management |
| `GET` | `/console/api/workspaces/current/human-input/im-integration` | `WorkspaceIMIntegrationApi` | none | `GetIMIntegrationResponse` | 读取当前唯一 IM channel 的配置摘要 |
| `PUT` | `/console/api/workspaces/current/human-input/im-integration` | `WorkspaceIMIntegrationApi` | `UpdateIMIntegrationRequest` | `UpdateIMIntegrationResponse` | 保存或更新 Organization 级 IM integration |
| `POST` | `/console/api/workspaces/current/human-input/im-integration/test` | `WorkspaceIMIntegrationTestApi` | `TestIMIntegrationRequest` | `TestIMIntegrationResponse` | 测试 credentials / callback / permission |
| `POST` | `/console/api/workspaces/current/human-input/im-sync-runs` | `WorkspaceIMSyncRunsApi` | none | `CreateIMSyncRunResponse` | 手动触发一次 IM sync |
| `GET` | `/console/api/workspaces/current/human-input/im-sync-runs/latest` | `WorkspaceLatestIMSyncRunApi` | none | `GetLatestIMSyncRunResponse` | 读取最近一次 sync run 的 summary；若当前还没有任何 run，返回 not-found |
| `GET` | `/console/api/workspaces/current/human-input/im-sync-runs/latest/results` | `WorkspaceLatestIMSyncRunResultsApi` | `ListLatestIMSyncRunResultsQuery` | `ListLatestIMSyncRunResultsResponse` | 按 `result` 分页读取最近一次 sync run 的结果条目 |
| `GET` | `/console/api/workspaces/current/human-input/im-identities` | `WorkspaceIMIdentitiesApi` | `ListIMIdentitiesQuery` | `ListIMIdentitiesResponse` | 搜索可绑定 / override 的已同步 IM identity |
| `PUT` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-override` | `WorkspaceContactIMOverrideApi` | `SetContactIMOverrideRequest` | `SetContactIMOverrideResponse` | 为当前 workspace 设置 IM override |
| `DELETE` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-override` | `WorkspaceContactIMOverrideApi` | none | `ResetContactIMOverrideResponse` | Reset to global |
| `POST` | `/console/api/workspaces/current/human-input/node-data-migration` | `NodeDataMigrationAPI` | `CreateNodeDataMigrationRequest` | `CreateHITLMigrationResponse` / `NodeMigrationFailure` | 用户确认后批量执行 tenant-scoped、无副作用的 v1 → v2 转换；全部节点成功才返回完整结果，任一节点失败则整批返回错误且无部分结果 |

`organization-candidates` 与 `contacts/platform` 是 EE-only capability。CE / SaaS 若为了复用实现保留相同路由，直接返回 edition-not-supported 即可；EE 下这些路由继续消费 enterprise member / workspace APIs 来搜索并投影 `Platform Contact`。

remove API 则统一成一个批量入口，因为 UI 允许混合选择 `Platform Contact` 与 `External Contact`。`Workspace Contact` 的移除继续归属 membership management，不在这组 Human Input Contact API 中重复定义。

这些接口已经覆盖了 PRD 里的 Contact Directory、external contact、IM integration、manual sync、workspace override；不再额外扩成 task list 或 notification center API。

`node-data-migration` 不修改 workflow DSL、draft、published workflow、graph state 或 migration history。每次调用接收一组待迁移 legacy node data，并基于同一个 request-scoped tenant member / Contact snapshot 完成转换。只有全部节点成功生成新 schema 时才返回完整有序结果；任一节点失败时，整个请求返回错误且不包含部分 v2 node data。前端只在成功响应后通过一次 graph transaction 替换整批节点并同步 draft；重复请求不会产生持久化副作用。

### 3.3 Draft Workflow / Advanced Chat APIs

preview / run 完全沿用现有 controller DTO；旧 `delivery-test` 改成 `message-template/test`。

| Method | Path | Flask View | Request | Response | 说明 |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/preview` | `WorkflowDraftHumanInputFormPreviewApi` | `HumanInputFormPreviewPayload` | `HumanInputFormPreviewResponse` | 保留现有 preview 语义，不新增 shared preview DTO |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/run` | `WorkflowDraftHumanInputFormRunApi` | `HumanInputFormSubmitPayload` | `HumanInputFormSubmitResponse` | 保留现有 draft run 语义，不新增 shared run DTO |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/message-template/test` | `WorkflowDraftMessageTemplateTestApi` | `MessageTemplateTestRequest` | `MessageTemplateTestResponse` | 基于 `Channel` 向当前编辑者发送测试消息 |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/form/preview` | `AdvancedChatDraftHumanInputFormPreviewApi` | `HumanInputFormPreviewPayload` | `HumanInputFormPreviewResponse` | advanced-chat preview，继续复用现有 DTO |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/form/run` | `AdvancedChatDraftHumanInputFormRunApi` | `HumanInputFormSubmitPayload` | `HumanInputFormSubmitResponse` | advanced-chat draft run，继续复用现有 DTO |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/message-template/test` | `AdvancedChatDraftMessageTemplateTestApi` | `MessageTemplateTestRequest` | `MessageTemplateTestResponse` | advanced-chat template test |

这里不建议继续把 v1 `delivery_method_id` 硬塞进 v2 DSL。要测试模板，就让 request 明确表达 `channel: Channel`。

### 3.4 Public Web Runtime APIs

这里的 public web runtime surface 明确只描述 email-based approver 的 OTP submit 流程。`GET form` 与 `upload-token` 继续基于 `form_token` 工作，真正的审批资格只在 `submit` 时通过 OTP 校验。

| Method | Path | Flask View | Request | Response | 说明 |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/form/human-input/<string:form_token>` | `HumanInputFormApi` | none | `HumanInputFormDefinitionResponse` | 直接返回 form definition；额外包含 `site`，打开页面不等于获得审批提交权限 |
| `POST` | `/api/form/human-input/<string:form_token>/access-request` | `FormAccessRequestApi` | none | `FormAccessRequestResponse` | 给当前 email-based approver 发送 OTP |
| `POST` | `/api/form/human-input/<string:form_token>/upload-token` | `HumanInputFormUploadTokenApi` | none | `HumanInputUploadTokenResponse` | 保持当前 bodyless 设计，继续仅凭 `form_token` 申请 upload token |
| `POST` | `/api/form/human-input/<string:form_token>` | `HumanInputFormApi` | `HumanInputFormSubmitPayload` | `HumanInputFormSubmitResponse` | 真正的审批提交入口；`challenge_token` / `otp_code` 为 public web OTP flow 的可选字段 |

这组接口满足了两个核心约束：

- `form_token` 不能单独作为提交授权凭证
- `submit` 才是审批动作；打开页面和上传文件不等于审批成功

### 3.5 Service API Runtime APIs

Service API 继续保持 trusted app-token 模型，但 GET / POST 都要显式带 `user`。

| Method | Path | Flask View | Request | Response | 说明 |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/v1/form/human-input/<string:form_token>?user=<string>` | `WorkflowHumanInputFormApi` | `ServiceFormQuery` | `HumanInputFormDefinitionResponse` | 读取 form definition；当前 stub 的 `inputs` / `user_actions` 都是 `dict` 列表；没有 `user` 直接拒绝 |
| `POST` | `/v1/form/human-input/<string:form_token>` | `WorkflowHumanInputFormApi` | `expect_with_user(HumanInputFormSubmitPayload)` | `HumanInputFormSubmitResponse` | 保持当前 service API 设计：`user` 继续由 wrapper 注入 `end_user`，不新增独立 submit DTO |

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

  rpc GetLatestIMSyncRun(GetLatestIMSyncRunReq)
      returns (GetLatestIMSyncRunRes) {
    option (google.api.http) = {
      get: "/v1/dashboard/api/human-input/im-sync-runs/latest",
    };
  }

  rpc ListLatestIMSyncRunResults(ListLatestIMSyncRunResultsReq)
      returns (ListLatestIMSyncRunResultsRes) {
    option (google.api.http) = {
      get: "/v1/dashboard/api/human-input/im-sync-runs/latest/results",
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
  // Aggregate reconciliation counts for the current run snapshot.
  IMSyncRunResultCounts result_counts = 7 [json_name = "result_counts"];
}

// Stable bucket names exposed by IM sync result APIs.
enum IMSyncResultType {
  // Default zero value.
  IM_SYNC_RESULT_TYPE_UNSPECIFIED = 0;
  // Entry was newly matched and bound.
  IM_SYNC_RESULT_TYPE_ADDED = 1;
  // Entry could not be matched to a Dify contact.
  IM_SYNC_RESULT_TYPE_NOT_MATCHED = 2;
  // Entry failed to reconcile.
  IM_SYNC_RESULT_TYPE_FAILED = 3;
  // Entry caused a prior binding to be removed.
  IM_SYNC_RESULT_TYPE_REMOVED = 4;
  // Entry was intentionally skipped.
  IM_SYNC_RESULT_TYPE_SKIPPED = 5;
}

// Aggregate result counts for one IM sync run.
message IMSyncRunResultCounts {
  // Number of entries newly matched and bound.
  int32 added = 1;
  // Number of entries that could not be matched.
  int32 not_matched = 2 [json_name = "not_matched"];
  // Number of entries that failed to reconcile.
  int32 failed = 3;
  // Number of entries whose prior binding was removed.
  int32 removed = 4;
  // Number of entries intentionally skipped.
  int32 skipped = 5;
}

// One paginated reconciliation result entry for the latest sync run.
message IMSyncResultItem {
  // Result bucket this entry belongs to.
  IMSyncResultType result = 1;
  // Provider-side user identifier returned by the IM platform.
  string provider_user_id = 2 [json_name = "provider_user_id"];
  // Display name returned by the IM platform.
  string display_name = 3 [json_name = "display_name"];
  // Provider email used for matching.
  string email = 4;
  // Matched Dify contact identifier, if any.
  string contact_id = 5 [json_name = "contact_id"];
  // Stable reconciliation reason exposed to clients.
  IMSyncReason reason = 6;
}

// Request for creating one manual IM sync run.
message CreateIMSyncRunReq {}

// Response body for creating one manual IM sync run.
message CreateIMSyncRunRes {
  // Newly created sync run snapshot.
  IMSyncRun run = 1;
}

// Request for reading the latest IM sync run summary.
message GetLatestIMSyncRunReq {}

// Response body for reading the latest IM sync run summary.
message GetLatestIMSyncRunRes {
  // Latest sync run summary.
  IMSyncRun run = 1;
}

// Request for paginating latest-run result items.
message ListLatestIMSyncRunResultsReq {
  // Result bucket to paginate from the latest sync run.
  IMSyncResultType result = 1 [(validate.rules).enum.defined_only = true];
  // 1-based page number.
  int32 page_number = 2 [(validate.rules).int32 = { gte: 1 }];
  // Maximum number of entries returned per page.
  int32 results_per_page = 3 [(validate.rules).int32 = { gte: 1, lte: 100 }];
}

// Response body for paginating latest-run result items.
message ListLatestIMSyncRunResultsRes {
  // Latest sync run summary associated with the current result page.
  IMSyncRun run = 1;
  // Result entries returned for the selected bucket and page.
  repeated IMSyncResultItem data = 2;
  // Pagination metadata.
  pagination.Pagination pagination = 3;
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

1. 落地 node-data migration helper、tenant-scoped resolution 与稳定 blocker contract。
2. 再落 workspace console 的 contact / IM surface。
3. 再切 public web runtime proof model。
4. 再把 Service API GET 改成强制 `user`。
5. 最后补 EE proto 和 EE console wiring。
