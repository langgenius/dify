## Context

`refactor-human-input-im-channel-domain` defines owner-free `IMChannel` values and owner-bound Workspace/Deployment Repository implementations。Repository methods receive already constructed values、use caller-owned `Session` and perform only Channel persistence。They intentionally do not know Provider credentials、operation intent、transaction creation or public Channel projection。

The old `HumanInputIMIntegrationManagementService` and its composition have already been removed。The confirmed Channel API still references that deleted owner，while Provider preparation、credential codec and revision projection retain application-only Integration contracts that this change must replace。

## Goals / Non-Goals

**Goals:**

- Introduce `IMChannelService` as the only application owner for IM Channel management。
- Bind Workspace owner、actor and credential cipher in the concrete Service constructor rather than operation arguments。
- Keep Provider I/O and credential protection outside the database transaction。
- Construct complete `IMChannel` values and select Repository operations deterministically。
- Preserve existing Channel API projection、opaque version and stable failures。

**Non-Goals:**

- Do not modify `HumanInputIMChannel` schema、owner-key encoding、Repository CAS or persistence errors。
- Do not modify Identity、Binding、Sync/Reconciliation、Inbox、delivery、Webhook runtime or dependent `integration_id` references。
- Do not define OAuth installation、remote cleanup、diagnostic worker or background lifecycle。
- Do not redesign Channel routes、DTOs、`ChannelSummary` or Provider credential DTOs。
- Do not expose or implement the later EE-to-Dify inner API；the confirmed Console routes are CE/SaaS Workspace APIs only。

## Decisions

### 0. Change-owned Service API stub freezes the implementation surface

`service.py` is a non-importable reference artifact for the shared `IMChannelService` implementation、its Workspace constructor and the future Deployment constructor shape。Production code MUST NOT import it。This change implements only the Workspace Service and Console wiring。Implementation review MUST resolve the reference API against this design and the delta specs before editing production modules；when prose and the stub disagree，the artifacts MUST be reconciled rather than silently choosing one。

### 1. `IMChannelService` is owner-bound at construction

`IMChannelService` methods expose:

- `available_providers()`；
- `get_current()`；
- `get(channel_id)`；
- `test(credentials)`；
- `create(credentials)`；
- `update(channel_id, expected_config_version, credentials)`；
- `replace(channel_id, expected_config_version, credentials)`；
- `delete(channel_id, expected_config_version)`。

Methods do not accept `DirectoryScope`、`TenantId`、edition or actor。`WorkspaceIMChannelService` captures trusted Tenant、Account、Session factory and Key Provider，then constructs the Tenant-bound credential codec and owner-bound Workspace Reader/Writer internally。The future `DeploymentIMChannelService` shape remains in the reference stub but has no production implementation in this change。

Alternative operation-level scope arguments would recreate two ownership authorities and make service callers responsible for matching Repository、cipher and actor context，so they are rejected。

### 2. Concrete Services construct the separate Reader and Writer internally

The shared implementation receives only a caller Session factory。`WorkspaceIMChannelService._new_reader(session)` constructs `WorkspaceIMChannelReader(session, tenant_id)`；`_new_writer(session)` constructs `WorkspaceIMChannelWriter(session, tenant_id, account_id)`。The separate Repository ports remain intact and no combined Repository facade or factory contract is introduced。

Read operations open a short Session and construct one Reader。Write operations open `session.begin()` only after Provider preparation succeeds，construct one Writer，invoke exactly one persistence method and let context exit commit/rollback。

### 3. Provider preparation is a private step of IMChannelService

`WorkspaceIMChannelService` constructs `IMCredentialCodec` from its Tenant-bound cipher。The shared Service privately owns Provider adapter construction、authentication、permission checks、Provider tenant resolution、safe app-identifier extraction and credential sealing。No Provider preparation Port、second application Service or public prepared-configuration contract is introduced。

`_prepare_configuration(credentials)` returns only a private `_PreparedIMChannelConfiguration` used before Channel identity、timestamps、version and `webhook_id` are assigned。`test(credentials)` returns no result and performs no persistence access。

`IMChannelService` converts only classified Provider failures to existing credential-safe `ChannelProviderError` values。Unclassified Provider、adapter and credential-codec exceptions propagate unchanged to the generic internal-error boundary；Service and controller MUST NOT wrap them in another application error or copy their details into a controlled HTTP response。

### 4. Local checks precede avoidable Provider I/O

Create first reads the bound owner slot；an existing Channel returns `ChannelAlreadyConfiguredError` before preparation。The later Repository insert remains authoritative for concurrent create。

Update/replacement/delete first load the addressed current Channel。Missing or mismatched ID returns `ChannelNotFoundError`。If numeric expected version is already stale，Service returns `ProviderConfigurationUpdatedError` before Provider I/O。

Update can reject a submitted different Provider discriminator before remote validation。Provider tenant equality can be decided only after successful preparation。

These early checks are optimizations and safe failure ordering；final update/replacement/delete correctness remains Repository scalar CAS inside the write transaction。

### 5. The Service constructs complete Channel values

The Service owns `_now()`、`_new_channel_id()` and `_new_webhook_id()` helpers。Production constructors do not expose test-only factories。Each transition calls `_now()` once；the Webhook helper returns the canonical 32-character URL-safe value generated from 192 bits of randomness。

Create constructs a new Channel with:

- new Channel ID and Webhook ID；
- initial numeric version；
- Provider-confirmed protected configuration；
- connected status and `status_reason = None`；
- identical created/updated timestamps。

Ordinary update preserves Channel ID、Webhook ID and created timestamp，uses expected version plus one，writes prepared configuration，resets status to connected and advances updated timestamp。

Explicit replacement constructs a new Channel ID、Webhook ID、created timestamp and initial version。It can replace the addressed Channel only through the explicit endpoint；ordinary update never performs implicit replacement。

Delete performs no Provider I/O and returns the deleted Channel ID after Repository success。

### 6. Operation selection belongs to the Service

Ordinary update requires prepared Provider and Provider tenant ID to match current Channel。Mismatch returns existing `ReplacementRequiredError` without Repository update。

Explicit replacement always calls `Repository.replace` after preparation and stale precheck。Repository does not repeat the business decision；it only validates persistence shape and CAS。

Create catches `IMChannelAlreadyConfiguredError` and returns existing `ChannelAlreadyConfiguredError`。All existing-resource Repository stale failures map to `ProviderConfigurationUpdatedError`。Unexpected persistence failures remain generic internal failures and do not expose owner key、SQL or credentials。

### 7. Service outputs are credential-free

`IMChannelService` never returns Repository `IMChannel` directly to controllers because it contains an encrypted credential envelope。It maps current/persisted values through `_to_view()` to an immutable credential-free `IMChannelView` containing the fields needed by existing Channel projection: ID、timestamps、Provider、status/reason、safe app identifier、optional Webhook URL and numeric version。

The controller continues mapping `IMChannelView` to existing `ChannelSummary` and encoded `ConfigVersion`。The transport codec continues encoding the Channel kind、Channel ID and numeric version in the opaque value；its wire format does not change。

`IMProvider.supports_webhook()` is the sole Provider-level capability source。It returns `True` for Slack、Feishu、Lark and Microsoft Teams，and `False` for DingTalk and WeCom，matching the current adapter implementations。The method reads no credentials and constructs no adapter；credential-bound handler availability remains outside this management change。

`IMEventTransportMode` contains only `WEBHOOK` and `STREAM`。`dify_config.HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE` is a required typed deployment configuration value；missing or invalid configuration fails during configuration loading instead of producing an implicit default or third mode。Console payloads cannot select or override mode，and mode is not persisted in Channel rows or sealed credentials。Workspace Service construction passes the current global value into each request-scoped shared Service。No resolver abstraction is introduced。

`im_channel_service.py` privately owns `_generate_im_provider_webhook_url(webhook_id)`。The helper reads current `TRIGGER_URL` and appends the fixed `/callbacks/human-input/v2/im/<webhook_id>` path with URL-safe joining and escaping。It MUST NOT live under `core.trigger.utils` or reuse the Workflow Trigger `/triggers/webhook/<webhook_id>` generator。

`_to_view(channel)` is the sole application projection from persistence `IMChannel` to credential-free `IMChannelView`。It excludes encrypted credentials and raw `webhook_id` while carrying the optional public `webhook_url`。Only when effective mode is `WEBHOOK` and `channel.provider.supports_webhook()` is true does the projection pass persisted `webhook_id` to `_generate_im_provider_webhook_url()`；otherwise it projects `webhook_url = None`。No duplicated Provider set、callback-URL resolver or Webhook ingress is introduced。

### 8. The confirmed Channel API is retained

`controllers/console/human_input_v2/channel.py` keeps its CE/SaaS Workspace routes、request/response models、authorization guards、Provider DTO mapping、`ChannelSummary` and error mapping。Every IM route receives the trusted current `TenantId` and `AccountId` required to construct one request-scoped `WorkspaceIMChannelService`。The controller validates transport parameters and opaque versions、delegates resource existence and every Channel decision to the owner-bound Service、translates stable application errors and projects the returned view；it does not read Repository state、perform Provider I/O、choose operations or own transactions。

EE management follows a different boundary。A later change exposes a deployment-bound Dify inner API for EE and constructs the deployment Service there；it does not reuse or add edition branches to the Workspace Console controller。

Edition enforcement belongs to transport admission rather than handler or Service logic。One outer Workspace Channel gate checks `dify_config.DEPLOYMENT_EDITION` before setup、authentication、DTO parsing or owner context resolution；Enterprise receives HTTP `501` for every canonical Workspace Channel path，while Community and Cloud continue into the existing authorization stack。The future EE inner API MUST apply the inverse gate and return HTTP `501` on Community or Cloud。Neither gate passes edition into `IMChannelService` or Repository operations。

Controller and OpenAPI tests are migrated to `IMChannelService` doubles rather than deleted。No legacy IM management route is restored。

### 9. Old application ownership is removed

The legacy Service and composition are already absent。After callers migrate，delete the remaining application-only Integration management contracts、exports、credential envelope references and obsolete tests。Do not delete Repository/persistence code owned by the prerequisite change or dependent control-plane modules retained for later migrations。

## Risks / Trade-offs

- [Read-before-Provider race] → Final Repository create/CAS remains authoritative；early reads only avoid work and select safe failure ordering。
- [Concrete Service binds mismatched context] → Workspace composition tests prove Reader、Writer and Tenant credential codec use the same trusted Tenant and actor。
- [Provider I/O accidentally enters transaction] → Ordering tests observe Session/transaction state around private Provider preparation；no write Session begins before preparation completes。
- [Encrypted credentials reach controller] → Service return type is credential-free `IMChannelView` and controller tests reject Repository values。
- [Repository change lands later] → This change declares `refactor-human-input-im-channel-domain` as implementation prerequisite and does not duplicate temporary persistence adapters。

## Migration Plan

1. Reconcile the change-owned Service stub、design and delta specs。
2. Implement the shared Service logic、private Provider preparation and credential-free view projection。
3. Add `WorkspaceIMChannelService` owner binding and transaction ordering。
4. Migrate Console callers while preserving API contracts。
5. Remove residual application-only Integration management contracts、exports and tests。
6. Run service、composition、controller、security and API contract suites。

## Open Questions

无。
