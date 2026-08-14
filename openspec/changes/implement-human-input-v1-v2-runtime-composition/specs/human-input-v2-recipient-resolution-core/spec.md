## MODIFIED Requirements

### Requirement: Recipient resolution MUST be a pure single-entry domain operation

The domain MUST expose one recipient resolution operation that accepts immutable specifications and current capability snapshots, and returns an immutable approval plan without database, provider or transport dependencies. An `all_workspace_contacts` marker MUST enter this operation as a typed specification. Its current Contact candidates MUST be supplied as an immutable request-scoped snapshot through an injected port outside the resolver; each candidate MUST include its canonical Contact snapshot, availability and workspace-relative `WORKSPACE`, `PLATFORM` or `EXTERNAL` classification.

#### Scenario: Resolver is tested without infrastructure

- **WHEN** recipient resolution including `all_workspace_contacts` is exercised in a unit test
- **THEN** the test MUST run with immutable fake snapshots and without Flask, a database engine or provider client

#### Scenario: Workspace snapshot capability is unavailable

- **WHEN** node runtime encounters `all_workspace_contacts` without an injected production snapshot provider
- **THEN** the application boundary MUST fail closed before pure recipient resolution
- **AND** it MUST NOT substitute an empty snapshot

### Requirement: Recipient resolution MUST produce one canonical approval plan

Resolution MUST validate values, expand `all_workspace_contacts`, resolve current identities, canonicalize subjects, retain matched sources, select delivery endpoints and retain machine-readable rejected-recipient facts in one result. Marker expansion MUST include only available Contacts whose current classification for the form workspace is `WORKSPACE`; it MUST exclude `PLATFORM` and `EXTERNAL` Contacts. The resulting endpoint plans MUST remain the sole authority for downstream delivery and interaction surfaces.

#### Scenario: Marker expands workspace Contacts only

- **WHEN** the request-scoped snapshot contains Workspace, Platform and External Contacts
- **THEN** `all_workspace_contacts` MUST expand only the Workspace Contacts
- **AND** the expanded sources MUST be ordered deterministically by Contact ID

#### Scenario: Workspace contains no eligible Contacts

- **WHEN** `all_workspace_contacts` resolves against a snapshot with no available Workspace Contacts
- **THEN** the plan MUST retain a typed rejection or stable no-valid-recipients outcome rather than inventing another Contact class

#### Scenario: Interaction surfaces come from endpoint plans

- **WHEN** expanded or explicitly configured recipients have web or console capability
- **THEN** their resolved approver endpoints MUST contain the corresponding endpoint plans
- **AND** downstream runtime MUST NOT use a form-level visibility flag to reinterpret them

### Requirement: Canonical subject identity MUST remain independent from recipient source and delivery channel

The resolver MUST deduplicate by canonical Contact, EndUser or EmailAddress subject key, not by configured source or channel. One approver MUST retain every applicable matched source and each canonical endpoint once. `all_workspace_contacts` and an explicit Contact that resolve to the same Contact MUST therefore produce one Contact approver without duplicate delivery. A distinct EmailAddress recipient sharing that Contact's normalized email MUST remain a separate approver.

#### Scenario: Marker overlaps an explicit Contact

- **WHEN** one Contact is selected by both `all_workspace_contacts` and an explicit Contact recipient
- **THEN** the plan MUST contain one Contact approver with both matched-source facts
- **AND** each equivalent endpoint plan MUST occur only once

#### Scenario: Multiple markers are present

- **WHEN** imported compatibility data contains repeated `all_workspace_contacts` markers
- **THEN** each eligible Workspace Contact MUST still produce at most one canonical Contact approver

#### Scenario: Contact overlaps a same-email EmailAddress recipient

- **WHEN** an expanded Workspace Contact and a one-time or Dynamic Email recipient share one normalized email
- **THEN** the plan MUST preserve distinct Contact and EmailAddress approvers because their canonical subject identities differ

### Requirement: Recipient resolution output MUST be deterministic

Identical ordered specifications and identical immutable directory, workspace-contact and capability snapshots MUST produce identical ordering of approvers, matched sources, endpoints and rejected facts.

#### Scenario: Workspace marker resolution is repeated

- **WHEN** `all_workspace_contacts` resolution receives equivalent snapshots with Contacts in different storage order
- **THEN** its expanded sources and complete approval plan MUST be equal across runs
