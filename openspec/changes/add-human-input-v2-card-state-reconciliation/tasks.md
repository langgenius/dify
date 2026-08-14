## 1. Domain Contracts and Data Model

- [ ] 1.1 Add failing domain tests for accepted IM card delivery facts, opaque `MessageLocator` round-trip and rejection of attempts without confirmed Provider acceptance.
- [ ] 1.2 Add a strict IM card delivery-attempt data variant that preserves Form, endpoint, Integration, Provider, Provider-tenant and accepted locator facts without changing existing Email attempt decoding.
- [ ] 1.3 Add failing domain tests for reconciliation target construction, controlled statuses and the `(form_id, delivery_attempt_id)` create-once identity.
- [ ] 1.4 Implement immutable card reconciliation target values and stable `PENDING`, `ATTEMPTING`, `SUCCEEDED`, `UNSUPPORTED`, `INVALID_REFERENCE`, `STALE_REFERENCE` and `UNKNOWN` statuses.
- [ ] 1.5 Add a deterministic Provider-neutral static-card renderer from committed Form definition and terminal outcome, with golden tests for accepted actions including business rejection, node timeout and expiry, proving that no interactive input, action or callback metadata remains.

## 2. Persistence and Migration

- [ ] 2.1 Add an Alembic migration and ORM record for per-card reconciliation targets with Form, delivery-attempt and endpoint ownership, immutable Provider/tenant/Integration/locator facts, controlled outcome fields and timestamps.
- [ ] 2.2 Add unique and query indexes for `(tenant_id, form_id, delivery_attempt_id)`, due `PENDING` publication and stale `ATTEMPTING` recovery.
- [ ] 2.3 Add explicit mappers and round-trip tests for IM accepted-delivery data and reconciliation targets without exposing ORM instances.
- [ ] 2.4 Add repository contract tests for create-or-load materialization of every accepted card delivery belonging to one handled Form.
- [ ] 2.5 Implement atomic `PENDING -> ATTEMPTING` claim, terminal completion and stale `ATTEMPTING -> UNKNOWN` recovery without a transition back to `PENDING`.
- [ ] 2.6 Add query-count tests for Form-scoped materialization and target projection to prevent per-card N+1 access.

## 3. Accepted IM Card Delivery Integration

- [ ] 3.1 Add failing application tests proving that only `MessageAccepted` results create durable locator facts and that `MessageSendingError` results never create reconciliation targets.
- [ ] 3.2 Implement the authoritative Human Input v2 IM card-delivery persistence path so every confirmed `send_card` result stores its exact locator and frozen endpoint Provider context.
- [ ] 3.3 Add a transaction-scoped operation that records accepted card delivery while locking the owning Form row and materializes a reconciliation target immediately when the Form is already submitted, timed out or expired.
- [ ] 3.4 Add concurrency tests for delivery acceptance before terminal transition commit, after terminal transition commit and racing with terminal transition commit; assert one target per accepted delivery in every ordering.
- [ ] 3.5 Verify callback decoding and `IMCardEvent` remain locator-free and add an architecture test preventing the IM producer or decoder from importing submission/reconciliation aggregates.

## 4. Terminal Form Commit Integration

- [ ] 4.1 Add failing persistence/application tests proving that accepted selected-action submissions, including business rejection actions, and committed node-timeout or expiry transitions materialize targets for all currently accepted card deliveries, while rejected or rolled-back transitions materialize none.
- [ ] 4.2 Integrate accepted submission, node-timeout and expiry persistence boundaries with one narrow reconciliation-target materialization collaborator while keeping Provider contracts and Provider I/O outside submission and Form lifecycle domain logic.
- [ ] 4.3 Serialize terminal transition and card-acceptance writes through the same Form owner lock order and handle uniqueness races by reloading the winning target.
- [ ] 4.4 Add tests proving workflow resume and timeout-branch dispatch do not wait for reconciliation and replacement outcomes cannot mutate or compensate submitted, timed-out or expired Form state.

## 5. Card Reconciliation Application Service

- [ ] 5.1 Add unit tests for all-target fan-out, including multiple accepted cards sharing one endpoint or Provider identity and distinct cards across Provider contexts.
- [ ] 5.2 Implement target processing that resolves the compatible adapter from frozen Integration/Provider/tenant facts and inspects the optional Dynamic Card Messaging capability.
- [ ] 5.3 Pass each target's exact stored locator and deterministic `StaticCardIntent` to `replace_with_static` without decoding, altering, synthesizing or substituting the locator.
- [ ] 5.4 Map missing capability to `UNSUPPORTED`, success to `SUCCEEDED`, and typed replacement errors to their matching terminal outcomes with sanitized diagnostics.
- [ ] 5.5 Add tests proving one target's unsupported, invalid, stale or unknown outcome does not short-circuit remaining targets and that partial success remains queryable per card.
- [ ] 5.6 Add architecture tests proving IM Provider contracts and implementations do not import Form, grant, submission, workflow or reconciliation types.

## 6. Publisher, Worker and At-Most-Once Execution

- [ ] 6.1 Add a due-target publisher and one-target worker using the reconciliation repository's atomic claim rather than Provider-call retry semantics.
- [ ] 6.2 Add duplicate-task and concurrent-worker tests proving only one winning claim can reach Provider mutation.
- [ ] 6.3 Disable Celery automatic retry for reconciliation tasks and ensure typed Provider failure terminates the target without creating another target or submission attempt.
- [ ] 6.4 Add stale-worker recovery tests proving abandoned `ATTEMPTING` work becomes `UNKNOWN` without another Provider call.
- [ ] 6.5 Wire the publisher and worker through Human Input v2 application composition without changing existing Email delivery worker, workflow node runtime or IM adapter interfaces.

## 7. Operational Projection and Verification

- [ ] 7.1 Add an application projection that returns the authoritative submitted, timed-out or expired Form outcome separately from every per-card reconciliation outcome without adding a public API.
- [ ] 7.2 Add end-to-end application tests for accepted success and business-rejection actions, node timeout and expiry across all-success, partial-success, unsupported, stale, invalid and unknown reconciliation matrices.
- [ ] 7.3 Add regression tests proving Web and IM submission responses, Form lifecycle transitions, workflow resume identity and Provider callback DTOs remain unchanged.
- [ ] 7.4 Run focused backend unit/repository tests through `uv run --project api`, then run OpenSpec validation and scoped lint/type checks for the touched Human Input v2 modules.
- [ ] 7.5 Document rollout order: locator persistence first, target/worker deployment second, materialization enablement last; document that historical handled Forms are not backfilled and rollback only disables new work.
