## 1. Contract Alignment And Failing Coverage

- [ ] 1.1 Revise or supersede `initialize-human-input-contact-projection` and `implement-contact-projection-lifecycle-maintenance` artifacts so they initialize one Contact identity per Account、preserve stable SaaS/CE Account-backed Contact IDs and repair missing identities without an Account profile projection.
- [ ] 1.2 Inventory every legacy `HumanInputContact` profile read/write and every durable `contact_id` consumer; classify each path as Contact identity-only、current Account profile、current External Contact profile、current availability or historical snapshot usage.
- [ ] 1.3 Add failing domain tests for immutable `ContactSubjectType.ACCOUNT / ContactSubjectType.EXTERNAL` identities、global Account uniqueness、stable Account-backed Contact identity across workspace membership/visibility changes and complete External Contact identity deletion.
- [ ] 1.4 Add failing application and repository tests proving Account profile updates perform no Contact write while current detail、list、recipient and authorization results immediately use current Account values.
- [ ] 1.5 Add failing architecture tests that forbid Account profile writers、controllers、IM workers and read repositories from writing mutable fields on `HumanInputContactIdentity`.

## 2. Define The Final Unreleased Schema

- [ ] 2.1 Rewrite the unreleased Contact ORM model and schema revision to create `HumanInputContactIdentity`、`HumanInputExternalContactProfile`、`human_input_contact_identities` and `human_input_external_contact_profiles` as the first shipped shape.
- [ ] 2.2 Add schema constraint tests for valid `ContactSubjectType.ACCOUNT / ContactSubjectType.EXTERNAL` shapes、global Account uniqueness、workspace-owned External Contact profiles and unchanged UUID referencing-column shapes.
- [ ] 2.3 Remove legacy mutable Contact profile columns and obsolete `ORGANIZATION_ACCOUNT / WORKSPACE_MEMBER` values directly instead of adding compatibility or data-copy paths.

## 3. Contact Identity And External Contact Profile Domain

- [ ] 3.1 Replace the mutable canonical `Contact` persistence entity with immutable Contact identity values and explicit `ContactSubjectType.ACCOUNT / ContactSubjectType.EXTERNAL` subjects while retaining one current Contact projection.
- [ ] 3.2 Implement record mappers that load `HumanInputContactIdentity` separately from Account and `HumanInputExternalContactProfile` facts and reject invalid subject/profile combinations without returning ORM instances.
- [ ] 3.3 Implement idempotent global Account-backed Contact identity ensure with database `account_id` uniqueness、conflict translation and same-ID retry semantics.
- [ ] 3.4 Implement atomic External Contact identity/profile create、profile-only update and profile/identity/current-binding delete.
- [ ] 3.5 Move External Contact normalized Email uniqueness and avatar-owner validation to the External Contact profile repository and preserve Account/External same-email coexistence.

## 4. Current Contact Queries And Management

- [ ] 4.1 Rewrite canonical availability predicates and current Contact facts to combine Contact identities with current Account status、membership、Platform allow-list and External Contact profile existence.
- [ ] 4.2 Rewrite current Contact detail、batch、list and editor-option queries to load Account profile directly and External Contact profile through its one-to-one relation while preserving filtering-before-count/pagination and request-order guarantees.
- [ ] 4.3 Rewrite Platform candidate search and add/remove commands to keep unified Contact IDs while validating `ContactSubjectType.ACCOUNT`、current membership and Platform visibility through workspace-scoped queries.
- [ ] 4.4 Rewrite External Contact create/update/mixed-remove services to mutate only External Contact profile state and preserve batch validation and atomicity.
- [ ] 4.5 Add query parity、keyword normalization、pagination and query-plan coverage; add source-owned or expression indexes only when measured plans require them.
- [ ] 4.6 Preserve Console request/response schemas and UUID routes, and add regression tests proving frontend-visible `ContactId` and `WORKSPACE / PLATFORM / EXTERNAL` values do not expose `ContactSubjectType`.

## 5. Runtime、Binding And IM Consumers

- [ ] 5.1 Rewrite IM Contact matching and apply preconditions to join Contact identities with current Account profile instead of copied Contact name、Email or normalized Email.
- [ ] 5.2 Rewrite Organization binding and workspace override validation to resolve `ContactSubjectType.ACCOUNT` from `HumanInputContactIdentity` and validate current binding scope/membership separately while continuing to reject External binding targets.
- [ ] 5.3 Rewrite recipient resolution and delivery-capability current-facts loading to expose one current Contact projection without source-layout branching above Contact Directory.
- [ ] 5.4 Rewrite form-grant、OTP and submission-authorization repositories to retain UUID `contact_id` and frozen historical snapshots while revalidating current Contact identity、Account/profile and workspace availability from source-owned facts.
- [ ] 5.5 Preserve sync-result and reconciliation-history Contact IDs/snapshots and remove ORM relationships that assume `HumanInputContactIdentity` owns current profile fields.
- [ ] 5.6 Add cross-consumer regression tests for Account profile changes、disabled/reactivated Account、membership removal/re-addition、EE Workspace/Platform transitions、deleted External Contact profile and unchanged historical display.

## 6. Contact Identity Lifecycle

- [ ] 6.1 Connect Account creation and Contact identity provisioning to global Account-backed Contact identity ensure without connecting Account profile、membership or Platform visibility updates to Contact identity mutation.
- [ ] 6.2 Keep membership removal and External deletion responsible for required current binding cleanup, but prove Account membership removal never deletes its Contact identity.
- [ ] 6.3 Implement bounded missing Contact identity and invalid External Contact identity/profile repair using the same idempotent Contact identity allocation primitive as foreground writes and without comparing Account profile fields.
- [ ] 6.4 Add lifecycle tests for competing global ensure operations、bypass-write repair、stable Contact ID across workspace membership changes、owner-scoped access control and no provider/IM-sync dependency.

## 7. Verification

- [ ] 7.1 Remove every remaining legacy mutable profile read/write and obsolete `ORGANIZATION_ACCOUNT / WORKSPACE_MEMBER` branch after all consumers use `ContactSubjectType.ACCOUNT / ContactSubjectType.EXTERNAL` identities.
- [ ] 7.2 Run focused non-container backend unit suites through `uv run --project api`, plus formatter、lint、type checks and schema tests.
- [ ] 7.3 Run CI-owned PostgreSQL/MySQL integration coverage for Contact identity allocation concurrency、External Contact uniqueness、query parity、binding cleanup and runtime authorization.
- [ ] 7.4 Run `openspec validate separate-human-input-contact-identity-from-profile --strict` and validate the revised initialization/lifecycle changes; review the final dependency graph for one Contact identity writer and no mutable Account profile projection.
- [ ] 7.5 Keep production Contact/IM gates closed until the final schema、Contact identity provisioning owner and missing-identity diagnostics are verified together.
