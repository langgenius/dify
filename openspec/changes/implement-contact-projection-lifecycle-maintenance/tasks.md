## 1. Lifecycle Contract And Failing Coverage

- [ ] 1.1 Inventory every authoritative Account create/profile/status and CE/SaaS/EE membership add/remove/retain application operation, document its Contact transition and transaction owner, and identify bypass paths that periodic reconciliation must cover.
- [ ] 1.2 Add failing projection-service tests for create/update identity reuse, Account disable/reactivate without Contact mutation, CE/SaaS removal/rejoin identity replacement, EE retain/absent resolution, External Contact deletion, and current binding cleanup.
- [ ] 1.3 Add failing transaction tests proving a required Contact write failure prevents the owning Account/member operation from reporting success and leaves neither a partial membership transition nor partial binding cleanup.
- [ ] 1.4 Add architecture tests proving only Contact Directory lifecycle services write source-backed Contacts; Contact reads、Workspace/EE transports、manual-sync services、workers、planners and IM repositories cannot invoke backfill or lifecycle mutation.

## 2. Shared Contact Projection Transition Engine

- [ ] 2.1 Implement transport-neutral `OrganizationContactProjectionService` commands and a deterministic deployment-aware transition function over current Account、membership、Platform allow-list and Contact facts.
- [ ] 2.2 Implement idempotent repository mutations for source-backed Contact create/update, CE/SaaS workspace-owned Contact plus current-binding hard-delete, and EE Organization-owned identity preservation, with concurrency-safe owner predicates and uniqueness handling.
- [ ] 2.3 Centralize current Account availability and workspace resolution so Contact list/detail、recipient selection、pending-task authorization and IM Email matching omit `ABSENT`/unavailable Contacts without mutating projection state.
- [ ] 2.4 Complete focused service/repository tests for same-identity retries, competing lifecycle writes, cross-workspace rejection, stable EE Contact IDs, CE/SaaS new IDs after rejoin, and frozen historical snapshot independence.

## 3. Authoritative Account And Member Write-Through

- [ ] 3.1 Connect eligible Account create and mutable profile-update application operations to the shared projection service while preserving an existing source-backed Contact ID; keep disable/delete status transitions free of Contact mutation.
- [ ] 3.2 Connect CE/SaaS membership add/remove operations so add creates or reuses the current membership Contact, removal atomically hard-deletes the workspace-owned Contact and current IM bindings, and a later rejoin creates a new Contact ID.
- [ ] 3.3 Connect EE membership and Platform allow-list operations so Organization-owned Contact identity remains stable while each workspace resolves current membership as `WORKSPACE`, retained access as `PLATFORM`, and all other cases as `ABSENT`.
- [ ] 3.4 Verify External Contact deletion continues to hard-delete the selected workspace-owned Contact and its current bindings without changing internal Contact collision or Organization ownership rules.
- [ ] 3.5 Add application-operation tests for successful transitions, Contact-write rollback, concurrent add/remove, Account reactivate visibility, other-workspace isolation and old pending-task authority rejection after CE/SaaS rejoin.

## 4. Independent Periodic Reconciliation

- [ ] 4.1 Implement a dedicated Contact lifecycle reconciliation task that scans authoritative source facts with stable bounded pagination and invokes the same transition service without provider credentials、provider directory state or manual-sync dependencies.
- [ ] 4.2 Add per-deployment-scope serialization, page checkpoints and idempotent retry/recovery so a failed or redelivered page cannot duplicate Contact identities or repeat completed destructive transitions.
- [ ] 4.3 Add PII-free metrics and structured diagnostics for scanned、created、updated、deleted、unchanged、failed and checkpoint/remaining progress, plus an observe/dry-run mode for rollout comparison.
- [ ] 4.4 Add task tests for create/update/delete drift repair, no-op revisits, page-boundary source changes, overlapping runs, failed-page resume and isolation from IM sync queues and provider adapters.

## 5. Integration Verification And Rollout

- [ ] 5.1 Add PostgreSQL integration coverage for Account/member write-through, transaction rollback, Account disable/reactivate availability, CE/SaaS removal/rejoin, EE retain/absent behavior, binding cleanup and periodic drift repair; keep repository policy's integration suite CI-owned.
- [ ] 5.2 Add cross-boundary coverage proving Contact reads and a complete manual IM sync consume current eligible Contacts but perform no Contact create、update、delete、backfill or repair.
- [ ] 5.3 Run focused backend unit suites、formatter、type/lint checks and `openspec validate implement-contact-projection-lifecycle-maintenance --strict`; review the final dependency graph for a single Contact lifecycle writer.
- [ ] 5.4 After the version upgrade successfully runs `flask data-migrate human-input-contacts --apply` as owned by `initialize-human-input-contact-projection`, run reconciliation in observe/dry-run mode, enable bounded repair, monitor lifecycle failures and drift, and only then unblock the production Contacts/IM capability gate.
- [ ] 5.5 Exercise rollback by disabling the periodic schedule and production gate while keeping a compatible authoritative write-through path active; document the mutation gate required if write-through itself must be rolled back.
