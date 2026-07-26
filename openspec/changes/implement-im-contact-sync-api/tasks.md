## 1. Provider Adapter Foundation

- [ ] 1.1 Add the minimal backend dependency and provider adapter interfaces needed to read Feishu/Lark directory data through the official server-side SDK boundary.
- [ ] 1.2 Implement provider-neutral normalization from Feishu/Lark SDK responses into `ProviderDirectoryEntry` values and safe connection diagnostics.
- [ ] 1.3 Add unit tests covering directory-entry normalization, provider-user-ID extraction, normalized-email extraction, and sensitive-error sanitization for the provider adapters.

## 2. IM Sync Application Services

- [ ] 2.1 Add an `IMSyncManagementService` that orchestrates integration read/update/delete, connection test, manual sync trigger, latest-run summary, and latest-result pagination through the existing repositories.
- [ ] 2.2 Add the asynchronous manual-sync execution flow that creates or reuses the single active run, enqueues background work, loads reconciliation snapshots, calls `SyncReconciler`, and applies revision-guarded plans.
- [ ] 2.3 Preserve the canonical latest-only sync result contract with the `added / not_matched / failed / removed / skipped` buckets and add service-level tests for active-run reuse, stale revision rejection, and latest-result paging rules.

## 3. Contact Binding Integration

- [ ] 3.1 Add a `ContactIMBindingService` that lists synced IM identities, including search by provider user ID, display name, and email.
- [ ] 3.2 Implement contact-scoped IM binding create/delete flows that only allow current `WORKSPACE` or `PLATFORM` contacts and reject `EXTERNAL`, `ABSENT`, or deleted contacts.
- [ ] 3.3 Implement EE workspace override set/reset flows without rewriting organization bindings, and verify the existing effective-binding resolution still applies `workspace override > organization binding > Email fallback`.
- [ ] 3.4 Add unit and integration tests proving unmatched sync results never auto-create contacts or bindings and that invalidated bindings disappear from effective binding resolution after integration replacement.

## 4. Console API Wiring

- [ ] 4.1 Replace the IM-related stub handlers in `api/controllers/console/workspace/human_input.py` with service-backed implementations for integration read/update/delete/test and manual sync latest-only reads.
- [ ] 4.2 Replace the identity-search, contact binding, and workspace override stub handlers with service-backed implementations that preserve the existing DTO contract and transport-neutral error mapping.
- [ ] 4.3 Update or add nearby module/function docstrings and controller tests so the new IM management routes document their invariants, revision rules, and contact-type guards.

## 5. Verification And Coverage

- [ ] 5.1 Add focused repository, service, and controller tests for manual sync success, active-run deduplication, stale revision apply, latest-result bucket validation, identity search, binding writes, and override reset behavior.
- [ ] 5.2 Add or update concurrency tests for the async sync path and binding-related current-state transitions where the existing contract depends on serialization or CAS semantics.
- [ ] 5.3 Verify the new or changed backend modules for this change reach at least 90% test coverage and record the targeted test commands needed to reproduce the verification.
