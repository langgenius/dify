## 1. Boundary and contract tests

- [ ] 1.1 Inventory `HumanInputChannelManagementService`、Channel handler/registry code、Email Management owner、IM Integration application owner、Console provider credential DTOs、Channel projections、v2 routes and callers of legacy `im-integration` paths。
- [ ] 1.2 Add failing architecture tests proving Channel Management depends on one Email port and one IM Integration port、does not import Email/IM ORM records and does not define provider-level handler registration or lifecycle transitions。
- [ ] 1.3 Add failing route tests for the canonical `/workspace/current/human-input/v2` prefix、one `GET /channels`、one `GET /channel-providers`、ID-addressed items and replacement、kind mismatch `404` and owner/admin authorization on every route。
- [ ] 1.4 Add failing schema tests for canonical `ChannelSummary`、grouped provider catalog、provider-discriminated credentials、opaque `ConfigVersion`、three-state Channel status and response envelopes/status codes。

## 2. Deep Channel Management boundary

- [ ] 2.1 Replace `ChannelHandler`/`ChannelHandlerRegistry` composition with one Email Management port and one IM Integration application port；remove `DuplicateChannelHandlerError`、per-provider Channel managers and register/resolve dispatch。
- [ ] 2.2 Project every configured Email/IM resource into `ChannelSummary` and never manufacture a `not_configured` Channel for an available provider。
- [ ] 2.3 Implement one available-only provider catalog with `email_providers` and `im_providers`；omit unavailable providers and keep the read independent of configuration persistence and external provider I/O。
- [ ] 2.4 Remove `ChannelView`、per-kind Channel summaries、retained controller `IMIntegration` configured projections and duplicated test-summary DTOs；keep owner-native aggregate and persistence models behind the application ports。
- [ ] 2.5 Derive `display_identifier` only from safe app/client、tenant-display and Email sender fields；add regression coverage excluding API keys、secrets、tokens、encrypt keys and masked credentials。

## 3. Canonical Console credential contracts

- [ ] 3.1 Make `api/controllers/console/human_input_v2/providers.py` the canonical Console owner of `IMProviderCredentials`、`EmailProviderCredentials` and all provider variants；delete or migrate duplicate legacy controller DTOs。
- [ ] 3.2 Use Pydantic `SecretStr` for every secret field and add repr、log and validation-diagnostic regression coverage。
- [ ] 3.3 Require complete newly submitted credentials for create、update、replacement and test；remove `PreserveOriginalValue`、partial update and persisted-secret merge behavior。
- [ ] 3.4 Require Resend `sender_email`、`sender_name` and `api_key` in the same complete candidate for create、update and test。
- [ ] 3.5 Implement request envelopes matching the stub：create/test contain `credentials`；update/replacement also require `expected_config_version`；delete requires it as a query argument；the item path is the only `channel_id` source。

## 4. IM transitions, versioning and test behavior

- [ ] 4.1 Implement ordinary IM create with the current at-most-one invariant and reject a second ordinary create before provider I/O。
- [ ] 4.2 Implement ID-addressed credential rotation that requires the current opaque `ConfigVersion`、same provider and same provider tenant；preserve domain integration identity、identities and bindings and advance the numeric domain revision exactly once。
- [ ] 4.3 Return `replacement_required` without mutation when IM update selects a different provider or provider tenant。
- [ ] 4.4 Implement atomic replacement at `POST /channels/im/<channel_id>/replacement`；clear only identities/bindings owned by the addressed Channel and return the replacement summary。
- [ ] 4.5 Map HTTP `channel_id + ConfigVersion` to the IM owner's complete `integration_id + numeric config_version` CAS；return `provider_configuration_updated` for stale writes and do not introduce additional stable conflict codes。
- [ ] 4.6 Keep candidate tests non-persistent and based only on submitted credentials；map invalid credentials to `invalid_credentials`、other expected provider errors to `connection_failure` and unexpected failures to a detail-free `500`。

## 5. Workspace Console migration

- [ ] 5.1 Replace provider-addressed and kind-specific discovery routes with the exact v2 route inventory in the spec；do not register kind-specific list/catalog methods。
- [ ] 5.2 Return `ListChannelsResponse.channels` as `ChannelSummary` and return provider catalog entries containing only `provider` and `connection_mode`。
- [ ] 5.3 Return `200 + summary` for create/update/replacement and `200 + channel_id` for delete；use `ChannelSummary` directly as the mutation result so clients need no create-followed-by-list refresh。
- [ ] 5.4 Implement only `connected`、`invalid_credentials` and `connection_failure` status values；use safe `status_description` and expose neither `last_checked_at` nor an asynchronous creation state。
- [ ] 5.5 Remove both legacy `im-integration` route registrations and unused legacy controller response/request wrappers without aliases while preserving IM domain types required by sync、identity and binding behavior。

## 6. Verification and rollout

- [ ] 6.1 Add provider-family DTO construction and credential-mapping coverage for Resend、Slack、Feishu/Lark、DingTalk、Microsoft Teams and WeCom without live credentials。
- [ ] 6.2 Add PostgreSQL integration coverage for create、rotation、provider-tenant replacement、cross-provider replacement、delete、stale CAS、rollback and unaffected Email/identity/binding invariants。
- [ ] 6.3 Add controller/OpenAPI coverage for the exact route inventory、authorization、request DTO ownership、response shapes/status codes、three-state status、safe display identifiers、test failure mapping、two stable conflict codes and legacy route-level `404`。
- [ ] 6.4 Add security regression tests proving responses、logs、metrics、traces、repr and validation diagnostics contain no credentials、protected placeholders、raw provider failures or provider payloads。
- [ ] 6.5 Run focused backend unit suites、controller/schema/OpenAPI checks、formatter、type/lint checks and `openspec validate complete-human-input-im-channel-management --strict`；keep production exposure gated until Contact initialization、lifecycle maintenance and manual-sync runtime readiness are complete。
