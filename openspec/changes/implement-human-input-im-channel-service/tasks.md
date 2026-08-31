## 1. Freeze Service Contracts

- [ ] 1.1 Review the change-owned `service.py` reference stub against this design and every delta spec；resolve constructor、return-type、Repository selection and Provider preparation mismatches before production edits，then add behavior tests after implementation.
- [ ] 1.2 Define private `_PreparedIMChannelConfiguration` and public credential-free `IMChannelView` in the Service owner；document why the former is not a Domain contract and why only `_to_view()` may expose management facts.
- [ ] 1.3 Keep `IMChannelReader` / `IMChannelWriter` separate and make `WorkspaceIMChannelService` construct the owner-bound implementations internally from its captured Tenant and Account.
- [ ] 1.4 Add or update import-linter boundaries so Service does not import dependent repositories、controller DTOs、raw owner-key helpers or unrelated Provider runtime owners；do not add pytest tests for file or symbol placement.
- [ ] 1.5 Require completed `refactor-human-input-im-channel-domain` Repository contracts before production Service wiring；do not add compatibility Repository implementations here.

## 2. Bind Provider Preparation

- [ ] 2.1 Move existing Provider validation、tenant resolution、safe app identifier extraction and credential sealing into private `IMChannelService` methods without a separate Port or application Service.
- [ ] 2.2 Construct the Workspace credential codec from the constructor-bound Tenant and Key Provider；keep Deployment credential composition out of production scope.
- [ ] 2.3 Preserve Provider credential DTOs、adapter tests、permission checks、Provider tenant resolution、safe app identifier extraction and canonical `IMEncryptedCredentials` sealing.
- [ ] 2.4 Add failure tests proving classified Provider errors map to stable safe application failures，while unclassified Provider、adapter and credential-codec exceptions propagate as the original exception and the Console controller leaves them to the generic HTTP 500 boundary without copying their details into a controlled response.
- [ ] 2.5 Add candidate-test tests proving no Repository/Session/persistence access occurs.

## 3. Implement Read And View Operations

- [ ] 3.1 Add `IMEventTransportMode.WEBHOOK/STREAM` and required typed `dify_config.HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE`；reject missing/invalid values during configuration loading and keep mode out of Console DTOs、Channel persistence and credential envelopes.
- [ ] 3.2 Add configuration tests for both modes、missing/invalid values、request override rejection and no implicit default；update required deployment environment examples.
- [ ] 3.3 Implement `IMProvider.supports_webhook()` as the single static capability source：Slack、Feishu、Lark and Microsoft Teams return true；DingTalk and WeCom return false；the method reads no credentials and constructs no adapter.
- [ ] 3.4 Implement private `im_channel_service._generate_im_provider_webhook_url(webhook_id)` from current `TRIGGER_URL` and fixed `/callbacks/human-input/v2/im/<webhook_id>` path；do not place it under `core.trigger.utils` or reuse the Workflow Trigger endpoint generator.
- [ ] 3.5 Add URL tests for configured origin、base paths、path joining、Webhook ID escaping and `TRIGGER_URL` changes without persistence mutation.
- [ ] 3.6 Implement `IMChannelService.available_providers()` from the concrete Provider adapters accepted by complete credential commands.
- [ ] 3.7 Implement `get_current()` and `get(channel_id)` with short read Sessions and owner-bound Repository construction.
- [ ] 3.8 Implement `_to_view()` as the sole Repository `IMChannel` to credential-free `IMChannelView` projection without decrypting credentials or performing Provider I/O.
- [ ] 3.9 In `_to_view()`，derive Webhook URLs through the private Service-module helper only for `WEBHOOK + supports_webhook()`；return `None` for `STREAM` or unsupported Providers without implementing ingress.
- [ ] 3.10 Add mode/capability/projection tests for configured `TRIGGER_URL`、both modes、all six Providers and absence of raw `webhook_id` or credentials in `IMChannelView`.
- [ ] 3.11 Add tests for missing current Channel、addressed-ID mismatch、safe status/app metadata and absence of credentials/owner key/actor/ORM state.

## 4. Implement Create And Update

- [ ] 4.1 Implement create pre-read so observed configured state fails before avoidable Provider I/O while Repository uniqueness remains authoritative for concurrent create.
- [ ] 4.2 Generate Channel ID、192-bit/32-character URL-safe `webhook_id`、initial numeric version、connected status and timestamps through Service-owned helpers；call `_now()` once per transition.
- [ ] 4.3 Open the create transaction only after preparation/value construction；map `IMChannelAlreadyConfiguredError` to `ChannelAlreadyConfiguredError`.
- [ ] 4.4 Implement update prechecks for addressed Channel ID、numeric expected version and Provider discriminator before avoidable Provider I/O.
- [ ] 4.5 After preparation，require same Provider tenant or return `ReplacementRequiredError` without Repository mutation.
- [ ] 4.6 Construct update value preserving Channel ID、`webhook_id`、created timestamp and advancing numeric version once；map Repository stale failure to `ProviderConfigurationUpdatedError`.

## 5. Implement Replacement And Delete

- [ ] 5.1 Implement explicit replacement prechecks and Provider preparation outside transaction.
- [ ] 5.2 Construct replacement with new Channel ID、new `webhook_id`、initial version and fresh timestamps，then invoke Repository replacement in one short transaction.
- [ ] 5.3 Implement delete prechecks and Repository delete without Provider I/O、remote cleanup、dependent Repository calls or task dispatch.
- [ ] 5.4 Return deleted Channel ID only after transaction commit.
- [ ] 5.5 Add current/stale/not-found tests for replacement/delete plus tests proving dependent Domain state is untouched.

## 6. Implement Transaction And Owner Composition

- [ ] 6.1 Implement Service write helper that creates Session/transaction after Provider preparation，constructs one owner-bound Writer with that Session and invokes one mutation.
- [ ] 6.2 Add ordering tests proving no database transaction is open during Provider I/O and Repository failure rolls back complete mutation.
- [ ] 6.3 Implement Workspace Service construction capturing trusted `TenantId`、current `AccountId`、Session factory and Key Provider；initialize Workspace Reader/Writer and Tenant credential codec internally.
- [ ] 6.4 Keep `DeploymentIMChannelService` only as a non-importable target shape in the reference stub；do not add production Deployment or EE composition in this change.
- [ ] 6.5 Add Workspace composition tests proving Reader、Writer and credential codec bind the same trusted Tenant and configuring Account.

## 7. Migrate Confirmed Channel API

- [ ] 7.1 Add one outer edition-admission gate for every canonical Workspace Channel path：allow Community/Cloud，return HTTP `501` on Enterprise before setup、authentication、DTO parsing、trusted context resolution or Service construction；do not pass edition below transport admission.
- [ ] 7.2 Add edition-gate tests covering every Channel collection/item/test/replacement path and proving rejected Enterprise requests invoke no authentication、DTO、Service、Repository or Provider work；retain the symmetric Community/Cloud-to-future-EE-inner HTTP `501` contract without implementing the inner API here.
- [ ] 7.3 Migrate the CE/SaaS Workspace Console controller from the deleted Integration owner to a request-scoped `WorkspaceIMChannelService` builder；do not add edition branching inside handlers or add an EE route.
- [ ] 7.4 Inject trusted current `TenantId` and `AccountId` into every IM Provider/list/read/test/create/update/replacement/delete route before Service construction，while preserving the existing authorization guards、request/response DTOs、Provider credential DTOs、`ChannelSummary`、HTTP status/error mapping and OpenAPI shape.
- [ ] 7.5 Keep the controller thin：validate transport payload/path/query and opaque versions、delegate owner-scoped existence and all Channel decisions to Service、translate stable errors and project responses；do not read Repository state、perform Provider I/O or own transactions.
- [ ] 7.6 Update IM `ConfigVersion` internals to encode/decode Channel ID plus numeric version without changing the opaque wire format.
- [ ] 7.7 Map `IMChannelView` to existing `ChannelSummary` and keep mutation responses authoritative without follow-up reads.
- [ ] 7.8 Run existing Channel API、wire、OpenAPI、security and controller-container contract suites rather than deleting them.

## 8. Remove Old Application Ownership

- [ ] 8.1 Confirm the already-removed legacy Service/composition have no remaining callers；do not recreate compatibility implementations.
- [ ] 8.2 Remove residual application-only Integration management contracts、exports、credential envelope and revision usage from Channel management code.
- [ ] 8.3 Update safe application errors/imports to remove dependencies on old Integration management contracts.
- [ ] 8.4 Preserve Identity、Binding、Sync/Reconciliation、Inbox、delivery、Webhook runtime and historical `IntegrationId` / `integration_id` owners byte-for-behavior unchanged.
- [ ] 8.5 Add architecture searches proving `IMChannelService` is the sole Channel management owner and no duplicate/legacy management service remains.

## 9. Verification

- [ ] 9.1 Run focused Service、Provider preparation、composition and error-mapping unit tests through `uv run --project api`.
- [ ] 9.2 Run Channel controller、wire、OpenAPI、security and supported container contract tests.
- [ ] 9.3 Run formatter、lint、type checks and import-linter for changed backend modules.
- [ ] 9.4 Run `openspec validate implement-human-input-im-channel-service --strict` and revalidate the prerequisite Repository change.
- [ ] 9.5 Search this change for ORM/schema/CAS implementation、dependent-domain mutation、Webhook ingress、OAuth lifecycle or remote cleanup；none MUST be introduced.
