## 1. Freeze Repository Contracts

- [x] 1.1 Add failing contract tests for owner-free `IMChannel`、`IMChannelId`、`WebhookId`、`IMChannelStatus`、`IMChannelAlreadyConfiguredError` and `StaleIMChannelWriteError` defined by `domain.py`.
- [x] 1.2 Add failing Protocol tests requiring exactly `IMChannelReader.get` and `IMChannelWriter.create/update/replace/delete` without owner、scope、edition、actor、candidate、Provider or Webhook reverse-lookup parameters.

## 2. Define The Channel Schema

- [x] 2.1 Add one `HumanInputIMChannel` / `human_input_im_channels` model with non-null `owner_key`、Provider、Provider tenant ID、canonical encrypted credentials、safe app identifier、`configured_by_account_id`、globally unique `webhook_id`、status and numeric version.
- [x] 2.2 Add explicit unique constraints for `owner_key` and `webhook_id` plus a positive-version check constraint.
- [x] 2.3 Remove nullable `tenant_id` owner encoding and persisted callback URL from the unpublished Channel schema.
- [x] 2.4 Reuse canonical `IMEncryptedCredentials` and `FrozenPydanticModelColumn` unchanged；do not add another envelope、adapter or JSON migration.
- [x] 2.5 Add schema tests for non-null owner keys、workspace/deployment key length、constraint names、positive versions and absence of dependent ORM relationships.
- [x] 2.6 Add a portable Alembic migration after the Human Input migration head that creates and drops `human_input_im_channels` without row backfill.

## 3. Place Repository Types

- [x] 3.1 Reuse existing shared `IMProvider`、`TenantId`、`AccountId` and other cross-capability definitions from `api/core/human_input_v2/`.
- [x] 3.2 Add `IMChannelStatus`、`IMChannelId`、`WebhookId` and owner-free `IMChannel` to `api/repositories/human_input_v2/im_channel_repository.py`.
- [x] 3.3 Add `IMChannelReader`、`IMChannelWriter`、`IMChannelAlreadyConfiguredError` and `StaleIMChannelWriteError` to the same `api/repositories/human_input_v2/im_channel_repository.py` contract module.

## 4. Implement Owner-Bound Repositories

- [x] 4.1 Implement private `HumanInputIMChannel` / `IMChannel` mapping helpers in `api/repositories/human_input_v2/sqlalchemy_im_channel_repository.py` without parsing credentials or exposing `owner_key` and `configured_by_account_id`; do not add a separate mapper module.
- [x] 4.2 Implement shared private owner-key、mapping、statement and error helpers plus Workspace/Deployment readers and repositories in `api/repositories/human_input_v2/sqlalchemy_im_channel_repository.py`.
- [x] 4.3 Implement `WorkspaceIMChannelReader(Session, TenantId)` and `WorkspaceIMChannelWriter(Session, TenantId, AccountId)`；derive `workspace:<tenant_id>` internally in both.
- [x] 4.4 Implement `DeploymentIMChannelReader(Session)` and `DeploymentIMChannelWriter(Session)`；derive `deployment` internally and accept no actor in either reader or writer.
- [x] 4.5 Include constructor-bound `owner_key` in every reader query and repository mutation predicate.
- [x] 4.6 Persist constructor-bound `AccountId` for Workspace create/update/replacement and null actor metadata for Deployment writes；prove read composition requires no actor.

## 5. Implement Singleton And Error Classification

- [x] 5.1 Implement create through insert/flush and require the initial positive configuration version.
- [x] 5.2 Translate only `human_input_im_channels_owner_key_uq` into `IMChannelAlreadyConfiguredError`.
- [x] 5.3 Let `webhook_id` collision and every other non-owner-key SQLAlchemy、mapping、validation or integrity exception propagate unchanged.
- [x] 5.4 Add concurrent-create tests for the same workspace、different workspaces and deployment owner slot on supported database dialects.

## 6. Implement Scalar CAS Writes

- [x] 6.1 Implement update with owner-key + Channel-ID + expected-version conditional DML and affected-row stale detection.
- [x] 6.2 Reject update values that change Channel ID or do not use expected version plus one before mutation SQL.
- [x] 6.3 Implement replacement as conditional removal followed by insertion of a different Channel ID at the initial version under the same owner key and caller transaction.
- [x] 6.4 Implement delete with owner-key + Channel-ID + expected-version conditional DML.
- [x] 6.5 Add Reader parity tests for missing/current reads and owner isolation，plus Writer parity tests for current/stale update、replacement ABA、current/stale delete、cross-owner ID isolation and owner-slot reuse after committed delete.

## 7. Preserve Caller-Owned Transactions And Boundaries

- [x] 7.1 Prove Reader and Writer methods never create Session、commit、rollback、begin nested transaction、construct locks、perform external I/O or dispatch tasks.
- [x] 7.2 Add rollback tests for create、update、replacement insertion failure and delete using a caller-owned Session.
- [x] 7.3 Add SQL-spy tests proving Repositories only access `HumanInputIMChannel`.
- [x] 7.4 Keep `webhook_id` as mapped persistence data without defining `IMWebhookChannelRepository`、`LocatedIMChannel`、owner parsing or ingress/runtime integration.

## 8. Verify The Repository Change

- [x] 8.1 Run focused Repository contract、schema、private-mapping and SQLAlchemy adapter tests through `uv run --project api`.
- [x] 8.2 Run formatter、lint and type checks for changed backend modules.
- [x] 8.3 Run CI-owned PostgreSQL/MySQL tests for owner-key singleton concurrency、constraint classification、scalar CAS、replacement ABA and transaction rollback.
- [x] 8.4 Run `openspec validate refactor-human-input-im-channel-domain --strict`.
- [x] 8.5 Search this change for Provider preparation、candidate test、management service、`replacement_required`、Webhook reverse lookup and dependent-domain orchestration；none MUST remain.
