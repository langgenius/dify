## Context

现有 Channel Management 把 provider catalog 与 configured Channel 合并成同一个 model。Collection 为每个 provider 构造 configured 或 `not_configured` view，item path 也由 `(kind, provider)` 定位；但 IM persistence 当前只有一个 active Integration。因此 `GET /channels/im/feishu` 可以表示 Feishu 未配置，而同一路径的 PUT 可能替换 Slack，DELETE 又可能找不到 Feishu resource。

实现层同时复制了 Email/IM candidate、credentials、commands、aggregate transition 和 per-provider manager。Channel layer 没有抹平 Email 与 IM 的 schema 或 invariant，却要求每次 provider field 变化在 IM owner、Channel candidate、manager、registry、controller 和 OpenAPI definition 多处同步。

本 change 保留 Channel 作为 Console 的 canonical term。`api/controllers/console/human_input_v2/` 拥有 HTTP DTO，Email configuration 与 IM Integration configuration 仍由既有 application owner 管理。

## Goals / Non-Goals

**Goals:**

- 让 configured Channel 与 available provider 成为两个语义独立的 resource collection，并各自只提供一个 list endpoint。
- 让 item URL 永远定位一个已持久化 resource，而不是一个可能未配置的 provider slot。
- 让 Console transport 直接聚合 Email/IM owner 的 configured-resource/provider discovery，不为 HTTP collection 创建对应的 application facade。
- 保持现有 IM domain CAS、diagnostic、identity/binding ownership，同时让 HTTP `ConfigVersion` 对 client 保持 opaque。
- 在当前 single-IM invariant 下提供 ID-addressed explicit replacement。
- 移除旧 `im-integration` management API，并删除或迁移其重复 Console credential/request DTO。

**Non-Goals:**

- 不统一 Email 与 IM provider configuration fields 或 persistence model。
- 不建立 generic Channel table、generic credential store 或 generic provider plugin registry。
- 不读取 provider directory，不实现 reconciliation 或 Celery dispatch。
- 不实现 Slack OAuth authorize/callback/token lifecycle。
- 不实现 frontend repository migration 或 EE transport。

## Decisions

### 1. Channel is a transport boundary over independent Email and IM owners

Channel Management 不定义 cross-kind application service 或 core contract package。Console controller 直接调用 Email Management service 和 IM Integration application service；`GET /channels` 聚合两个 owner 的 credential-free view，`GET /channel-providers` 聚合两个 owner 的 available providers。这两个操作只负责 HTTP response organization，不拥有事务、一致性边界或领域规则。

Email 与 IM 使用独立、无可选依赖的 production composition function。Controller 根据稳定的 `email` / `im` route 调用对应 owner；Provider discriminator 由对应 owner 的 typed request 处理。删除 `ChannelHandler`、`ChannelHandlerRegistry`、`DuplicateChannelHandlerError`、per-provider Channel manager、runtime register/resolve flow 和同签名 pass-through。

这使相邻层提供不同 abstraction：Email/IM owner 负责各自的配置状态与 lifecycle invariant；controller 只负责 HTTP DTO mapping、owner invocation、cross-kind response organization、canonical projection 和 safe response translation。`api/controllers/console/human_input_v2/providers.py` 是 Console provider credential DTO 的 canonical owner，并负责把 HTTP DTO 映射到 owner-native application input。

### 2. Configured Channels and provider catalog are separate resources

All paths are relative to `/console/api/workspace/current/human-input/v2`。Configured resources use:

| Method | Route | Meaning |
| --- | --- | --- |
| `GET` | `/channels` | List every configured Email and IM Channel |
| `POST` | `/channels/email` | Create an Email Channel |
| `POST` | `/channels/email/test` | Test an Email candidate without persistence |
| `GET` | `/channels/email/<channel_id>` | Read one persisted Email Channel |
| `PUT` | `/channels/email/<channel_id>` | Update that Email Channel |
| `DELETE` | `/channels/email/<channel_id>` | Delete that Email Channel |
| `POST` | `/channels/im` | Create an IM Channel |
| `POST` | `/channels/im/test` | Test an IM candidate without persistence |
| `GET` | `/channels/im/<channel_id>` | Read one persisted IM Channel |
| `PUT` | `/channels/im/<channel_id>` | Rotate credentials for that IM Channel |
| `DELETE` | `/channels/im/<channel_id>` | Delete that IM Channel |
| `POST` | `/channels/im/<channel_id>/replacement` | Replace that IM Channel |

Provider discovery uses:

| Method | Route | Meaning |
| --- | --- | --- |
| `GET` | `/channel-providers` | List available Email and IM providers in separate response fields |

A `ChannelProvider` contains `provider` and `connection_mode`。The response contains `email_providers` and `im_providers` arrays。This change returns only `custom_app` as `connection_mode`。The entry has no availability field、configured state、resource identity、status or configuration revision。The catalog omits unavailable providers；availability is expressed only by collection membership。

`ChannelSummary` is the canonical credential-free transport projection for every configured Channel。It contains `id`、`created_at`、`updated_at`、`kind`、`provider`、`status`、`status_description`、`display_identifier`、`webhook_url` and `config_version`。Collection、create、update and replacement use this same projection；per-kind `*ChannelSummary` DTOs and retained controller `IMIntegration` projections are removed。

`display_identifier` is derived only from non-secret identity fields。For IM it contains a safe app/client identifier and MAY append a provider tenant display name when available。For Email it contains a safe client/app identifier when the provider has one and `${sender_name} ${sender_email}` when sender fields are available；Resend therefore uses `${sender_name} ${sender_email}`。It MUST NOT contain an API key、secret、token、encrypt key or masked credential。

### 3. Kind collections preserve future cardinality

In this change the Email owner permits at most one Workspace Email configuration and the IM owner permits at most one active IM Integration in the effective `DirectoryScope`。`GET /channels` can therefore return at most one item of each kind。This is an application invariant, not a singleton URL shape。

The unified collection and ID-addressed item routes do not encode the current cardinality into the URL。This change does not define or pre-build multi-IM persistence behavior。

### 4. Create, update and replacement express different transitions

`POST /channels/im` means create。Under the current single-IM invariant it returns conflict before provider I/O when an IM Channel already exists。

Cross-provider or provider-tenant switching uses `POST /channels/im/<channel_id>/replacement` with complete credentials and `expected_config_version`。The operation validates the new complete candidate outside the write transaction, then atomically replaces the target and clears only identities/bindings owned by it。A stale or mismatched target leaves all state unchanged。

`PUT /channels/im/<channel_id>` means credential rotation for the addressed resource。The request provider must equal the persisted provider。Validation must confirm the same provider tenant。Success preserves domain integration identity、identities and bindings and increments the numeric domain configuration version once。A different provider or provider tenant returns `replacement_required` without persistence。The caller then uses the ID-addressed replacement subresource。

Stable conflict codes correspond to distinct client recovery behavior。This change defines only `replacement_required` and `provider_configuration_updated`。Another stable conflict code is introduced only when a concrete client recovery requirement needs to distinguish that conflict。

### 5. Console v2 owns provider credential transport DTOs

`api/controllers/console/human_input_v2/providers.py` owns the Console v2 `IMProviderCredentials` and `EmailProviderCredentials` discriminated unions plus their Feishu、Lark、Slack、DingTalk、Microsoft Teams、WeCom and Resend variants。Old controller credential DTOs are deleted or migrated to this module。Domain credential and aggregate types may remain internal to their application owners, but they are not a second HTTP contract authority。

Create and test requests contain `credentials`。Update and replacement requests contain `credentials` and required `expected_config_version`。Delete requires `expected_config_version` as a query argument。The item path supplies `channel_id`；requests MUST NOT repeat an expected integration ID or replacement target ID。

Create、update、replacement and test all require complete provider credentials。Every required secret must contain a newly submitted non-blank value。The DTOs do not accept `PreserveOriginalValue` or persisted-secret merging。They do not perform special masked-placeholder detection；submitted secret strings proceed through normal DTO and provider validation。Every secret field uses Pydantic `SecretStr` so DTO repr、logs and validation diagnostics do not expose its value。

Resend `sender_email`、`sender_name` and `api_key` are required。The Console DTO maps the complete candidate to the Email owner without creating a second Email aggregate。

HTTP `ConfigVersion` is an opaque string owned by Console transport。A client stores and returns it exactly as received and MUST NOT parse、decode、modify、interpret or synthesize it。The Console codec translates Email values to `EmailConfigurationSnapshot` and IM values to `IntegrationRevisionToken` before invoking the corresponding owner。For an IM write the codec validates kind and path `channel_id` together with the decoded numeric domain version, preserving the IM owner's complete `integration_id + numeric config_version` CAS invariant。

### 6. Candidate tests do not address persisted resources

Test routes live on kind create paths because a candidate may use an unconfigured provider and has no `channel_id`。Both accept the same complete provider credential DTO used by save operations。

Tests use only submitted credentials, perform no persisted-credential read and write no configuration、status、diagnostics or revision。Success returns `200` with `ChannelTestResponse`。Invalid credentials map to `invalid_credentials`；all other expected provider failures map to `connection_failure`。An unexpected failure returns `500` with no provider error or internal diagnostic。

### 7. Provider I/O precedes one atomic state transition

IM create, rotation and replacement authenticate credentials, validate required directory scopes, resolve provider tenant identity and verify compatibility with the read-only effective deployment event transport before opening the database transaction. The validated result contains only protected credentials and credential-free metadata needed by the IM owner. `event_transport_mode` remains deployment configuration and is never accepted from a tenant request or persisted in an Integration.

The IM owner then applies the configuration transition atomically。The transition advances the numeric domain configuration version once。Validation、authorization、CAS or persistence failure leaves credentials、diagnostics、identities and bindings unchanged。

`ChannelSummary.status` has exactly `connected`、`invalid_credentials` and `connection_failure`。`status_description` is empty for `connected` and contains only a safe human-readable explanation for an error state。There is no asynchronous creation state and no `last_checked_at` transport field。

Provider adapters may reuse existing credential validation. They must not call `directory.read_directory()` or create another directory client, pagination pipeline, normalization path or sync-specific credential model.

### 8. Legacy management routes are removed, not aliased

The Console blueprint removes:

- `/workspaces/current/human-input/im-integration`
- `/workspaces/current/human-input/im-integration/test`

Requests to these paths receive route-level `404`. They do not redirect, proxy or dispatch to Channel Management. `im-sync-runs`, `im-identities` and Contact `im-override` routes remain unchanged and continue to use the existing IM Integration state internally.

Keeping the old route as an alias would create two public lifecycle authorities and force future API changes to be maintained twice. Removing route registration and migrating reusable provider credential fields into the v2 controller package leaves one public transport authority.

### 9. Controllers remain transport adapters

Workspace Console controllers enforce authentication and owner/admin authorization on every route, including provider catalog and collection reads；derive the existing `WorkspaceScope` / `DirectoryScope` values required by each owner；validate Pydantic DTOs；decode transport configuration versions；call the Email/IM owners directly；aggregate collection/catalog responses；project owner-native credential-free views through the canonical projection functions；and translate stable safe outcomes。They do not construct a cross-kind service bundle and do not import repositories、credential protectors、provider SDKs or ORM records。

Collection reads perform no provider I/O. Unexpected errors are isolated by configured resource where possible and never expose credentials, raw provider responses or persistence diagnostics.

## Risks / Trade-offs

- [Two discovery collections add one API concept] → Their state semantics are disjoint: provider definitions are static possibilities; Channels are persisted facts. Combining them recreates ambiguous resource identity.
- [Controller aggregates two owners for collection reads] → The aggregation owns only HTTP response organization；provider-specific fields remain in `providers.py`, while lifecycle and persistence semantics remain in the actual owners.
- [Current cross-provider switch uses an ID-addressed replacement subresource] → This makes resource replacement and destructive cleanup explicit；a PUT never silently changes the identity it addresses。
- [Provider validation can discover a tenant change only after external I/O] → Return replacement-required without writing; a retry with explicit replacement target makes operator consent testable.
- [Old clients use `/im-integration`] → Treat removal as a breaking migration and update callers atomically to `/channels/im`; do not retain a compatibility alias.
- [Cloud self-managed configuration can precede OAuth readiness] → Keep new-connect rollout gates unchanged; OAuth remains a separate owner.

## Migration Plan

1. Add contract tests for the unified configured collection, unified provider catalog, ID-addressed items/replacement and legacy-route `404` behavior.
2. Make Email and IM Integration services expose owner-native credential-free views and native revision tokens, and give each owner an independent production composition function.
3. Move Console provider credential DTO ownership to `api/controllers/console/human_input_v2/providers.py`；delete duplicate DTOs and per-provider manager/registry code。
4. Replace provider-addressed controllers with the `/workspace/current/human-input/v2` unified collection/catalog、ID-addressed item and replacement controllers。
5. Move all configuration callers from `/im-integration` to `/workspace/current/human-input/v2/channels/im`, then remove the legacy route registration in the same deployment.
6. Add transition, concurrency, rollback and security coverage before enabling production rollout.

## Verification Strategy

- Service unit tests isolate Email/IM orchestration with deterministic repository and provider test doubles；they own transition selection、provider-I/O ordering、safe error classification and stale/replacement precedence。
- Service integration tests combine each real application owner with PostgreSQL persistence；the IM path also uses the real guarded unit of work and Redis write lock。They own native revision CAS、atomic replacement cleanup、rollback and cross-kind isolation。
- Controller unit tests isolate HTTP authorization、DTO mapping、opaque `ConfigVersion` translation and safe error projection with owner test doubles。
- A minimal Console API integration test crosses the real Flask route、transport codec、production composition、application owner、Redis lock and PostgreSQL repository while replacing only external provider I/O。

## Open Questions

无。
