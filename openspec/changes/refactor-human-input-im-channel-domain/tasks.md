## 1. Freeze Repository Contracts

- [ ] 1.1 Add failing contract tests for owner-free `IMChannel`、`IMChannelId`、`WebhookId`、`IMChannelStatus` and persistence errors defined by `domain.py`.
- [ ] 1.2 Add failing Protocol tests requiring exactly `IMChannelRepository.get/create/update/replace/delete` without owner、scope、edition、actor、candidate、Provider or Webhook reverse-lookup parameters.
- [ ] 1.3 Add architecture tests rejecting `PreparedIMChannelConfiguration`、`LocatedIMChannel`、`IMWebhookChannelRepository`、management service and Provider preparation definitions in the IM Channel Repository package.
- [ ] 1.4 Add architecture tests forbidding Channel Repositories from importing Identity、Binding、Sync/Reconciliation、Contact、Inbox、Provider SDK、controller、service、Celery、Redis lock or `DifySetup` lock modules.

## 2. Define The Channel Schema

- [ ] 2.1 Add one `HumanInputIMChannel` / `human_input_im_channels` model with non-null `owner_key`、Provider、Provider tenant ID、canonical encrypted credentials、safe app identifier、`configured_by_account_id`、globally unique `webhook_id`、status and numeric version.
- [ ] 2.2 Add explicit unique constraints for `owner_key` and `webhook_id` plus a positive-version check constraint.
- [ ] 2.3 Remove nullable `tenant_id` owner encoding and persisted callback URL from the unpublished Channel schema.
- [ ] 2.4 Reuse canonical `IMEncryptedCredentials` and `FrozenPydanticModelColumn` unchanged；do not add another envelope、adapter or JSON migration.
- [ ] 2.5 Add schema tests for non-null owner keys、workspace/deployment key length、constraint names、positive versions and absence of dependent ORM relationships.

## 3. Place Repository Types

- [ ] 3.1 Reuse existing shared `IMProvider`、`TenantId`、`AccountId` and other cross-capability definitions from `api/core/human_input_v2/`.
- [ ] 3.2 Add `IMChannelStatus`、`IMChannelId`、`WebhookId` and owner-free `IMChannel` to `api/repositories/human_input_v2/im_channel/entities.py`.
- [ ] 3.3 Add `IMChannelRepository`、`IMChannelAlreadyConfiguredError`、`StaleIMChannelWriteError` and `IMChannelPersistenceError` to `api/repositories/human_input_v2/im_channel/ports.py`.
- [ ] 3.4 Add architecture tests proving no Channel core module、controller or service defines duplicate or pass-through Repository contract values.

## 4. Implement Owner-Bound Repositories

- [ ] 4.1 Implement explicit `HumanInputIMChannel` / `IMChannel` mapping without parsing credentials or exposing `owner_key` and `configured_by_account_id`.
- [ ] 4.2 Implement shared private SQLAlchemy statement/error helpers plus `WorkspaceIMChannelRepository` and `DeploymentIMChannelRepository` in `api/repositories/human_input_v2/im_channel/repository.py`.
- [ ] 4.3 Implement `WorkspaceIMChannelRepository(Session, TenantId, AccountId)` and derive `workspace:<tenant_id>` internally.
- [ ] 4.4 Implement `DeploymentIMChannelRepository(Session)` and derive `deployment` internally without accepting an actor.
- [ ] 4.5 Include constructor-bound `owner_key` in every read and mutation predicate.
- [ ] 4.6 Persist constructor-bound `AccountId` for Workspace create/update/replacement and null actor metadata for Deployment writes.

## 5. Implement Singleton And Error Classification

- [ ] 5.1 Implement create through insert/flush and require the initial positive configuration version.
- [ ] 5.2 Translate only `human_input_im_channels_owner_key_uq` into `IMChannelAlreadyConfiguredError`.
- [ ] 5.3 Translate `webhook_id` collision and every other integrity/SQLAlchemy failure into credential-safe `IMChannelPersistenceError` without exposing values or SQL details.
- [ ] 5.4 Add concurrent-create tests for the same workspace、different workspaces and deployment owner slot on supported database dialects.

## 6. Implement Scalar CAS Writes

- [ ] 6.1 Implement update with owner-key + Channel-ID + expected-version conditional DML and affected-row stale detection.
- [ ] 6.2 Reject update values that change Channel ID or do not use expected version plus one before mutation SQL.
- [ ] 6.3 Implement replacement as conditional removal followed by insertion of a different Channel ID at the initial version under the same owner key and caller transaction.
- [ ] 6.4 Implement delete with owner-key + Channel-ID + expected-version conditional DML.
- [ ] 6.5 Add Repository parity tests for current/stale update、replacement ABA、current/stale delete、cross-owner ID isolation and owner-slot reuse after committed delete.

## 7. Preserve Caller-Owned Transactions And Boundaries

- [ ] 7.1 Prove Repository methods never create Session、commit、rollback、begin nested transaction、construct locks、perform external I/O or dispatch tasks.
- [ ] 7.2 Add rollback tests for create、update、replacement insertion failure and delete using a caller-owned Session.
- [ ] 7.3 Add SQL-spy/import tests proving Repositories only access `HumanInputIMChannel`.
- [ ] 7.4 Keep `webhook_id` as mapped persistence data without defining `IMWebhookChannelRepository`、`LocatedIMChannel`、owner parsing or ingress/runtime integration.

## 8. Verify The Repository Change

- [ ] 8.1 Run focused Repository entity、schema、mapper、adapter and contract tests through `uv run --project api`.
- [ ] 8.2 Run formatter、lint、type checks and import-linter for changed backend modules.
- [ ] 8.3 Run CI-owned PostgreSQL/MySQL tests for owner-key singleton concurrency、constraint classification、scalar CAS、replacement ABA and transaction rollback.
- [ ] 8.4 Run `openspec validate refactor-human-input-im-channel-domain --strict`.
- [ ] 8.5 Search this change for Provider preparation、candidate test、management service、`replacement_required`、Webhook reverse lookup and dependent-domain orchestration；none MUST remain.
