# Human Input V2 API Summary

## 1. 直接结论

Human Input V2 API 按四个 surface 拆分：

1. workspace console：Contact Directory、IM integration、manual sync、contact IM binding / override、Email provider，以及无副作用的 node-data migration helper。
2. workflow draft：form preview、form run、message-template test。
3. runtime form：public web 与 Service API。
4. EE dashboard admin：只提供 Organization 级 IM integration / sync 与 Organization Contact IM binding Protobuf control-plane；workspace console 在 EE 部署中作为 UI-facing adapter，不形成第二套业务语义。

统一约束如下：

- runtime noun 使用 `form`。
- 新 URL path 统一使用 `human-input`；旧 `human_input` 路由只作为迁移期 alias。
- CE / SaaS API 使用 Flask View 与 Pydantic contract。
- EE admin API 使用 Protobuf 与 `google.api.http`。
- 优先复用现有 DSL 枚举与 schema，不在 transport 层发明第二套业务枚举。
- node-data migration helper 只负责 tenant-scoped 批量转换与 blocker 校验，不持久化 workflow。
- 不新增 notification center、task list、CLI todo 或重复的 member / workspace CRUD。

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

`Channel` 用于 draft `message-template/test`；Organization-level IM integration 使用 `IMProvider`，因为 `Channel` 同时覆盖 Email 与 IM 渠道。

Contact 上位概念保持如下：

- `organization contact` 是上位概念。
- `workspace contact` 与 `Platform contact` 是它的子类。
- CE / SaaS 中 `Organization = workspace`，因此 Organization candidate 与 Platform contact projection 没有可用对象；共享路由可以返回 edition-not-supported。

## 3. Workspace / Runtime API

本节只记录 HTTP 路由与接口作用。请求、响应与校验规则以对应 Python contract 为准。

### 3.1 Workspace Console APIs

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/console/api/workspaces/current/human-input/contacts` | owner/admin 分页浏览当前 workspace Contact，并按 workspace、platform 或 external 类型筛选。 |
| `GET` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>` | owner/admin 读取一个当前 workspace 中可用的完整 Contact projection。 |
| `GET` | `/console/api/workspaces/current/human-input/contacts/batch` | owner/admin 按 contact ID 批量读取 Contact summary；workflow editor 不使用该接口。 |
| `GET` | `/console/api/workspaces/current/human-input/contact-options` | workflow editor 按 keyword 分页搜索静态 recipient 候选，只返回 `id / type / name / avatar_url`。 |
| `GET` | `/console/api/workspaces/current/human-input/contact-options/batch` | workflow editor 按 contact ID 批量回显已保存 recipient，并使用同一最小投影。 |
| `GET` | `/console/api/workspaces/current/human-input/organization-candidates` | 搜索可投影为 Platform contact 的 Organization member candidate。 |
| `POST` | `/console/api/workspaces/current/human-input/contacts/platform` | 批量将 Organization member 投影为当前 workspace 的 Platform contact。 |
| `POST` | `/console/api/workspaces/current/human-input/contacts/external` | 创建 External contact。 |
| `PATCH` | `/console/api/workspaces/current/human-input/contacts/external/<uuid:contact_id>` | 更新 External contact。 |
| `POST` | `/console/api/workspaces/current/human-input/contacts/remove` | 批量 detach Platform contact 或删除 External contact。 |
| `GET` | `/console/api/workspaces/current/human-input/im-integration` | 读取当前 Organization-level IM integration 摘要及 CAS revision。 |
| `PUT` | `/console/api/workspaces/current/human-input/im-integration` | 创建 integration，或使用 `integration_id + config_version` CAS 更新当前配置。 |
| `DELETE` | `/console/api/workspaces/current/human-input/im-integration` | 使用 `integration_id + config_version` CAS 解除当前 integration，并使后续读取回到 `Not configured`。 |
| `POST` | `/console/api/workspaces/current/human-input/im-integration/test` | 测试 IM provider credentials、callback 与 permission。 |
| `POST` | `/console/api/workspaces/current/human-input/im-sync-runs` | 手动创建一次 IM directory sync run。 |
| `GET` | `/console/api/workspaces/current/human-input/im-sync-runs/latest` | 读取最近一次 IM sync run；UI 使用 `finished_at` 作为显式同步时间，不返回 `started_by`。 |
| `GET` | `/console/api/workspaces/current/human-input/im-sync-runs/latest/results` | 必须指定一个真实 result bucket，并使用 `page / limit` 分页读取最近一次 sync run 的 reconciliation result；不支持 All 或 cursor。 |
| `GET` | `/console/api/workspaces/current/human-input/im-identities` | 搜索已同步的 IM identity。 |
| `PUT` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-override` | 设置或替换 workspace-scoped Contact IM override。 |
| `DELETE` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-override` | 清除 workspace-scoped Contact IM override 并恢复全局绑定。 |
| `PUT` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-bindings` | 将一个已同步 IM identity 绑定到 Contact。 |
| `DELETE` | `/console/api/workspaces/current/human-input/contacts/<uuid:contact_id>/im-bindings` | 删除 Contact 的指定 IM binding。 |
| `POST` | `/console/api/workspaces/current/human-input/node-data-migration` | 批量、无副作用地将 Human Input v1 node data 转换为 v2；整批 all-or-error，`whole_workspace: true` 仅允许物化为迁移时 workspace member / Contact snapshot 的静态 recipient 列表。 |
| `GET` | `/console/api/workspaces/current/human-input/email-provider` | 读取 Email provider 配置及 credential configured 状态，不返回 secret 或 masked secret。 |
| `PUT` | `/console/api/workspaces/current/human-input/email-provider` | 创建或更新 Email provider 配置，并支持显式 preserve existing secret。 |

Contact management 与 workflow recipient selection 使用不同读取模型：`contacts` list/detail/batch 继续要求 owner/admin，并可返回管理所需字段；`contact-options` list/batch 要求 edit permission，只暴露 picker 所需最小字段。两组接口都只返回当前 workspace 中解析为 `WORKSPACE / PLATFORM / EXTERNAL` 的 Contact；`ABSENT`、hard-deleted 或其他 unavailable Contact 必须省略，历史 workflow/task/audit 继续读取冻结 snapshot。

### 3.2 Draft Workflow / Advanced Chat APIs

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/preview` | 渲染 workflow draft Human Input form preview。 |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/form/run` | 提交并运行 workflow draft Human Input form。 |
| `POST` | `/console/api/apps/<uuid:app_id>/workflows/draft/human-input/nodes/<string:node_id>/message-template/test` | 向当前编辑者发送 workflow draft message-template test。 |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/form/preview` | 渲染 advanced-chat draft Human Input form preview。 |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/form/run` | 提交并运行 advanced-chat draft Human Input form。 |
| `POST` | `/console/api/apps/<uuid:app_id>/advanced-chat/workflows/draft/human-input/nodes/<string:node_id>/message-template/test` | 向当前编辑者发送 advanced-chat draft message-template test。 |

### 3.3 Public Web Runtime APIs

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/form/human-input/<string:form_token>` | 读取 public Human Input form definition。 |
| `POST` | `/api/form/human-input/<string:form_token>/access-request` | 为 token 关联的 Email approver 创建并发送 OTP challenge。 |
| `POST` | `/api/form/human-input/<string:form_token>/upload-token` | 为 file input 申请 upload token；上传成功不等同于获得提交权限。 |
| `POST` | `/api/form/human-input/<string:form_token>` | 提交 public Human Input form，并在需要时执行 OTP 与 approver 校验。 |

### 3.4 Service API Runtime APIs

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/v1/form/human-input/<string:form_token>?user=<string>` | 在显式 end-user context 下读取 Human Input form definition。 |
| `POST` | `/v1/form/human-input/<string:form_token>` | 在 trusted app-token 与显式 user context 下提交 Human Input form。 |

## 4. EE Protobuf API

以下 Protobuf block 是 EE Human Input admin API 的完整接口定义草案。它只覆盖 Organization 级 IM integration / sync 与账号生命周期绑定的 Organization Contact IM binding control-plane。

EE sync read model 与 workspace console 保持同一语义：只暴露 latest summary 和 latest results；`finished_at` 是 UI 同步时间，不返回 `started_by`；results 必须指定一个真实 bucket，使用 `page / limit / total`，不支持 All、cursor 或在分页响应中重复 run summary。

```proto
syntax = "proto3";

package dify.enterprise.api.enterprise;

option go_package = "github.com/langgenius/dify-enterprise/pkg/apis/enterprise/v1;v1";

import "google/api/annotations.proto";
import "google/protobuf/timestamp.proto";
import "pagination/pagination.proto";
import "validate/validate.proto";

enum IMProvider {
  IM_PROVIDER_UNSPECIFIED = 0;
  IM_PROVIDER_FEISHU = 1;
  IM_PROVIDER_SLACK = 2;
  IM_PROVIDER_DING_TALK = 3;
  IM_PROVIDER_MS_TEAMS = 4;
  IM_PROVIDER_WE_COM = 5;
  IM_PROVIDER_LARK = 6;
}

enum IMIntegrationStatus {
  IM_INTEGRATION_STATUS_UNSPECIFIED = 0;
  IM_INTEGRATION_STATUS_NOT_CONFIGURED = 1;
  IM_INTEGRATION_STATUS_CONFIGURED = 2;
  IM_INTEGRATION_STATUS_CONNECTED = 3;
  IM_INTEGRATION_STATUS_PERMISSION_ISSUE = 4;
  IM_INTEGRATION_STATUS_CALLBACK_ERROR = 5;
  IM_INTEGRATION_STATUS_CONNECTION_ERROR = 6;
}

enum IMIdentityBindingStatus {
  IM_IDENTITY_BINDING_STATUS_UNSPECIFIED = 0;
  IM_IDENTITY_BINDING_STATUS_UNBOUND = 1;
  IM_IDENTITY_BINDING_STATUS_BOUND = 2;
}

enum IMSyncRunStatus {
  IM_SYNC_RUN_STATUS_UNSPECIFIED = 0;
  IM_SYNC_RUN_STATUS_QUEUED = 1;
  IM_SYNC_RUN_STATUS_RUNNING = 2;
  IM_SYNC_RUN_STATUS_SUCCEEDED = 3;
  IM_SYNC_RUN_STATUS_FAILED = 4;
}

enum IMSyncResultType {
  IM_SYNC_RESULT_TYPE_UNSPECIFIED = 0;
  IM_SYNC_RESULT_TYPE_ADDED = 1;
  IM_SYNC_RESULT_TYPE_NOT_MATCHED = 2;
  IM_SYNC_RESULT_TYPE_FAILED = 3;
  IM_SYNC_RESULT_TYPE_REMOVED = 4;
  IM_SYNC_RESULT_TYPE_SKIPPED = 5;
}

enum IMSyncRemovalReason {
  IM_SYNC_REMOVAL_REASON_UNSPECIFIED = 0;
  IM_SYNC_REMOVAL_REASON_NOT_PRESENT_IN_DIRECTORY = 1;
  IM_SYNC_REMOVAL_REASON_BINDING_INVALIDATED = 2;
  IM_SYNC_REMOVAL_REASON_BINDING_REPLACED = 3;
}

message PreserveOriginalValue {}

message SecretUpdate {
  oneof operation {
    option (validate.required) = true;
    string replacement = 1 [(validate.rules).string = { min_len: 1 }];
    PreserveOriginalValue preserve_original_value = 2;
  }
}

message IMBinding {
  string id = 1 [(validate.rules).string = { min_len: 1 }];
  IMProvider provider = 2 [(validate.rules).enum = { defined_only: true, not_in: [0] }];
  string identity_id = 3 [json_name = "identity_id", (validate.rules).string = { min_len: 1 }];
  string provider_user_id = 4 [json_name = "provider_user_id", (validate.rules).string = { min_len: 1 }];
  optional string display_name = 5 [json_name = "display_name"];
  optional string email = 6;
}

message HumanInputContactSummary {
  string id = 1 [(validate.rules).string = { min_len: 1 }];
  string name = 2 [(validate.rules).string = { min_len: 1 }];
  string avatar_url = 3 [json_name = "avatar_url"];
  google.protobuf.Timestamp created_at = 4 [json_name = "created_at"];
}

message HumanInputContact {
  string id = 1 [(validate.rules).string = { min_len: 1 }];
  string name = 2 [(validate.rules).string = { min_len: 1 }];
  optional string email = 3;
  string avatar_url = 4 [json_name = "avatar_url"];
  repeated IMBinding im_bindings = 5 [json_name = "im_bindings"];
  google.protobuf.Timestamp created_at = 6 [json_name = "created_at"];
}

message ListContactsReq {
  optional string member_name = 1 [json_name = "member_name"];
  optional string email = 2;
  optional int32 page = 3 [(validate.rules).int32 = { gte: 1 }];
  optional int32 limit = 4 [(validate.rules).int32 = { gte: 1, lte: 100 }];
}

message ListContactsRes {
  repeated HumanInputContact data = 1;
  pagination.Pagination pagination = 2;
}

message FeishuIMIntegrationCredentials {
  string app_id = 1 [json_name = "app_id", (validate.rules).string = { min_len: 1 }];
  SecretUpdate app_secret = 2 [json_name = "app_secret", (validate.rules).message.required = true];
  SecretUpdate verification_token = 3 [json_name = "verification_token"];
  SecretUpdate encrypt_key = 4 [json_name = "encrypt_key"];
}

message LarkIMIntegrationCredentials {
  string app_id = 1 [json_name = "app_id", (validate.rules).string = { min_len: 1 }];
  SecretUpdate app_secret = 2 [json_name = "app_secret", (validate.rules).message.required = true];
  SecretUpdate verification_token = 3 [json_name = "verification_token"];
  SecretUpdate encrypt_key = 4 [json_name = "encrypt_key"];
}

message SlackIMIntegrationCredentials {
  string client_id = 1 [json_name = "client_id", (validate.rules).string = { min_len: 1 }];
  SecretUpdate client_secret = 2 [json_name = "client_secret", (validate.rules).message.required = true];
  SecretUpdate signing_secret = 3 [json_name = "signing_secret", (validate.rules).message.required = true];
  SecretUpdate bot_token = 4 [json_name = "bot_token", (validate.rules).message.required = true];
}

message DingTalkIMIntegrationCredentials {
  string client_id = 1 [json_name = "client_id", (validate.rules).string = { min_len: 1 }];
  SecretUpdate client_secret = 2 [json_name = "client_secret", (validate.rules).message.required = true];
}

message MSTeamsIMIntegrationCredentials {
  string tenant_id = 1 [json_name = "tenant_id", (validate.rules).string = { min_len: 1 }];
  string client_id = 2 [json_name = "client_id", (validate.rules).string = { min_len: 1 }];
  SecretUpdate client_secret = 3 [json_name = "client_secret", (validate.rules).message.required = true];
}

message WeComIMIntegrationCredentials {
  string corp_id = 1 [json_name = "corp_id", (validate.rules).string = { min_len: 1 }];
  string agent_id = 2 [json_name = "agent_id", (validate.rules).string = { min_len: 1 }];
  SecretUpdate secret = 3 [(validate.rules).message.required = true];
}

message IMIntegrationCredentials {
  oneof provider_credentials {
    option (validate.required) = true;
    FeishuIMIntegrationCredentials feishu = 1;
    LarkIMIntegrationCredentials lark = 2;
    SlackIMIntegrationCredentials slack = 3;
    DingTalkIMIntegrationCredentials ding_talk = 4 [json_name = "ding_talk"];
    MSTeamsIMIntegrationCredentials ms_teams = 5 [json_name = "ms_teams"];
    WeComIMIntegrationCredentials we_com = 6 [json_name = "we_com"];
  }
}

message IMIntegration {
  IMProvider provider = 1 [(validate.rules).enum = { defined_only: true }];
  IMIntegrationStatus status = 2 [(validate.rules).enum = { defined_only: true, not_in: [0] }];
  optional string callback_url = 3 [json_name = "callback_url"];
  optional string permission_hint = 4 [json_name = "permission_hint"];
  google.protobuf.Timestamp configured_at = 5 [json_name = "configured_at"];
  google.protobuf.Timestamp updated_at = 6 [json_name = "updated_at"];
  string integration_id = 7 [json_name = "integration_id", (validate.rules).string = { min_len: 1 }];
  int64 config_version = 8 [json_name = "config_version", (validate.rules).int64 = { gte: 1 }];
}

message GetIMIntegrationReq {}

message GetIMIntegrationRes {
  IMIntegration integration = 1 [(validate.rules).message.required = true];
}

message UpsertIMIntegrationReq {
  IMIntegrationCredentials credentials = 1 [(validate.rules).message.required = true];
  optional string expected_integration_id = 2 [
    json_name = "expected_integration_id",
    (validate.rules).string = { min_len: 1 }
  ];
  optional int64 expected_config_version = 3 [
    json_name = "expected_config_version",
    (validate.rules).int64 = { gte: 1 }
  ];
}

message UpsertIMIntegrationRes {
  IMIntegration integration = 1 [(validate.rules).message.required = true];
}

message DeleteIMIntegrationReq {
  string expected_integration_id = 1 [
    json_name = "expected_integration_id",
    (validate.rules).string = { min_len: 1 }
  ];
  int64 expected_config_version = 2 [
    json_name = "expected_config_version",
    (validate.rules).int64 = { gte: 1 }
  ];
}

message DeleteIMIntegrationRes {}

message TestIMIntegrationReq {
  IMIntegrationCredentials credentials = 1 [(validate.rules).message.required = true];
}

message TestIMIntegrationRes {
  IMIntegrationStatus status = 1 [(validate.rules).enum = { defined_only: true, not_in: [0] }];
  string message = 2;
}

message IMSyncRunResultCounts {
  int32 added = 1 [(validate.rules).int32 = { gte: 0 }];
  int32 not_matched = 2 [json_name = "not_matched", (validate.rules).int32 = { gte: 0 }];
  int32 failed = 3 [(validate.rules).int32 = { gte: 0 }];
  int32 removed = 4 [(validate.rules).int32 = { gte: 0 }];
  int32 skipped = 5 [(validate.rules).int32 = { gte: 0 }];
}

message IMSyncRun {
  string id = 1 [(validate.rules).string = { min_len: 1 }];
  IMSyncRunStatus status = 2 [(validate.rules).enum = { defined_only: true, not_in: [0] }];
  google.protobuf.Timestamp started_at = 3 [json_name = "started_at"];
  // The latest-only UI displays finished_at as the explicit sync time.
  // A started_by field is intentionally not part of this transport contract.
  google.protobuf.Timestamp finished_at = 4 [json_name = "finished_at"];
  optional string error_message = 5 [json_name = "error_message"];
  IMSyncRunResultCounts result_counts = 6 [json_name = "result_counts", (validate.rules).message.required = true];
  IMProvider provider = 7 [(validate.rules).enum = { defined_only: true, not_in: [0] }];
  string integration_id = 8 [json_name = "integration_id", (validate.rules).string = { min_len: 1 }];
  int64 integration_config_version = 9 [
    json_name = "integration_config_version",
    (validate.rules).int64 = { gte: 1 }
  ];
}

message IMDirectoryEntry {
  string provider_user_id = 1 [json_name = "provider_user_id", (validate.rules).string = { min_len: 1 }];
  optional string display_name = 2 [json_name = "display_name"];
  optional string email = 3;
}

message IMIdentitySnapshot {
  string identity_id = 1 [json_name = "identity_id", (validate.rules).string = { min_len: 1 }];
  string provider_user_id = 2 [json_name = "provider_user_id", (validate.rules).string = { min_len: 1 }];
  optional string display_name = 3 [json_name = "display_name"];
  optional string email = 4;
}

message IMSyncResultAdded {
  HumanInputContactSummary contact = 1 [(validate.rules).message.required = true];
  IMDirectoryEntry entry = 2 [(validate.rules).message.required = true];
}

message IMSyncResultRemoved {
  HumanInputContactSummary contact = 1 [(validate.rules).message.required = true];
  IMIdentitySnapshot last_known_identity = 2 [
    json_name = "last_known_identity",
    (validate.rules).message.required = true
  ];
  IMSyncRemovalReason reason = 3 [(validate.rules).enum = { defined_only: true, not_in: [0] }];
}

message IMSyncResultFailed {
  IMDirectoryEntry entry = 1;
  string reason = 2 [(validate.rules).string = { min_len: 1 }];
}

message IMSyncResultNotMatched {
  IMDirectoryEntry entry = 1;
}

message IMSyncResultSkipped {
  IMDirectoryEntry entry = 1;
  HumanInputContactSummary contact = 2 [(validate.rules).message.required = true];
}

message IMSyncResult {
  oneof result {
    option (validate.required) = true;
    IMSyncResultAdded added = 1;
    IMSyncResultRemoved removed = 2;
    IMSyncResultFailed failed = 3;
    IMSyncResultNotMatched not_matched = 4 [json_name = "not_matched"];
    IMSyncResultSkipped skipped = 5;
  }
}

message IMSyncResultItem {
  string id = 1 [(validate.rules).string = { min_len: 1 }];
  IMSyncResult result = 2 [(validate.rules).message.required = true];
}

message CreateIMSyncRunReq {}

message CreateIMSyncRunRes {
  IMSyncRun run = 1 [(validate.rules).message.required = true];
}

message GetLatestIMSyncRunReq {}

message GetLatestIMSyncRunRes {
  IMSyncRun run = 1 [(validate.rules).message.required = true];
}

message ListLatestIMSyncRunResultsReq {
  // Required bucket. IMSyncResultType intentionally has no ALL value.
  IMSyncResultType result = 1 [(validate.rules).enum = { defined_only: true, not_in: [0] }];
  // Defaults to 1 when omitted by the HTTP client.
  optional int32 page = 2 [(validate.rules).int32 = { gte: 1 }];
  // Defaults to 20 when omitted by the HTTP client.
  optional int32 limit = 3 [(validate.rules).int32 = { gte: 1, lte: 100 }];
}

message ListLatestIMSyncRunResultsRes {
  repeated IMSyncResultItem data = 1;
  int32 page = 2 [(validate.rules).int32 = { gte: 1 }];
  int32 limit = 3 [(validate.rules).int32 = { gte: 1, lte: 100 }];
  int64 total = 4 [(validate.rules).int64 = { gte: 0 }];
}

message IMIdentity {
  string id = 1 [(validate.rules).string = { min_len: 1 }];
  IMProvider provider = 2 [(validate.rules).enum = { defined_only: true, not_in: [0] }];
  string provider_user_id = 3 [json_name = "provider_user_id", (validate.rules).string = { min_len: 1 }];
  optional string display_name = 4 [json_name = "display_name"];
  optional string email = 5;
  IMIdentityBindingStatus binding_status = 6 [
    json_name = "binding_status",
    (validate.rules).enum = { defined_only: true, not_in: [0] }
  ];
}

message ListIMIdentitiesReq {
  IMProvider provider = 1 [(validate.rules).enum = { defined_only: true, not_in: [0] }];
  optional string keyword = 2;
  optional int32 page = 3 [(validate.rules).int32 = { gte: 1 }];
  optional int32 limit = 4 [(validate.rules).int32 = { gte: 1, lte: 100 }];
}

message ListIMIdentitiesRes {
  repeated IMIdentity data = 1;
  pagination.Pagination pagination = 2;
}

message CreateIMBindingReq {
  string contact_id = 1 [json_name = "contact_id", (validate.rules).string = { min_len: 1 }];
  string identity_id = 2 [json_name = "identity_id", (validate.rules).string = { min_len: 1 }];
}

message CreateIMBindingRes {
  HumanInputContact contact = 1 [(validate.rules).message.required = true];
}

message DeleteIMBindingReq {
  string contact_id = 1 [json_name = "contact_id", (validate.rules).string = { min_len: 1 }];
  string binding_id = 2 [json_name = "binding_id", (validate.rules).string = { min_len: 1 }];
}

message DeleteIMBindingRes {
  HumanInputContact contact = 1 [(validate.rules).message.required = true];
}

message TestIMBindingReq {
  string contact_id = 1 [json_name = "contact_id", (validate.rules).string = { min_len: 1 }];
  string binding_id = 2 [json_name = "binding_id", (validate.rules).string = { min_len: 1 }];
}

message TestIMBindingRes {
  bool reachable = 1;
  string message = 2;
}

service EnterpriseHumanInputAdmin {
  rpc ListContacts(ListContactsReq) returns (ListContactsRes) {
    option (google.api.http) = {
      get: "/v1/dashboard/api/human-input/contacts"
    };
  }

  rpc GetIMIntegration(GetIMIntegrationReq) returns (GetIMIntegrationRes) {
    option (google.api.http) = {
      get: "/v1/dashboard/api/human-input/im-integration"
    };
  }

  rpc UpsertIMIntegration(UpsertIMIntegrationReq) returns (UpsertIMIntegrationRes) {
    option (google.api.http) = {
      put: "/v1/dashboard/api/human-input/im-integration"
      body: "*"
    };
  }

  rpc DeleteIMIntegration(DeleteIMIntegrationReq) returns (DeleteIMIntegrationRes) {
    option (google.api.http) = {
      delete: "/v1/dashboard/api/human-input/im-integration"
    };
  }

  rpc TestIMIntegration(TestIMIntegrationReq) returns (TestIMIntegrationRes) {
    option (google.api.http) = {
      post: "/v1/dashboard/api/human-input/im-integration/test"
      body: "*"
    };
  }

  rpc CreateIMSyncRun(CreateIMSyncRunReq) returns (CreateIMSyncRunRes) {
    option (google.api.http) = {
      post: "/v1/dashboard/api/human-input/im-sync-runs"
    };
  }

  rpc GetLatestIMSyncRun(GetLatestIMSyncRunReq) returns (GetLatestIMSyncRunRes) {
    option (google.api.http) = {
      get: "/v1/dashboard/api/human-input/im-sync-runs/latest"
    };
  }

  rpc ListLatestIMSyncRunResults(ListLatestIMSyncRunResultsReq) returns (ListLatestIMSyncRunResultsRes) {
    option (google.api.http) = {
      get: "/v1/dashboard/api/human-input/im-sync-runs/latest/results"
    };
  }

  rpc ListIMIdentities(ListIMIdentitiesReq) returns (ListIMIdentitiesRes) {
    option (google.api.http) = {
      get: "/v1/dashboard/api/human-input/im-identities"
    };
  }

  rpc CreateIMBinding(CreateIMBindingReq) returns (CreateIMBindingRes) {
    option (google.api.http) = {
      post: "/v1/dashboard/api/human-input/contacts/{contact_id}/im-bindings"
      body: "*"
    };
  }

  rpc DeleteIMBinding(DeleteIMBindingReq) returns (DeleteIMBindingRes) {
    option (google.api.http) = {
      delete: "/v1/dashboard/api/human-input/contacts/{contact_id}/im-bindings/{binding_id}"
    };
  }

  rpc TestIMBinding(TestIMBindingReq) returns (TestIMBindingRes) {
    option (google.api.http) = {
      post: "/v1/dashboard/api/human-input/contacts/{contact_id}/im-bindings/{binding_id}/test"
    };
  }
}
```

## 5. 不进入本期的接口

下面这些不应该借这次 API 设计顺手扩进去：

- notification center API
- member-side pending task list API
- CLI todo / approval inbox API
- 新的 `task` noun 路由
- 重复的 EE member / workspace CRUD proto
- EE Platform / External Contact lifecycle、workspace IM override、node-data migration 或 Email provider RPC
- 与 DSL / enterprise style 脱节的 transport enum

## 6. 推荐落地顺序

1. 落地 node-data migration helper、tenant-scoped resolution 与稳定 blocker contract。
2. 落地 workspace console 的 Contact、IM 与 Email provider surface。
3. 切换 public web runtime proof model，并让 Service API GET 强制要求 `user`。
4. 将 draft debug 从 `delivery-test` 切换为 `message-template/test`。
5. 以本节 Protobuf contract 为基础实现 EE backend，并让 EE workspace console 通过 adapter 接入。
